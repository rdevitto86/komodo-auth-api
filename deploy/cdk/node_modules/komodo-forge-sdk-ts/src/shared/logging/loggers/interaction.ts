import { getCorrelationId } from '../../http/utils/index.js';
import { redact } from '../../redaction/index.js';
import type { BaseLogEvent, BaseLoggerConfig } from '../common/base.js';
import { formatEvent } from '../common/format.js';
import type { WorkerRef } from '../common/worker/registry.js';
import { getOrCreateWorker } from '../common/worker/registry.js';

export interface InteractionLoggerConfig extends BaseLoggerConfig {}

export interface InteractionLogEvent extends BaseLogEvent {
	type: 'interaction';
	level: 'info';
	details: {
		correlationId?: string;
		action: string;
		url: string;
		data?: Record<string, unknown>;
		[key: string]: unknown;
	};
}

/**
 * Interaction logger for tracking user interactions in the browser.
 *
 * This logger is designed to work in browser environments only. In Node.js or Lambda environments,
 * the logger will be disabled and no events will be sent.
 */
export default class InteractionLogger {
	static #instance: InteractionLogger | null = null;

	readonly #ref!: WorkerRef;
	readonly #service!: string;
	readonly #env!: string;
	readonly #version!: string;
	readonly #verbose!: boolean;
	/** False in Node/Lambda — semantic UI events have no meaning outside a browser. */
	readonly #enabled!: boolean;

	constructor(config: InteractionLoggerConfig) {
		if (InteractionLogger.#instance) return InteractionLogger.#instance;

		this.#service = config.service;
		this.#env = config.env;
		this.#version = config.version;
		this.#verbose = config.env !== 'production';
		this.#enabled = 'window' in globalThis;
		this.#ref = getOrCreateWorker(config.transport);

		if (this.#enabled && config.endpoint) {
			this.#ref.register('interaction', {
				endpoint: config.endpoint,
				headers: config.headers ?? {},
				batchSize: config.batchSize ?? 10,
				flushInterval: config.flushInterval ?? 10_000,
			});
		}

		this.#ref.onError((err) => {
			console.warn('[InteractionLogger] worker degraded, falling back to fetch:', err.message);
		});

		InteractionLogger.#instance = this;
	}

	/** For testing only — clears the singleton so the next constructor call re-initializes. */
	static _reset(): void {
		InteractionLogger.#instance = null;
	}

	track(action: string, data?: Record<string, unknown>, requestId?: string): void {
		if (!this.#enabled) return;

		const details: InteractionLogEvent['details'] = {
			action,
			url: (globalThis as { location?: { href: string } }).location?.href ?? '',
			correlationId: getCorrelationId(),
		};
		if (data !== undefined) details.data = data;

		const event: InteractionLogEvent = {
			timestamp: new Date().toISOString(),
			level: 'info',
			type: 'interaction',
			service: this.#service,
			env: this.#env,
			version: this.#version,
			message: action,
			details,
		};
		if (requestId !== undefined) event.requestId = requestId;

		if (this.#verbose) console.debug(formatEvent(event, true));
		this.#ref.send(redact(event as unknown as Record<string, unknown>) as unknown as BaseLogEvent);
	}

	flush(): void {
		this.#ref.flush('interaction');
	}
	stop(): void {
		this.#ref.stop();
	}
}
