import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerAckMessage, WorkerMessage } from './shared.js';
import { createWorkerLogic } from './shared.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PROVIDER = 'runtime';
const BASE_CFG = {
	endpoint: 'https://logs.test/rt',
	headers: { 'X-Api-Key': 'abc' },
	batchSize: 2,
	flushInterval: 0,
};

function makeLogic() {
	const acks: WorkerAckMessage[] = [];
	const { handleMessage } = createWorkerLogic((msg) => acks.push(msg));
	return { acks, handle: handleMessage };
}

// ===========================================================================
// UNIT TESTS — pure directive logic, no real I/O
// ===========================================================================

describe('Unit Tests', () => {
	let acks: WorkerAckMessage[];
	let handle: (msg: WorkerMessage) => Promise<void>;

	beforeEach(() => {
		({ acks, handle } = makeLogic());
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' }));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	// ── CONFIG ─────────────────────────────────────────────────────────────────

	describe('CONFIG directive', () => {
		it('initializes a provider without a timer when flushInterval is 0', async () => {
			await handle({ directive: 'CONFIG', provider: PROVIDER, payload: BASE_CFG });
			expect(acks).toHaveLength(0);
		});

		it('starts a periodic timer when flushInterval > 0', async () => {
			vi.useFakeTimers();
			const fetchMock = vi.fn().mockResolvedValue({ ok: true });
			vi.stubGlobal('fetch', fetchMock);

			await handle({
				directive: 'CONFIG',
				provider: PROVIDER,
				payload: { ...BASE_CFG, flushInterval: 100, batchSize: 100 },
			});
			await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'a' } });
			await vi.advanceTimersByTimeAsync(150);

			expect(fetchMock).toHaveBeenCalledOnce();
		});

		it('clears the old timer when the same provider is re-configured', async () => {
			vi.useFakeTimers();
			const fetchMock = vi.fn().mockResolvedValue({ ok: true });
			vi.stubGlobal('fetch', fetchMock);

			await handle({
				directive: 'CONFIG',
				provider: PROVIDER,
				payload: { ...BASE_CFG, flushInterval: 100, batchSize: 100 },
			});
			await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'first' } });
			// Re-configure — old 100 ms timer must be cancelled
			await handle({
				directive: 'CONFIG',
				provider: PROVIDER,
				payload: { ...BASE_CFG, flushInterval: 500, batchSize: 100 },
			});
			await vi.advanceTimersByTimeAsync(150);

			expect(fetchMock).not.toHaveBeenCalled();
		});

		it('is a no-op when provider is omitted', async () => {
			await handle({ directive: 'CONFIG', payload: BASE_CFG } as WorkerMessage);
			expect(acks).toHaveLength(0);
		});

		it('preserves existing buffer when re-configured', async () => {
			await handle({ directive: 'CONFIG', provider: PROVIDER, payload: { ...BASE_CFG, batchSize: 100 } });
			await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'buffered' } });
			// Re-configure with same provider; batchSize becomes 1 to trigger flush
			await handle({ directive: 'CONFIG', provider: PROVIDER, payload: { ...BASE_CFG, batchSize: 1 } });
			// The re-queued event from the original buffer should now flush
			await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'trigger' } });
			expect(vi.mocked(fetch)).toHaveBeenCalled();
		});
	});

	// ── LOG ────────────────────────────────────────────────────────────────────

	describe('LOG directive', () => {
		it('buffers an event without flushing when below batchSize', async () => {
			await handle({ directive: 'CONFIG', provider: PROVIDER, payload: BASE_CFG });
			await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'one' } });
			expect(vi.mocked(fetch)).not.toHaveBeenCalled();
		});

		it('auto-flushes when batchSize is reached', async () => {
			await handle({ directive: 'CONFIG', provider: PROVIDER, payload: BASE_CFG }); // batchSize=2
			await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'a' } });
			await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'b' } });
			expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
		});

		it('sends all buffered events as a single array on auto-flush', async () => {
			await handle({ directive: 'CONFIG', provider: PROVIDER, payload: BASE_CFG });
			await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'a' } });
			await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'b' } });

			const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string) as unknown[];
			expect(body).toHaveLength(2);
		});

		it('is a no-op for an unconfigured provider', async () => {
			await handle({ directive: 'LOG', provider: 'ghost', payload: { msg: 'x' } });
			expect(vi.mocked(fetch)).not.toHaveBeenCalled();
		});

		it('is a no-op when provider is omitted', async () => {
			await handle({ directive: 'LOG', payload: { msg: 'x' } } as WorkerMessage);
			expect(vi.mocked(fetch)).not.toHaveBeenCalled();
		});
	});

	// ── FLUSH ──────────────────────────────────────────────────────────────────

	describe('FLUSH directive', () => {
		it('sends buffered events for a named provider', async () => {
			await handle({ directive: 'CONFIG', provider: PROVIDER, payload: BASE_CFG });
			await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'a' } });
			await handle({ directive: 'FLUSH', provider: PROVIDER });
			expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
		});

		it('flushes all configured providers when no provider is given', async () => {
			await handle({ directive: 'CONFIG', provider: 'p1', payload: BASE_CFG });
			await handle({ directive: 'CONFIG', provider: 'p2', payload: { ...BASE_CFG, endpoint: 'https://logs.test/p2' } });
			await handle({ directive: 'LOG', provider: 'p1', payload: { msg: 'a' } });
			await handle({ directive: 'LOG', provider: 'p2', payload: { msg: 'b' } });
			await handle({ directive: 'FLUSH' });
			expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
		});

		it('is a no-op for an empty buffer', async () => {
			await handle({ directive: 'CONFIG', provider: PROVIDER, payload: BASE_CFG });
			await handle({ directive: 'FLUSH', provider: PROVIDER });
			expect(vi.mocked(fetch)).not.toHaveBeenCalled();
		});
	});

	// ── STOP ───────────────────────────────────────────────────────────────────

	describe('STOP directive', () => {
		it('posts a STOP ack with an empty lost map when all buffers are clear', async () => {
			await handle({ directive: 'CONFIG', provider: PROVIDER, payload: BASE_CFG });
			await handle({ directive: 'STOP' });

			expect(acks).toHaveLength(1);
			expect(acks[0]!.directive).toBe('STOP');
			const lost = (acks[0]!.payload as { lost: Record<string, number> }).lost;
			expect(Object.keys(lost)).toHaveLength(0);
		});

		it('reports unflushed event counts in the lost map', async () => {
			await handle({ directive: 'CONFIG', provider: PROVIDER, payload: BASE_CFG });
			await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'unsent' } });
			await handle({ directive: 'STOP' });

			const lost = (acks[0]!.payload as { lost: Record<string, number> }).lost;
			expect(lost[PROVIDER]).toBe(1);
		});

		it('clears active timers before reporting lost events', async () => {
			vi.useFakeTimers();
			await handle({
				directive: 'CONFIG',
				provider: PROVIDER,
				payload: { ...BASE_CFG, flushInterval: 1000, batchSize: 100 },
			});
			await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'buffered' } });
			await handle({ directive: 'STOP' });

			await vi.advanceTimersByTimeAsync(2000);
			expect(vi.mocked(fetch)).not.toHaveBeenCalled();
			expect(acks[0]!.directive).toBe('STOP');
		});
	});
});

// ===========================================================================
// INTEGRATION TESTS — fetch interaction and error edge-cases
// ===========================================================================

describe('Integration Tests', () => {
	let acks: WorkerAckMessage[];
	let handle: (msg: WorkerMessage) => Promise<void>;

	beforeEach(() => {
		({ acks, handle } = makeLogic());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	describe('createWorkerLogic', () => {
		describe('fetch error handling', () => {
			it('re-queues batch and posts ERROR ack on network failure', async () => {
				vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
				await handle({ directive: 'CONFIG', provider: PROVIDER, payload: BASE_CFG });
				await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'a' } });
				await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'b' } });

				await vi.waitFor(() => expect(acks).toHaveLength(1));
				expect(acks[0]!.directive).toBe('ERROR');
				expect(acks[0]!.provider).toBe(PROVIDER);
				expect((acks[0]!.payload as { buffered: number }).buffered).toBe(2);
			});

			it('re-queues batch and posts ERROR ack on non-2xx response', async () => {
				vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' }));
				await handle({ directive: 'CONFIG', provider: PROVIDER, payload: BASE_CFG });
				await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'a' } });
				await handle({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'b' } });

				await vi.waitFor(() => expect(acks).toHaveLength(1));
				expect(acks[0]!.directive).toBe('ERROR');
			});
		});

		describe('outer catch', () => {
			it('posts ERROR ack without provider when an unexpected error occurs during STOP', async () => {
				vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
				vi.useFakeTimers();
				await handle({
					directive: 'CONFIG',
					provider: PROVIDER,
					payload: { ...BASE_CFG, flushInterval: 100, batchSize: 100 },
				});
				vi.useRealTimers();

				// Mock clearInterval to throw — STOP will hit the outer catch
				vi.stubGlobal('clearInterval', () => {
					throw new Error('clearInterval failed');
				});
				await handle({ directive: 'STOP' });
				vi.unstubAllGlobals();

				expect(acks.some((a) => a.directive === 'ERROR' && a.provider === undefined)).toBe(true);
			});

			it('includes provider on ERROR ack when the error occurs during CONFIG (has a provider)', async () => {
				vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
				vi.useFakeTimers();
				await handle({
					directive: 'CONFIG',
					provider: PROVIDER,
					payload: { ...BASE_CFG, flushInterval: 100, batchSize: 100 },
				});
				vi.useRealTimers();

				// Re-CONFIG triggers clearInterval of the existing timer → throws → outer catch with provider
				vi.stubGlobal('clearInterval', () => {
					throw new Error('clearInterval boom');
				});
				await handle({
					directive: 'CONFIG',
					provider: PROVIDER,
					payload: { ...BASE_CFG, flushInterval: 200, batchSize: 100 },
				});
				vi.unstubAllGlobals();

				expect(acks.some((a) => a.directive === 'ERROR' && a.provider === PROVIDER)).toBe(true);
			});
		});

		describe('periodic flush', () => {
			it('flushes buffered events automatically after flushInterval elapses', async () => {
				vi.useFakeTimers();
				const fetchMock = vi.fn().mockResolvedValue({ ok: true });
				vi.stubGlobal('fetch', fetchMock);
				const { handle: h } = makeLogic();

				await h({
					directive: 'CONFIG',
					provider: PROVIDER,
					payload: { ...BASE_CFG, flushInterval: 200, batchSize: 100 },
				});
				await h({ directive: 'LOG', provider: PROVIDER, payload: { msg: 'timed' } });
				await vi.advanceTimersByTimeAsync(250);

				expect(fetchMock).toHaveBeenCalledOnce();
			});
		});
	});
});
