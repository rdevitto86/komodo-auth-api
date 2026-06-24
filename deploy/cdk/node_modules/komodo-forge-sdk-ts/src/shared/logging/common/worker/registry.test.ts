import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseLogEvent } from '../base.js';
import { getOrCreateWorker, resetRegistry } from './registry.js';
import type { WorkerAckMessage } from './shared/shared.js';

// ---------------------------------------------------------------------------
// Captured node Worker instance — set by the mock constructor below.
// Declared before vi.mock so the closure can write to it lazily (the factory
// runs the first time worker_threads is dynamically imported, long after
// module initialisation, so there is no temporal-dead-zone issue).
// ---------------------------------------------------------------------------
let capturedNodeWorker: {
	on: ReturnType<typeof vi.fn>;
	postMessage: ReturnType<typeof vi.fn>;
	terminate: ReturnType<typeof vi.fn>;
} | null = null;

vi.mock('worker_threads', () => ({
	Worker: class MockNodeWorker {
		on = vi.fn();
		postMessage = vi.fn();
		terminate = vi.fn().mockResolvedValue(0);
		constructor(_url: URL) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			capturedNodeWorker = this as any;
		}
	},
}));

function makeEvent(): BaseLogEvent {
	return {
		timestamp: new Date().toISOString(),
		level: 'warn',
		type: 'runtime',
		service: 'test-svc',
		env: 'development',
		version: '1.0.0',
		message: 'test event',
	};
}

// ===========================================================================
// UNIT TESTS — WorkerRef API surface and registry state transitions
// ===========================================================================

describe('Unit Tests', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		resetRegistry();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		resetRegistry();
	});

	describe('getOrCreateWorker', () => {
		it('returns a WorkerRef with all required methods', () => {
			const ref = getOrCreateWorker('fetch');
			expect(typeof ref.send).toBe('function');
			expect(typeof ref.flush).toBe('function');
			expect(typeof ref.stop).toBe('function');
			expect(typeof ref.register).toBe('function');
			expect(typeof ref.onError).toBe('function');
		});

		it('uses auto transport when called with no argument (default parameter)', () => {
			// Exercises the `transport = 'auto'` default parameter branch
			const ref = getOrCreateWorker();
			expect(typeof ref.send).toBe('function');
		});

		it('second call with a different transport returns a ref from the same registry', () => {
			const ref1 = getOrCreateWorker('fetch');
			const ref2 = getOrCreateWorker('node-worker'); // transport ignored after first call
			expect(() => {
				ref1.send(makeEvent());
				ref2.send(makeEvent());
			}).not.toThrow();
		});

		it('does not throw after resetRegistry() + re-init', () => {
			getOrCreateWorker('fetch');
			resetRegistry();
			expect(() => getOrCreateWorker('fetch')).not.toThrow();
		});
	});

	describe('resetRegistry', () => {
		it('allows fresh re-initialization', () => {
			const ref = getOrCreateWorker('fetch');
			ref.register('runtime', { endpoint: 'https://logs.test/rt', headers: {}, batchSize: 1, flushInterval: 0 });
			resetRegistry();
			expect(() => getOrCreateWorker('fetch')).not.toThrow();
		});

		it('is safe to call when no registry has been created', () => {
			expect(() => resetRegistry()).not.toThrow();
		});
	});

	describe('WorkerRef', () => {
		it('register() does not throw', () => {
			const ref = getOrCreateWorker('fetch');
			expect(() =>
				ref.register('runtime', {
					endpoint: 'https://logs.test/rt',
					headers: {},
					batchSize: 10,
					flushInterval: 0,
				}),
			).not.toThrow();
		});

		it('send() does not throw', () => {
			const ref = getOrCreateWorker('fetch');
			expect(() => ref.send(makeEvent())).not.toThrow();
		});

		it('flush(type) does not throw', () => {
			const ref = getOrCreateWorker('fetch');
			expect(() => ref.flush('runtime')).not.toThrow();
		});

		it('flush() without a type dispatches a global FLUSH and does not throw', () => {
			const ref = getOrCreateWorker('fetch');
			expect(() => ref.flush()).not.toThrow();
		});

		it('stop() does not throw', () => {
			const ref = getOrCreateWorker('fetch');
			expect(() => ref.stop()).not.toThrow();
		});

		it('onError() returns an unsubscribe function', () => {
			const ref = getOrCreateWorker('fetch');
			const handler = vi.fn();
			const unsub = ref.onError(handler);
			expect(typeof unsub).toBe('function');
			unsub();
			expect(handler).not.toHaveBeenCalled();
		});
	});
});

// ===========================================================================
// INTEGRATION TESTS — worker lifecycle, dispatch, handleAck, transport choice
// ===========================================================================

describe('Integration Tests', () => {
	beforeEach(() => {
		capturedNodeWorker = null;
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		resetRegistry();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		vi.useRealTimers();
		resetRegistry();
		delete (globalThis as Record<string, unknown>).Worker;
	});

	// Real class so `new Worker(url, opts)` returns `this` reliably.
	function makeMockWorker() {
		let captured: InstanceType<typeof MockWorker> | null = null;
		class MockWorker {
			postMessage = vi.fn();
			terminate = vi.fn().mockResolvedValue(0);
			onmessage: ((e: { data: WorkerAckMessage }) => void) | null = null;
			onerror: ((e: { message: string }) => void) | null = null;
			constructor(_url: URL, _opts?: unknown) {
				captured = this;
			}
		}
		(globalThis as Record<string, unknown>).Worker = MockWorker;
		getOrCreateWorker('web-worker'); // runs initBrowserWorker → sets onmessage/onerror
		return captured!; // guaranteed non-null after ctor ran
	}

	describe('browser worker lifecycle', () => {
		it('construction failure degrades to fetch — subsequent sends call fetch', async () => {
			(globalThis as Record<string, unknown>).Worker = vi.fn().mockImplementation(() => {
				throw new Error('Worker not supported');
			});
			const ref = getOrCreateWorker('web-worker');
			ref.register('runtime', { endpoint: 'https://logs.test/rt', headers: {}, batchSize: 1, flushInterval: 0 });
			ref.send(makeEvent());
			await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
		});

		it('construction failure with non-Error wraps in Error and degrades to fetch', async () => {
			// Throw a non-Error value to exercise the `new Error(String(err))` branch
			(globalThis as Record<string, unknown>).Worker = vi.fn().mockImplementation(() => {
				// eslint-disable-next-line @typescript-eslint/only-throw-error
				throw 'Worker not supported (string)';
			});
			const ref = getOrCreateWorker('web-worker');
			ref.register('runtime', { endpoint: 'https://logs.test/rt', headers: {}, batchSize: 1, flushInterval: 0 });
			ref.send(makeEvent());
			await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
		});

		it('onerror triggers degradation and calls registered onError handlers', () => {
			const mockWorker = makeMockWorker();
			const handler = vi.fn();
			getOrCreateWorker('web-worker').onError(handler); // state=ready → buildRef only
			mockWorker.onerror!({ message: 'worker crashed' });
			expect(handler).toHaveBeenCalledOnce();
			expect(handler.mock.calls[0]![0]).toBeInstanceOf(Error);
		});

		it('dispatches via postMessage when the worker is ready', () => {
			const mockWorker = makeMockWorker();
			const ref = getOrCreateWorker('web-worker');
			ref.send(makeEvent());
			expect(mockWorker.postMessage).toHaveBeenCalledOnce();
		});

		it('stop() sends a STOP directive then terminates the worker after 500ms', async () => {
			vi.useFakeTimers();
			const mockWorker = makeMockWorker();
			const ref = getOrCreateWorker('web-worker');
			ref.stop();
			expect(mockWorker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ directive: 'STOP' }));
			await vi.advanceTimersByTimeAsync(600);
			expect(mockWorker.terminate).toHaveBeenCalled();
		});
	});

	describe('node-worker lifecycle', () => {
		it('initializes with node-worker transport and dispatches messages once ready', async () => {
			const ref = getOrCreateWorker('node-worker');
			// Yield — initNodeWorker awaits import('worker_threads') then calls markReady
			await new Promise((r) => setTimeout(r, 10));
			ref.send(makeEvent());
			expect(capturedNodeWorker!.postMessage).toHaveBeenCalledOnce();
		});

		it('buffers messages sent before ready and flushes them after init completes', async () => {
			const ref = getOrCreateWorker('node-worker');
			// Send before the async init resolves — goes to pending queue (line 96)
			ref.send(makeEvent());
			// Yield to let initNodeWorker complete and call markReady
			await new Promise((r) => setTimeout(r, 10));
			// markReady drains the pending queue → postMessage called once
			expect(capturedNodeWorker!.postMessage).toHaveBeenCalledOnce();
		});

		it('routes node worker ACK messages through handleAck', async () => {
			getOrCreateWorker('node-worker');
			await new Promise((r) => setTimeout(r, 10));

			const msgCalls = capturedNodeWorker!.on.mock.calls as Array<[string, (arg: unknown) => void]>;
			const [, messageHandler] = msgCalls.find(([evt]) => evt === 'message') ?? [];
			expect(messageHandler).toBeDefined();

			messageHandler!({ directive: 'ERROR', provider: 'runtime', payload: { error: 'batch failed' } });
			expect(vi.mocked(console.error)).toHaveBeenCalledWith('[komodo-logger] worker batch error:', {
				error: 'batch failed',
			});
		});

		it('node worker error event triggers degradation and falls back to fetch', async () => {
			const ref = getOrCreateWorker('node-worker');
			ref.register('runtime', { endpoint: 'https://logs.test/rt', headers: {}, batchSize: 1, flushInterval: 0 });
			// Yield to let initNodeWorker complete and register the error handler
			await new Promise((r) => setTimeout(r, 10));

			const errorCalls = capturedNodeWorker!.on.mock.calls as Array<[string, (arg: Error) => void]>;
			const [, errorHandler] = errorCalls.find(([evt]) => evt === 'error') ?? [];
			expect(errorHandler).toBeDefined();

			errorHandler!(new Error('node worker crashed'));
			expect(vi.mocked(console.error)).toHaveBeenCalledWith(
				'[komodo-logger] node worker error:',
				'node worker crashed',
			);

			// After degradation, subsequent sends should go through fetch
			ref.send(makeEvent());
			await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
		});

		it('node worker construction failure (Error) degrades to fetch', async () => {
			// Temporarily replace the Worker export with a throwing constructor
			const wt = await import('worker_threads');
			const savedWorker = (wt as unknown as Record<string, unknown>).Worker;
			(wt as unknown as Record<string, unknown>).Worker = function () {
				throw new Error('spawn failed');
			};

			const ref = getOrCreateWorker('node-worker');
			ref.register('runtime', { endpoint: 'https://logs.test/rt', headers: {}, batchSize: 1, flushInterval: 0 });
			ref.send(makeEvent());

			await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
			expect(vi.mocked(console.error)).toHaveBeenCalledWith(
				'[komodo-logger] could not start node worker:',
				expect.any(Error),
			);

			(wt as unknown as Record<string, unknown>).Worker = savedWorker;
		});

		it('node worker construction failure (non-Error) wraps in Error and degrades to fetch', async () => {
			const wt = await import('worker_threads');
			const savedWorker = (wt as unknown as Record<string, unknown>).Worker;
			// Throw a non-Error value to exercise the `new Error(String(err))` branch
			(wt as unknown as Record<string, unknown>).Worker = function () {
				// eslint-disable-next-line @typescript-eslint/only-throw-error
				throw 'spawn failed (string)';
			};

			const ref = getOrCreateWorker('node-worker');
			ref.register('runtime', { endpoint: 'https://logs.test/rt', headers: {}, batchSize: 1, flushInterval: 0 });
			ref.send(makeEvent());

			await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());

			(wt as unknown as Record<string, unknown>).Worker = savedWorker;
		});
	});

	describe('handleAck', () => {
		it('ERROR directive logs to console.error', () => {
			const mockWorker = makeMockWorker();
			const errorSpy = vi.mocked(console.error);
			mockWorker.onmessage!({
				data: { directive: 'ERROR', provider: 'runtime', payload: { error: 'batch timeout' } },
			});
			expect(errorSpy).toHaveBeenCalledWith('[komodo-logger] worker batch error:', { error: 'batch timeout' });
		});

		it('STOP directive with lost events logs to console.warn', () => {
			const mockWorker = makeMockWorker();
			const warnSpy = vi.mocked(console.warn);
			mockWorker.onmessage!({
				data: { directive: 'STOP', payload: { lost: { runtime: 5, telemetry: 2 } } },
			});
			expect(warnSpy).toHaveBeenCalledWith(
				'[komodo-logger] stopped with unsent logs:',
				expect.stringContaining('runtime: 5'),
			);
		});

		it('STOP directive with empty lost map does not produce a console.warn', () => {
			const mockWorker = makeMockWorker();
			const warnSpy = vi.mocked(console.warn);
			mockWorker.onmessage!({
				data: { directive: 'STOP', payload: { lost: {} } },
			});
			const stoppedCalls = warnSpy.mock.calls.filter(
				(args) => typeof args[0] === 'string' && (args[0] as string).includes('stopped with unsent'),
			);
			expect(stoppedCalls).toHaveLength(0);
		});

		it('STOP directive with null payload does not log or throw', () => {
			const mockWorker = makeMockWorker();
			const warnSpy = vi.mocked(console.warn);
			expect(() => mockWorker.onmessage!({ data: { directive: 'STOP', payload: null } })).not.toThrow();
			const stoppedCalls = warnSpy.mock.calls.filter(
				(args) => typeof args[0] === 'string' && (args[0] as string).includes('stopped with unsent'),
			);
			expect(stoppedCalls).toHaveLength(0);
		});

		it('STOP directive with payload missing the lost field uses empty fallback', () => {
			const mockWorker = makeMockWorker();
			const warnSpy = vi.mocked(console.warn);
			// payload is an object but has no `lost` property — exercises the `?? {}` fallback
			expect(() => mockWorker.onmessage!({ data: { directive: 'STOP', payload: { other: 'data' } } })).not.toThrow();
			const stoppedCalls = warnSpy.mock.calls.filter(
				(args) => typeof args[0] === 'string' && (args[0] as string).includes('stopped with unsent'),
			);
			expect(stoppedCalls).toHaveLength(0);
		});
	});

	describe('resolveTransport', () => {
		it('auto resolves to fetch on Lambda (AWS_LAMBDA_FUNCTION_NAME set)', async () => {
			const original = process.env['AWS_LAMBDA_FUNCTION_NAME'];
			process.env['AWS_LAMBDA_FUNCTION_NAME'] = 'my-lambda-fn';
			resetRegistry();

			const ref = getOrCreateWorker('auto');
			ref.register('runtime', { endpoint: 'https://logs.test/rt', headers: {}, batchSize: 1, flushInterval: 0 });
			ref.send(makeEvent());

			await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());

			if (original === undefined) delete process.env['AWS_LAMBDA_FUNCTION_NAME'];
			else process.env['AWS_LAMBDA_FUNCTION_NAME'] = original;
		});

		it('auto resolves to node-worker in a standard Node.js environment', async () => {
			// process.versions.node is defined + no Lambda env var → node-worker
			const ref = getOrCreateWorker('auto');
			await new Promise((r) => setTimeout(r, 10));
			ref.send(makeEvent());
			expect(capturedNodeWorker!.postMessage).toHaveBeenCalledOnce();
		});

		it('auto resolves to web-worker when process is absent and globalThis.Worker is defined', () => {
			let capturedWkr: { onerror: unknown; onmessage: unknown } | null = null;
			class MockWorker {
				onmessage: unknown = null;
				onerror: unknown = null;
				postMessage = vi.fn();
				terminate = vi.fn();
				constructor(_url: URL, _opts?: unknown) {
					capturedWkr = this as unknown as typeof capturedWkr;
				}
			}
			(globalThis as Record<string, unknown>).Worker = MockWorker;
			const savedProcess = (globalThis as Record<string, unknown>).process;
			(globalThis as Record<string, unknown>).process = undefined;
			const ref = getOrCreateWorker('auto');
			(globalThis as Record<string, unknown>).process = savedProcess;
			delete (globalThis as Record<string, unknown>).Worker;

			expect(capturedWkr).not.toBeNull(); // initBrowserWorker ran → web-worker path taken
			expect(() => ref.send(makeEvent())).not.toThrow();
		});

		it('auto resolves to fetch when process is absent and globalThis.Worker is absent', () => {
			const savedProcess = (globalThis as Record<string, unknown>).process;
			(globalThis as Record<string, unknown>).process = undefined;
			const ref = getOrCreateWorker('auto');
			(globalThis as Record<string, unknown>).process = savedProcess;

			ref.register('runtime', { endpoint: 'https://logs.test/rt', headers: {}, batchSize: 1, flushInterval: 0 });
			ref.send(makeEvent());
			// transport=fetch, so send goes directly through fetch
			return vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
		});
	});
});
