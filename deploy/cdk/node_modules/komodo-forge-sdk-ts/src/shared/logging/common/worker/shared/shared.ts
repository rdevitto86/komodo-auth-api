// Shared buffer/flush logic — runs inside both browser and Node.js worker scripts.
// No SDK imports; self-contained so it works in any worker context.

export type WorkerDirective = 'CONFIG' | 'LOG' | 'FLUSH' | 'STOP';
export type WorkerAck = 'ERROR' | 'STOP';

export interface WorkerMessage {
	directive: WorkerDirective;
	provider?: string;
	payload?: unknown;
}

export interface WorkerAckMessage {
	directive: WorkerAck;
	provider?: string;
	payload?: unknown;
}

interface ProviderState {
	config: {
		endpoint: string;
		headers: Record<string, string>;
		batchSize: number;
		flushInterval: number;
	};
	buffer: unknown[];
	timer: ReturnType<typeof setInterval> | null;
}

export type PostFn = (msg: WorkerAckMessage) => void;

export function createWorkerLogic(post: PostFn) {
	const providers = new Map<string, ProviderState>();

	async function flush(provider: string): Promise<void> {
		const state = providers.get(provider);
		if (!state?.buffer.length) return;

		const batch = [...state.buffer];
		state.buffer = [];

		try {
			const res = await fetch(state.config.endpoint, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...state.config.headers },
				body: JSON.stringify(batch),
				keepalive: true,
			});
			if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
		} catch (err) {
			// Re-queue on failure so logs aren't lost on transient errors
			state.buffer = [...batch, ...state.buffer];
			post({ directive: 'ERROR', provider, payload: { error: String(err), buffered: state.buffer.length } });
		}
	}

	async function handleMessage(msg: WorkerMessage): Promise<void> {
		try {
			switch (msg.directive) {
				case 'CONFIG': {
					const provider = msg.provider;
					if (!provider) return;

					const existing = providers.get(provider);
					if (existing?.timer !== null && existing?.timer !== undefined) {
						clearInterval(existing.timer);
					}

					const cfg = msg.payload as ProviderState['config'];
					const state: ProviderState = {
						config: cfg,
						buffer: existing?.buffer ?? [],
						timer: null,
					};

					if (cfg.flushInterval > 0) {
						state.timer = setInterval(() => {
							void flush(provider);
						}, cfg.flushInterval);
					}

					providers.set(provider, state);
					break;
				}

				case 'LOG': {
					const provider = msg.provider;
					if (!provider) return;

					const state = providers.get(provider);
					if (!state) return;

					state.buffer.push(msg.payload);

					if (state.buffer.length >= state.config.batchSize) {
						await flush(provider);
					}
					break;
				}

				case 'FLUSH': {
					if (msg.provider) {
						await flush(msg.provider);
					} else {
						await Promise.all([...providers.keys()].map(flush));
					}
					break;
				}

				case 'STOP': {
					// Clear all timers first
					for (const state of providers.values()) {
						if (state.timer !== null) clearInterval(state.timer);
					}

					const lost: Record<string, number> = {};
					for (const [p, state] of providers.entries()) {
						if (state.buffer.length > 0) lost[p] = state.buffer.length;
					}

					post({ directive: 'STOP', payload: { lost } });
					break;
				}
			}
		} catch (err) {
			const ack: WorkerAckMessage = { directive: 'ERROR', payload: { error: String(err) } };
			if (msg.provider !== undefined) ack.provider = msg.provider;
			post(ack);
		}
	}

	return { handleMessage };
}
