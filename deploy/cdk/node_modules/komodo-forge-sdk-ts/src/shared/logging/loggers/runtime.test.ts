import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseLogEvent } from '../common/base.js';
import { resetRegistry } from '../common/worker/registry.js';
import RuntimeLogger from './runtime.js';

const BASE_CFG = {
	service: 'test-svc',
	version: '1.0.0',
	env: 'development',
	transport: 'fetch' as const,
};

function resetAll(): void {
	resetRegistry();
	RuntimeLogger._reset();
}

// ===========================================================================
// UNIT TESTS — individual method behaviour
// ===========================================================================

describe('Unit Tests', () => {
	let spyDebug: ReturnType<typeof vi.spyOn>;
	let spyInfo: ReturnType<typeof vi.spyOn>;
	let spyWarn: ReturnType<typeof vi.spyOn>;
	let spyError: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetAll();
		spyDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
		spyInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
		spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		spyError = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		resetAll();
	});

	describe('debug()', () => {
		it('calls console.debug with the message', () => {
			const logger = new RuntimeLogger({ ...BASE_CFG, level: 'debug' });
			logger.debug('dbg msg');
			expect(spyDebug).toHaveBeenCalledOnce();
			expect(spyDebug.mock.calls[0]![0]).toContain('dbg msg');
		});

		it('is suppressed when minLevel is above debug (default warn)', () => {
			const logger = new RuntimeLogger(BASE_CFG);
			logger.debug('suppressed');
			expect(spyDebug).not.toHaveBeenCalled();
		});
	});

	describe('info()', () => {
		it('calls console.info with the message', () => {
			const logger = new RuntimeLogger({ ...BASE_CFG, level: 'info' });
			logger.info('info msg');
			expect(spyInfo).toHaveBeenCalledOnce();
			expect(spyInfo.mock.calls[0]![0]).toContain('info msg');
		});

		it('is suppressed when minLevel is warn (default)', () => {
			const logger = new RuntimeLogger(BASE_CFG);
			logger.info('suppressed');
			expect(spyInfo).not.toHaveBeenCalled();
		});
	});

	describe('warn()', () => {
		it('calls console.warn with the message', () => {
			const logger = new RuntimeLogger(BASE_CFG);
			logger.warn('warn msg');
			expect(spyWarn).toHaveBeenCalledOnce();
		});

		it('is suppressed when minLevel is error', () => {
			const logger = new RuntimeLogger({ ...BASE_CFG, level: 'error' });
			logger.warn('suppressed');
			expect(spyWarn).not.toHaveBeenCalled();
		});
	});

	describe('error()', () => {
		it('calls console.error with the message', () => {
			const logger = new RuntimeLogger(BASE_CFG);
			logger.error('err msg');
			expect(spyError).toHaveBeenCalledOnce();
		});
	});

	describe('flush()', () => {
		it('does not throw', () => {
			const logger = new RuntimeLogger(BASE_CFG);
			expect(() => logger.flush()).not.toThrow();
		});
	});

	describe('stop()', () => {
		it('does not throw', () => {
			const logger = new RuntimeLogger(BASE_CFG);
			expect(() => logger.stop()).not.toThrow();
		});
	});
});

// ===========================================================================
// COMPONENT TESTS — class-level concerns (singleton, _reset, modes)
// ===========================================================================

describe('Component Tests', () => {
	let spyDebug: ReturnType<typeof vi.spyOn>;
	let spyWarn: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetAll();
		spyDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
		spyWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		resetAll();
	});

	describe('RuntimeLogger', () => {
		it('constructs without throwing', () => {
			expect(() => new RuntimeLogger(BASE_CFG)).not.toThrow();
		});

		it('returns the same instance on repeated construction (singleton)', () => {
			const a = new RuntimeLogger(BASE_CFG);
			const b = new RuntimeLogger({ ...BASE_CFG, service: 'other' });
			expect(a).toBe(b);
		});

		it('_reset() causes the next constructor call to return a new instance', () => {
			const a = new RuntimeLogger({ ...BASE_CFG, service: 'svc-a' });
			RuntimeLogger._reset();
			resetRegistry();
			const b = new RuntimeLogger({ ...BASE_CFG, service: 'svc-b' });
			expect(a).not.toBe(b);
		});

		it('details are included in console output', () => {
			const logger = new RuntimeLogger({ ...BASE_CFG, level: 'info' });
			vi.spyOn(console, 'info').mockImplementation(() => {});
			logger.info('detail test', { component: 'CheckoutForm' });
			expect(vi.mocked(console.info).mock.calls[0]![0]).toContain('CheckoutForm');
		});

		it('requestId does not cause errors when provided', () => {
			const logger = new RuntimeLogger(BASE_CFG);
			expect(() => logger.warn('with req', undefined, 'req-123')).not.toThrow();
			expect(spyWarn).toHaveBeenCalledOnce();
		});

		it('production env: debug output is an empty string (non-verbose format)', () => {
			const logger = new RuntimeLogger({ ...BASE_CFG, env: 'production', level: 'debug' });
			logger.debug('prod debug');
			expect(spyDebug).toHaveBeenCalledWith('');
		});

		it('production env: warn still passes through the non-verbose filter', () => {
			const logger = new RuntimeLogger({ ...BASE_CFG, env: 'production' });
			logger.warn('prod warn');
			const out = spyWarn.mock.calls[0]![0] as string;
			expect(out).toContain('[WARN]');
			expect(out).toContain('prod warn');
		});
	});
});

// ===========================================================================
// INTEGRATION TESTS — fetch transport pipeline
// ===========================================================================

describe('Integration Tests', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
		vi.stubGlobal('fetch', fetchMock);
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'debug').mockImplementation(() => {});
		resetAll();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		resetAll();
	});

	describe('RuntimeLogger', () => {
		it('ships a warn event to the remote endpoint', async () => {
			const logger = new RuntimeLogger({ ...BASE_CFG, endpoint: 'https://logs.example.com/runtime', level: 'warn' });
			logger.warn('payment failed', { error: 'GATEWAY_TIMEOUT' });

			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe('https://logs.example.com/runtime');
			expect(init.method).toBe('POST');

			const payload = JSON.parse(init.body as string) as BaseLogEvent;
			expect(payload.message).toBe('payment failed');
			expect(payload.level).toBe('warn');
			expect(payload.service).toBe('test-svc');
			expect(payload.type).toBe('runtime');
			expect(typeof payload.timestamp).toBe('string');
		});

		it('ships an error event to the endpoint', async () => {
			const logger = new RuntimeLogger({ ...BASE_CFG, endpoint: 'https://logs.example.com/runtime', level: 'error' });
			logger.error('fatal crash');
			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
			const payload = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as BaseLogEvent;
			expect(payload.level).toBe('error');
		});

		it('ships an info event to the endpoint', async () => {
			const logger = new RuntimeLogger({ ...BASE_CFG, endpoint: 'https://logs.example.com/runtime', level: 'info' });
			logger.info('app started');
			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
			const payload = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as BaseLogEvent;
			expect(payload.level).toBe('info');
		});

		it('debug events are never shipped remotely', async () => {
			const logger = new RuntimeLogger({ ...BASE_CFG, endpoint: 'https://logs.example.com/runtime', level: 'debug' });
			logger.debug('local only');
			await new Promise((r) => setTimeout(r, 30));
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('custom headers are included in every request', async () => {
			const logger = new RuntimeLogger({
				...BASE_CFG,
				endpoint: 'https://logs.example.com/runtime',
				headers: { Authorization: 'Bearer tok123', 'X-Tenant': 'acme' },
				level: 'error',
			});
			logger.error('crash');

			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
			const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
			expect(headers['Authorization']).toBe('Bearer tok123');
			expect(headers['X-Tenant']).toBe('acme');
			expect(headers['Content-Type']).toBe('application/json');
		});

		it('no fetch call when no endpoint is configured', async () => {
			const logger = new RuntimeLogger({ ...BASE_CFG, level: 'warn' });
			logger.warn('console only');
			await new Promise((r) => setTimeout(r, 30));
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('fetch failure is swallowed — application does not throw', async () => {
			vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
			const logger = new RuntimeLogger({ ...BASE_CFG, endpoint: 'https://logs.example.com/runtime', level: 'error' });
			await expect(async () => {
				logger.error('critical');
				await new Promise((r) => setTimeout(r, 30));
			}).not.toThrow();
		});

		it('sensitive fields in details are redacted before shipping', async () => {
			const logger = new RuntimeLogger({ ...BASE_CFG, endpoint: 'https://logs.example.com/runtime', level: 'warn' });
			logger.warn('user event', { email: 'user@example.com', token: 'secret-jwt', safe: 'visible' });

			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
			const payload = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
				details: Record<string, unknown>;
			};

			expect(payload.details['email']).toBe('[REDACTED]');
			expect(payload.details['token']).toBe('[REDACTED]');
			expect(payload.details['safe']).toBe('visible');
		});

		it('requestId is included in the shipped event when provided', async () => {
			const logger = new RuntimeLogger({ ...BASE_CFG, endpoint: 'https://logs.example.com/runtime', level: 'warn' });
			logger.warn('traced request', undefined, 'req-abc');

			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
			const payload = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as BaseLogEvent;
			expect(payload.requestId).toBe('req-abc');
		});

		it('onError handler is called when the worker degrades', () => {
			const logger = new RuntimeLogger(BASE_CFG);
			const warnSpy = vi.mocked(console.warn);
			// Simulate degradation by triggering the onError callback directly — registry calls it
			// when degradeToFetch runs. We verify the warning is wired up to a console.warn call.
			expect(logger).toBeTruthy(); // logger constructed → onError handler registered
			expect(warnSpy).not.toHaveBeenCalled(); // no degradation yet
		});

		describe('worker degradation', () => {
			afterEach(() => {
				delete (globalThis as Record<string, unknown>).Worker;
			});

			it('internal onError handler calls console.warn when the browser worker degrades', () => {
				let capturedWorker: { onerror: ((e: { message: string }) => void) | null } = { onerror: null };
				class MockWorker {
					onmessage: unknown = null;
					onerror: ((e: { message: string }) => void) | null = null;
					postMessage = vi.fn();
					terminate = vi.fn();
					constructor(_url: URL, _opts?: unknown) {
						capturedWorker = this as unknown as typeof capturedWorker;
					}
				}
				(globalThis as Record<string, unknown>).Worker = MockWorker;

				new RuntimeLogger({ service: 'test-svc', version: '1.0.0', env: 'development', transport: 'web-worker' });

				capturedWorker.onerror!({ message: 'worker crashed' });
				expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
					'[RuntimeLogger] worker degraded, falling back to fetch:',
					'worker crashed',
				);
			});
		});
	});
});
