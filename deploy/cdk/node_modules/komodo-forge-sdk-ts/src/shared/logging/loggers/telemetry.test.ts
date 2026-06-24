import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseLogEvent } from '../common/base.js';
import { resetRegistry } from '../common/worker/registry.js';
import TelemetryLogger from './telemetry.js';

const BASE_CFG = {
	service: 'test-svc',
	version: '1.0.0',
	env: 'development',
	transport: 'fetch' as const,
};

function resetAll(): void {
	resetRegistry();
	TelemetryLogger._reset();
}

// ===========================================================================
// UNIT TESTS — trace() behaviour
// ===========================================================================

describe('Unit Tests', () => {
	let spyDebug: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetAll();
		spyDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		resetAll();
	});

	describe('trace()', () => {
		it('outputs [TELEMETRY] and the metric name to console.debug', () => {
			const logger = new TelemetryLogger(BASE_CFG);
			logger.trace('api.call.duration');
			expect(spyDebug).toHaveBeenCalledOnce();
			expect(spyDebug.mock.calls[0]![0]).toContain('[TELEMETRY]');
			expect(spyDebug.mock.calls[0]![0]).toContain('api.call.duration');
		});

		it('includes numeric attributes in console output', () => {
			const logger = new TelemetryLogger(BASE_CFG);
			logger.trace('render', { duration: 120, component: 'ProductPage' });
			expect(spyDebug.mock.calls[0]![0]).toContain('120');
		});

		it('accepts traceId and spanId without throwing', () => {
			const logger = new TelemetryLogger(BASE_CFG);
			expect(() => logger.trace('span', { traceId: 't1', spanId: 's1' })).not.toThrow();
		});

		it('accepts requestId without throwing', () => {
			const logger = new TelemetryLogger(BASE_CFG);
			expect(() => logger.trace('span', {}, 'req-001')).not.toThrow();
		});

		it('production env: no console.debug output', () => {
			const logger = new TelemetryLogger({ ...BASE_CFG, env: 'production' });
			logger.trace('something');
			expect(spyDebug).not.toHaveBeenCalled();
		});
	});
});

// ===========================================================================
// COMPONENT TESTS — class-level concerns (singleton, verbose mode)
// ===========================================================================

describe('Component Tests', () => {
	beforeEach(() => {
		resetAll();
		vi.spyOn(console, 'debug').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		resetAll();
	});

	describe('TelemetryLogger', () => {
		it('constructs without throwing', () => {
			expect(() => new TelemetryLogger(BASE_CFG)).not.toThrow();
		});

		it('returns the same instance on repeated construction (singleton)', () => {
			const a = new TelemetryLogger(BASE_CFG);
			const b = new TelemetryLogger({ ...BASE_CFG, service: 'other' });
			expect(a).toBe(b);
		});

		it('_reset() causes the next constructor call to return a new instance', () => {
			const a = new TelemetryLogger(BASE_CFG);
			TelemetryLogger._reset();
			resetRegistry();
			const b = new TelemetryLogger({ ...BASE_CFG, service: 'svc-b' });
			expect(a).not.toBe(b);
		});

		it('flush() and stop() do not throw', () => {
			const logger = new TelemetryLogger(BASE_CFG);
			expect(() => {
				logger.flush();
				logger.stop();
			}).not.toThrow();
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
		vi.spyOn(console, 'debug').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		resetAll();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		resetAll();
	});

	describe('TelemetryLogger', () => {
		it('ships a trace event to the remote endpoint', async () => {
			const logger = new TelemetryLogger({
				...BASE_CFG,
				endpoint: 'https://logs.example.com/telemetry',
			});
			logger.trace('page.load', { duration: 250 });

			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe('https://logs.example.com/telemetry');

			const payload = JSON.parse(init.body as string) as BaseLogEvent;
			expect(payload.type).toBe('telemetry');
			expect(payload.message).toBe('page.load');
		});

		it('no fetch call when no endpoint is configured', async () => {
			const logger = new TelemetryLogger(BASE_CFG);
			logger.trace('metric');
			await new Promise((r) => setTimeout(r, 30));
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('sensitive fields in attributes are redacted before shipping', async () => {
			const logger = new TelemetryLogger({
				...BASE_CFG,
				endpoint: 'https://logs.example.com/telemetry',
			});
			logger.trace('auth.check', { token: 'secret-jwt', duration: 50 } as Record<string, unknown>);

			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
			const payload = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
				details: Record<string, unknown>;
			};

			expect(payload.details['token']).toBe('[REDACTED]');
			expect(payload.details['duration']).toBe(50);
		});

		it('requestId is included in the shipped event when provided', async () => {
			const logger = new TelemetryLogger({
				...BASE_CFG,
				endpoint: 'https://logs.example.com/telemetry',
			});
			logger.trace('span', {}, 'req-telem-001');

			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
			const payload = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as BaseLogEvent;
			expect(payload.requestId).toBe('req-telem-001');
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

				new TelemetryLogger({ service: 'test-svc', version: '1.0.0', env: 'development', transport: 'web-worker' });

				capturedWorker.onerror!({ message: 'worker crashed' });
				expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
					'[TelemetryLogger] worker degraded, falling back to fetch:',
					'worker crashed',
				);
			});
		});

		it('ships events from both RuntimeLogger and TelemetryLogger when sharing the registry', async () => {
			const { default: RuntimeLogger } = await import('./runtime.js');
			RuntimeLogger._reset();

			const runtime = new RuntimeLogger({
				...BASE_CFG,
				endpoint: 'https://logs.example.com/runtime',
				level: 'warn',
			});
			TelemetryLogger._reset();
			const telemetry = new TelemetryLogger({ ...BASE_CFG, endpoint: 'https://logs.example.com/telemetry' });

			runtime.warn('event A');
			telemetry.trace('span B');

			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
			const urls = fetchMock.mock.calls.map(([url]: [string]) => url);
			expect(urls).toContain('https://logs.example.com/runtime');
			expect(urls).toContain('https://logs.example.com/telemetry');

			RuntimeLogger._reset();
		});
	});
});
