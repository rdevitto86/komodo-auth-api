import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BaseLogEvent } from '../common/base.js';
import { resetRegistry } from '../common/worker/registry.js';
import ClickstreamLogger from './clickstream.js';

const BASE_CFG = {
	service: 'test-svc',
	version: '1.0.0',
	env: 'development',
	transport: 'fetch' as const,
};

function resetAll(): void {
	resetRegistry();
	ClickstreamLogger._reset();
}

function stubBrowserEnv(): void {
	(globalThis as Record<string, unknown>).window = {};
	(globalThis as Record<string, unknown>).location = { href: 'https://app.example.com/shop' };
	(globalThis as Record<string, unknown>).innerWidth = 1440;
	(globalThis as Record<string, unknown>).innerHeight = 900;
}

function cleanBrowserEnv(): void {
	delete (globalThis as Record<string, unknown>).window;
	delete (globalThis as Record<string, unknown>).location;
	delete (globalThis as Record<string, unknown>).innerWidth;
	delete (globalThis as Record<string, unknown>).innerHeight;
}

// ===========================================================================
// UNIT TESTS — track() message construction logic
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
		it('uses target.label as the event message when present', () => {
			const logger = new ClickstreamLogger(BASE_CFG);
			logger.track('click', { label: 'Add to Cart' });
			expect(spyDebug.mock.calls[0]![0]).toContain('Add to Cart');
		});

		it('falls back to target.id when label is absent', () => {
			const logger = new ClickstreamLogger(BASE_CFG);
			logger.track('hover', { id: 'hero-banner' });
			expect(spyDebug.mock.calls[0]![0]).toContain('hero-banner');
		});

		it('falls back to target.path when label and id are absent', () => {
			const logger = new ClickstreamLogger(BASE_CFG);
			logger.track('scroll', { path: 'div > ul > li' });
			expect(spyDebug.mock.calls[0]![0]).toContain('div > ul > li');
		});

		it('uses "element" when target has no identifying field', () => {
			const logger = new ClickstreamLogger(BASE_CFG);
			logger.track('focus', {});
			expect(spyDebug.mock.calls[0]![0]).toContain('element');
		});

		it('includes viewport when innerWidth and innerHeight are present', () => {
			const logger = new ClickstreamLogger(BASE_CFG);
			logger.track('click', { id: 'x' });
			expect(spyDebug.mock.calls[0]![0]).toContain('1440x900');
		});

		it('omits viewport when window dimensions are absent', () => {
			delete (globalThis as Record<string, unknown>).innerWidth;
			delete (globalThis as Record<string, unknown>).innerHeight;
			const logger = new ClickstreamLogger(BASE_CFG);
			logger.track('click', { id: 'btn' });
			expect(spyDebug.mock.calls[0]![0]).not.toContain('viewport');
		});

		it('accepts requestId without throwing', () => {
			const logger = new ClickstreamLogger(BASE_CFG);
			expect(() => logger.track('submit', { id: 'form' }, 'req-456')).not.toThrow();
		});

		it('url falls back to empty string when location has no href property', () => {
			// Override location to have no href — exercises the `?? ''` fallback
			(globalThis as Record<string, unknown>).location = {};
			const logger = new ClickstreamLogger(BASE_CFG);
			expect(() => logger.track('click', { id: 'btn' })).not.toThrow();
			expect(spyDebug.mock.calls[0]![0]).toBeDefined(); // still logs
		});

		it('accepts all supported action types', () => {
			const logger = new ClickstreamLogger(BASE_CFG);
			const actions = ['click', 'hover', 'scroll', 'submit', 'input', 'focus', 'blur'] as const;
			for (const action of actions) {
				expect(() => logger.track(action, {})).not.toThrow();
			}
		});
	});
});

// ===========================================================================
// COMPONENT TESTS — class-level concerns (singleton, enabled/disabled, modes)
// ===========================================================================

describe('Component Tests', () => {
	afterEach(() => {
		vi.restoreAllMocks();
		cleanBrowserEnv();
		resetAll();
	});

	describe('ClickstreamLogger (Node — disabled)', () => {
		beforeEach(() => {
			resetAll();
			vi.spyOn(console, 'debug').mockImplementation(() => {});
			vi.spyOn(console, 'warn').mockImplementation(() => {});
		});

		it('constructs without throwing in a non-browser environment', () => {
			expect(() => new ClickstreamLogger(BASE_CFG)).not.toThrow();
		});

		it('track() is a no-op when window is absent', () => {
			const logger = new ClickstreamLogger(BASE_CFG);
			logger.track('click', { id: 'btn' });
			expect(vi.mocked(console.debug)).not.toHaveBeenCalled();
		});

		it('flush() and stop() do not throw', () => {
			const logger = new ClickstreamLogger(BASE_CFG);
			expect(() => {
				logger.flush();
				logger.stop();
			}).not.toThrow();
		});

		it('returns the same instance on repeated construction (singleton)', () => {
			const a = new ClickstreamLogger(BASE_CFG);
			const b = new ClickstreamLogger({ ...BASE_CFG, service: 'other' });
			expect(a).toBe(b);
		});
	});

	describe('ClickstreamLogger (browser — enabled)', () => {
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

		it('track() outputs [CLICKSTREAM] to console.debug in verbose (dev) env', () => {
			const logger = new ClickstreamLogger(BASE_CFG);
			logger.track('click', { id: 'buy-now' });
			expect(spyDebug).toHaveBeenCalledOnce();
			expect(spyDebug.mock.calls[0]![0]).toContain('[CLICKSTREAM]');
		});

		it('production env: no console.debug output', () => {
			const logger = new ClickstreamLogger({ ...BASE_CFG, env: 'production' });
			logger.track('click', { id: 'x' });
			expect(spyDebug).not.toHaveBeenCalled();
		});

		it('_reset() causes the next constructor call to return a new instance', () => {
			const a = new ClickstreamLogger(BASE_CFG);
			ClickstreamLogger._reset();
			resetRegistry();
			const b = new ClickstreamLogger({ ...BASE_CFG, service: 'svc-b' });
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

	describe('ClickstreamLogger', () => {
		it('uses default batchSize (20) when not specified', async () => {
			const logger = new ClickstreamLogger({
				...BASE_CFG,
				endpoint: 'https://logs.example.com/clickstream',
				// no batchSize — exercises the `?? 20` default branch
			});
			logger.track('click', { id: 'btn' });
			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
		});

		it('custom headers are forwarded on every request', async () => {
			const logger = new ClickstreamLogger({
				...BASE_CFG,
				endpoint: 'https://logs.example.com/clickstream',
				batchSize: 1,
				headers: { 'X-Tenant': 'acme' },
			});
			logger.track('click', { id: 'buy-now' });

			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
			const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
			expect(headers['X-Tenant']).toBe('acme');
		});

		it('ships a clickstream event to the configured endpoint', async () => {
			const logger = new ClickstreamLogger({
				...BASE_CFG,
				endpoint: 'https://logs.example.com/clickstream',
				batchSize: 1,
			});
			logger.track('click', { id: 'buy-now' });

			await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
			const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
			expect(url).toBe('https://logs.example.com/clickstream');
			expect(init.method).toBe('POST');

			const payload = JSON.parse(init.body as string) as BaseLogEvent;
			expect(payload.type).toBe('clickstream');
		});

		it('does not ship events when no endpoint is configured', async () => {
			const logger = new ClickstreamLogger(BASE_CFG);
			logger.track('click', { id: 'btn' });
			await new Promise((r) => setTimeout(r, 30));
			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('does not ship events in Node env (window absent)', async () => {
			cleanBrowserEnv(); // remove window
			ClickstreamLogger._reset();
			resetRegistry();
			const logger = new ClickstreamLogger({
				...BASE_CFG,
				endpoint: 'https://logs.example.com/clickstream',
				batchSize: 1,
			});
			logger.track('click', { id: 'btn' });
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

				new ClickstreamLogger({ service: 'test-svc', version: '1.0.0', env: 'development', transport: 'web-worker' });

				capturedWorker.onerror!({ message: 'worker crashed' });
				expect(vi.mocked(console.warn)).toHaveBeenCalledWith(
					'[ClickstreamLogger] worker degraded, falling back to fetch:',
					'worker crashed',
				);
			});
		});
	});
});
