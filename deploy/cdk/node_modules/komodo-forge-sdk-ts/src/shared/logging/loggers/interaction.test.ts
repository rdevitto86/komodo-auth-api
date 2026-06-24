import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseLogEvent } from '../common/base.js';
import { resetRegistry } from '../common/worker/registry.js';
import InteractionLogger from './interaction.js';

const BASE_CFG = {
	service: 'test-svc',
	version: '1.0.0',
	env: 'development',
	transport: 'fetch' as const,
};

function resetAll(): void {
	resetRegistry();
	InteractionLogger._reset();
}

function stubBrowserEnv(): void {
	(globalThis as Record<string, unknown>).window = {};
	(globalThis as Record<string, unknown>).location = { href: 'https://app.example.com/checkout' };
}

function cleanBrowserEnv(): void {
	delete (globalThis as Record<string, unknown>).window;
	delete (globalThis as Record<string, unknown>).location;
}

// ===========================================================================
// UNIT TESTS — track() behaviour
// ===========================================================================

describe('Unit Tests', () => {
	let spyDebug: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetAll();
		stubBrowserEnv();
		spyDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		cleanBrowserEnv();
		resetAll();
	});

	describe('track()', () => {
		it('outputs [INTERACTION] and the action name to console.debug', () => {
			const logger = new InteractionLogger(BASE_CFG);
			logger.track('user:login');
			expect(spyDebug).toHaveBeenCalledOnce();
			expect(spyDebug.mock.calls[0]![0]).toContain('[INTERACTION]');
			expect(spyDebug.mock.calls[0]![0]).toContain('user:login');
		});

		it('accepts data payload without throwing', () => {
			const logger = new InteractionLogger(BASE_CFG);
			expect(() => logger.track('add:to:cart', { productId: 'p-100', qty: 1 })).not.toThrow();
		});

		it('accepts requestId without throwing', () => {
			const logger = new InteractionLogger(BASE_CFG);
			expect(() => logger.track('checkout', undefined, 'req-789')).not.toThrow();
		});

		it('url falls back to empty string when location has no href property', () => {
			// Override location to have no href — exercises the `?? ''` fallback
			(globalThis as Record<string, unknown>).location = {};
			const logger = new InteractionLogger(BASE_CFG);
			expect(() => logger.track('some:action')).not.toThrow();
			expect(spyDebug.mock.calls[0]![0]).toBeDefined(); // still logs
		});

		it('production env: no console.debug output', () => {
			const logger = new InteractionLogger({ ...BASE_CFG, env: 'production' });
			logger.track('some:action');
			expect(spyDebug).not.toHaveBeenCalled();
		});
	});
});

// ===========================================================================
// COMPONENT TESTS — class-level concerns (singleton, enabled/disabled)
// ===========================================================================

describe('Component Tests', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		cleanBrowserEnv();
		resetAll();
	});

	describe('InteractionLogger (Node — disabled)', () => {
		beforeEach(() => {
			resetAll();
			vi.spyOn(console, 'debug').mockImplementation(() => {});
			vi.spyOn(console, 'warn').mockImplementation(() => {});
		});

		it('constructs without throwing in a non-browser environment', () => {
			expect(() => new InteractionLogger(BASE_CFG)).not.toThrow();
		});

		it('track() is a no-op when window is absent', () => {
			const logger = new InteractionLogger(BASE_CFG);
			logger.track('user:login');
			expect(vi.mocked(console.debug)).not.toHaveBeenCalled();
		});

		it('returns the same instance on repeated construction (singleton)', () => {
			const a = new InteractionLogger(BASE_CFG);
			const b = new InteractionLogger({ ...BASE_CFG, service: 'other' });
			expect(a).toBe(b);
		});

		it('flush() and stop() do not throw', () => {
			const logger = new InteractionLogger(BASE_CFG);
			expect(() => {
				logger.flush();
				logger.stop();
			}).not.toThrow();
		});
	});

	describe('InteractionLogger (browser — enabled)', () => {
		let spyDebug: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			resetAll();
			stubBrowserEnv();
			spyDebug = vi.spyOn(console, 'debug').mockImplementation(() => {});
			vi.spyOn(console, 'warn').mockImplementation(() => {});
			vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
		});

		afterEach(() => {
			vi.unstubAllGlobals();
		});

		it('track() calls console.debug when verbose (dev env)', () => {
			const logger = new InteractionLogger(BASE_CFG);
			logger.track('user:login');
			expect(spyDebug).toHaveBeenCalledOnce();
		});

		it('_reset() causes the next constructor call to return a new instance', () => {
			const a = new InteractionLogger(BASE_CFG);
			InteractionLogger._reset();
			resetRegistry();
			const b = new InteractionLogger({ ...BASE_CFG, service: 'svc-b' });
			expect(a).not.toBe(b);
		});
	});
});

// ===========================================================================
// INTEGRATION TESTS — fetch transport pipeline (browser env)
// ===========================================================================

describe('Integration Tests', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
		vi.stubGlobal('fetch', fetchMock);
		vi.spyOn(console, 'debug').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		stubBrowserEnv();
		resetAll();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		cleanBrowserEnv();
		resetAll();
	});

	describe('InteractionLogger', () => {
		it('uses default batchSize (10) when not specified', async () => {
			const logger = new InteractionLogger({
				...BASE_CFG,
				endpoint: 'https://logs.example.com/interaction',
				// no batchSize — exercises the `?? 10` default branch
			});
			logger.track('some:action');
			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		});

		it('custom headers are forwarded on every request', async () => {
			const logger = new InteractionLogger({
				...BASE_CFG,
				endpoint: 'https://logs.example.com/interaction',
				batchSize: 1,
				headers: { 'X-Tenant': 'acme' },
			});
			logger.track('user:purchase', { orderId: 'ord-42' });

			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
			const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
			expect(headers['X-Tenant']).toBe('acme');
		});

		it('ships an interaction event to the configured endpoint', async () => {
			const logger = new InteractionLogger({
				...BASE_CFG,
				endpoint: 'https://logs.example.com/interaction',
				batchSize: 1,
			});
			logger.track('user:purchase', { orderId: 'ord-42' });

			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe('https://logs.example.com/interaction');

			const payload = JSON.parse(init.body as string) as BaseLogEvent;
			expect(payload.type).toBe('interaction');
			expect(payload.message).toBe('user:purchase');
		});

		it('does not ship events when no endpoint is configured', async () => {
			const logger = new InteractionLogger(BASE_CFG);
			logger.track('some:action');
			await new Promise((r) => setTimeout(r, 30));
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('does not ship events in Node env (window absent)', async () => {
			cleanBrowserEnv();
			InteractionLogger._reset();
			resetRegistry();
			const logger = new InteractionLogger({
				...BASE_CFG,
				endpoint: 'https://logs.example.com/interaction',
				batchSize: 1,
			});
			logger.track('some:action');
			await new Promise((r) => setTimeout(r, 30));
			expect(fetchMock).not.toHaveBeenCalled();
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
				stubBrowserEnv();

				new InteractionLogger({ service: 'test-svc', version: '1.0.0', env: 'development', transport: 'web-worker' });

				capturedWorker.onerror!({ message: 'worker crashed' });
				expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
					'[InteractionLogger] worker degraded, falling back to fetch:',
					'worker crashed',
				);
			});
		});
	});
});
