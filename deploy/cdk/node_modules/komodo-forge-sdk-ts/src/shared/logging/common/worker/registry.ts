// Singleton worker registry — anchored on globalThis via Symbol.for so the same instance
// is returned regardless of how many times the SDK module is loaded (e.g. local path alias
// vs node_modules copy of the same package).
//
// The first logger to call getOrCreateWorker() creates the worker thread. Every subsequent
// caller — regardless of which logger class it is — gets a WorkerRef backed by the same thread.

import type { BaseLogEvent, LogEventType, Transport } from '../base.js';
import type { WorkerAckMessage, WorkerMessage } from './shared/shared.js';

// Bump the version suffix if the registry's internal shape ever breaks across releases.
const REGISTRY_KEY = Symbol.for('komodo.forge.logger.worker.v1');

type WorkerState = 'starting' | 'ready' | 'degraded' | 'stopped';

type WorkerLike = {
	postMessage(data: unknown): void;
	terminate?(): void | Promise<number>;
};

interface ProviderCfg {
	endpoint: string;
	headers: Record<string, string>;
	batchSize: number;
	flushInterval: number;
}

interface WorkerRegistry {
	state: WorkerState;
	transport: Exclude<Transport, 'auto'>;
	worker: WorkerLike | null;
	pending: WorkerMessage[];
	providers: Map<LogEventType, ProviderCfg>;
	errorHandlers: Set<(err: Error) => void>;
}

// --- WorkerRef ------------------------------------------------------------------

/**
 * Thin proxy returned to each logger class. All methods route through the shared registry.
 * Degradation (worker → fetch) is transparent — callers do not need to check worker state.
 */
export interface WorkerRef {
	register(
		type: LogEventType,
		cfg: {
			endpoint: string;
			headers: Record<string, string>;
			batchSize: number;
			flushInterval: number;
		},
	): void;
	send(event: BaseLogEvent): void;
	flush(type?: LogEventType): void;
	stop(): void;
	/** Subscribe to worker errors. Returns an unsubscribe function. */
	onError(handler: (err: Error) => void): () => void;
}

// --- Registry access ------------------------------------------------------------

function getRegistry(): WorkerRegistry {
	const g = globalThis as Record<symbol, WorkerRegistry | undefined>;
	if (!g[REGISTRY_KEY]) {
		g[REGISTRY_KEY] = {
			state: 'starting',
			transport: 'fetch',
			worker: null,
			pending: [],
			providers: new Map(),
			errorHandlers: new Set(),
		};
	}
	return g[REGISTRY_KEY]!;
}

// --- Transport resolution -------------------------------------------------------

function resolveTransport(t: Transport): Exclude<Transport, 'auto'> {
	if (t !== 'auto') return t;
	if (typeof process !== 'undefined') {
		if (typeof process.env['AWS_LAMBDA_FUNCTION_NAME'] === 'string') return 'fetch';
		/* istanbul ignore else -- process.versions.node is always defined in Node.js test environments */
		if (process.versions?.node !== undefined) return 'node-worker';
	}
	if ((globalThis as Record<string, unknown>)['Worker'] !== undefined) return 'web-worker';
	return 'fetch';
}

// --- Dispatch -------------------------------------------------------------------

function dispatch(reg: WorkerRegistry, msg: WorkerMessage): void {
	if (reg.transport === 'fetch') {
		if (msg.directive === 'LOG' && msg.provider && msg.payload !== undefined) {
			void sendFetch(reg, msg.provider as LogEventType, msg.payload);
		}
		return;
	}

	if (reg.state !== 'ready') {
		reg.pending.push(msg);
		return;
	}

	reg.worker?.postMessage(msg);
}

async function sendFetch(reg: WorkerRegistry, type: LogEventType, payload: unknown): Promise<void> {
	const cfg = reg.providers.get(type);
	if (!cfg) return;

	try {
		await fetch(cfg.endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...cfg.headers },
			body: JSON.stringify(payload),
			keepalive: true,
		});
	} catch {
		// Remote logging must never crash the application
	}
}

// --- Worker lifecycle -----------------------------------------------------------

function markReady(reg: WorkerRegistry) {
	reg.state = 'ready';
	for (const msg of reg.pending.splice(0)) dispatch(reg, msg);
}

function degradeToFetch(reg: WorkerRegistry, err: Error) {
	reg.worker = null;
	reg.transport = 'fetch';
	markReady(reg); // flush buffered messages through fetch before notifying subscribers
	reg.state = 'degraded';
	reg.errorHandlers.forEach((h) => h(err));
}

function handleAck(data: WorkerAckMessage) {
	switch (data.directive) {
		case 'ERROR':
			console.error('[komodo-logger] worker batch error:', data.payload);
			break;
		case 'STOP': {
			if (data.payload && typeof data.payload === 'object') {
				const lost = (data.payload as { lost?: Record<string, number> }).lost ?? {};
				const lines = Object.entries(lost).filter(([, n]) => n > 0);
				if (lines.length > 0) {
					console.warn('[komodo-logger] stopped with unsent logs:', lines.map(([p, n]) => `${p}: ${n}`).join(', '));
				}
			}
			break;
		}
	}
}

function initBrowserWorker(reg: WorkerRegistry): void {
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const WorkerCtor = (globalThis as any).Worker as new (
			url: URL,
			opts?: { type?: string },
		) => WorkerLike & {
			onmessage: ((e: { data: WorkerAckMessage }) => void) | null;
			onerror: ((e: { message: string }) => void) | null;
		};

		const wkr = new WorkerCtor(new URL('./browser.js', import.meta.url), { type: 'module' });

		wkr.onmessage = ({ data }) => handleAck(data);
		wkr.onerror = ({ message }) => {
			console.error('[komodo-logger] browser worker error:', message);
			degradeToFetch(reg, new Error(message));
		};

		reg.worker = wkr;
		markReady(reg);
	} catch (err) {
		console.error('[komodo-logger] could not start browser worker:', err);
		/* istanbul ignore next -- non-Error throws are unusual; the catch path is tested with Error values */
		degradeToFetch(reg, err instanceof Error ? err : new Error(String(err)));
	}
}

async function initNodeWorker(reg: WorkerRegistry): Promise<void> {
	try {
		const { Worker } = await import('worker_threads');
		const wkr = new Worker(new URL('./node.js', import.meta.url));

		wkr.on('message', (data: WorkerAckMessage) => handleAck(data));
		wkr.on('error', (err: Error) => {
			console.error('[komodo-logger] node worker error:', err.message);
			degradeToFetch(reg, err);
		});

		reg.worker = {
			postMessage: (data) => {
				wkr.postMessage(data);
			},
			terminate: () => wkr.terminate(),
		};
		markReady(reg);
	} catch (err) {
		console.error('[komodo-logger] could not start node worker:', err);
		degradeToFetch(reg, err instanceof Error ? err : new Error(String(err)));
	}
}

function spawnWorker(reg: WorkerRegistry): void {
	if (reg.transport === 'web-worker') {
		initBrowserWorker(reg);
	} else if (reg.transport === 'node-worker') {
		void initNodeWorker(reg); // async — events buffer in reg.pending until ready
	} else {
		markReady(reg); // fetch is always ready immediately
	}
}

// --- WorkerRef factory ----------------------------------------------------------

const buildRef = (reg: WorkerRegistry): WorkerRef => ({
	register(type, cfg) {
		const stored: ProviderCfg = {
			endpoint: cfg.endpoint,
			/* istanbul ignore next */ /* headers is typed non-optional; ?? {} is a JS-only defensive fallback */
			headers: cfg.headers ?? {},
			batchSize: cfg.batchSize,
			flushInterval: cfg.flushInterval,
		};
		reg.providers.set(type, stored);
		dispatch(reg, {
			directive: 'CONFIG',
			provider: type,
			payload: stored,
		});
	},

	send(event) {
		dispatch(reg, { directive: 'LOG', provider: event.type, payload: event });
	},

	flush(type?) {
		dispatch(reg, type !== undefined ? { directive: 'FLUSH', provider: type } : { directive: 'FLUSH' });
	},

	stop() {
		dispatch(reg, { directive: 'STOP' });
		setTimeout(() => {
			void reg.worker?.terminate?.();
			reg.worker = null;
			reg.state = 'stopped';
			reg.pending = [];
		}, 500);
	},

	onError(handler) {
		reg.errorHandlers.add(handler);
		return () => reg.errorHandlers.delete(handler);
	},
});

// --- Public API -----------------------------------------------------------------

/**
 * Returns a WorkerRef backed by the shared worker thread.
 *
 * The first logger to call this creates the worker. The `transport` argument of every
 * subsequent caller is ignored — first caller wins. If the worker thread dies, all
 * registered onError handlers are called and the registry automatically degrades to fetch.
 */
export function getOrCreateWorker(transport: Transport = 'auto'): WorkerRef {
	const reg = getRegistry();
	if (reg.state !== 'starting') return buildRef(reg);

	reg.transport = resolveTransport(transport);
	spawnWorker(reg);
	return buildRef(reg);
}

/**
 * Tears down the worker and clears the globalThis registry.
 * For testing only — lets each test start with a clean slate.
 */
export function resetRegistry(): void {
	const g = globalThis as Record<symbol, WorkerRegistry | undefined>;
	const reg = g[REGISTRY_KEY];

	if (reg) {
		void reg.worker?.terminate?.();
		delete g[REGISTRY_KEY];
	}
}
