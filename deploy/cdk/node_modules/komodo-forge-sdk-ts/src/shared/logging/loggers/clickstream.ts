import { getCorrelationId } from '../../http/utils/index.js';
import { redact } from '../../redaction/index.js';
import type { BaseLogEvent, BaseLoggerConfig } from '../common/base.js';
import { formatEvent } from '../common/format.js';
import type { WorkerRef } from '../common/worker/registry.js';
import { getOrCreateWorker } from '../common/worker/registry.js';

export interface ClickstreamLoggerConfig extends BaseLoggerConfig {}

export interface ClickstreamLogEvent extends BaseLogEvent {
	type: 'clickstream';
	level: 'info';
	details: {
		correlationId?: string;
		action: 'click' | 'hover' | 'scroll' | 'submit' | 'input' | 'focus' | 'blur';
		target: {
			id?: string;
			label?: string;
			text?: string;
			path?: string; // DOM selector path
			aria?: string;
		};
		url: string;
		viewport?: string; // e.g. '1440x900'
		[key: string]: unknown;
	};
}

/**
 * Clickstream logger for tracking user interactions in the browser.
 *
 * This logger is designed to work in browser environments only. In Node.js or Lambda environments,
 * the logger will be disabled and no events will be sent.
 */
export default class ClickstreamLogger {
	static #instance: ClickstreamLogger | null = null;

	readonly #ref!: WorkerRef;
	readonly #service!: string;
	readonly #env!: string;
	readonly #version!: string;
	readonly #verbose!: boolean;
	/** False in Node/Lambda — no DOM. Set once at construction. */
	readonly #enabled!: boolean;

	constructor(config: ClickstreamLoggerConfig) {
		if (ClickstreamLogger.#instance) return ClickstreamLogger.#instance;

		this.#service = config.service;
		this.#env = config.env;
		this.#version = config.version;
		this.#verbose = config.env !== 'production';
		this.#enabled = 'window' in globalThis;
		this.#ref = getOrCreateWorker(config.transport);

		if (this.#enabled && config.endpoint) {
			this.#ref.register('clickstream', {
				endpoint: config.endpoint,
				headers: config.headers ?? {},
				batchSize: config.batchSize ?? 20,
				flushInterval: config.flushInterval ?? 5_000,
			});
		}

		this.#ref.onError((err) => {
			console.warn('[ClickstreamLogger] worker degraded, falling back to fetch:', err.message);
		});

		ClickstreamLogger.#instance = this;
	}

	/** For testing only — clears the singleton so the next constructor call re-initializes. */
	static _reset(): void {
		ClickstreamLogger.#instance = null;
	}

	track(
		action: ClickstreamLogEvent['details']['action'],
		target: ClickstreamLogEvent['details']['target'],
		requestId?: string,
	): void {
		if (!this.#enabled) return;

		const details: ClickstreamLogEvent['details'] = {
			action,
			target,
			url: (globalThis as { location?: { href: string } }).location?.href ?? '',
			correlationId: getCorrelationId(),
		};

		const w = (globalThis as { innerWidth?: number }).innerWidth;
		const h = (globalThis as { innerHeight?: number }).innerHeight;
		if (w !== undefined && h !== undefined) details.viewport = `${w}x${h}`;

		const event: ClickstreamLogEvent = {
			timestamp: new Date().toISOString(),
			level: 'info',
			type: 'clickstream',
			service: this.#service,
			env: this.#env,
			version: this.#version,
			message: `${action} on ${target.label ?? target.id ?? target.path ?? 'element'}`,
			details,
		};
		if (requestId !== undefined) event.requestId = requestId;

		if (this.#verbose) console.debug(formatEvent(event, true));
		this.#ref.send(redact(event as unknown as Record<string, unknown>) as unknown as BaseLogEvent);
	}

	flush(): void {
		this.#ref.flush('clickstream');
	}
	stop(): void {
		this.#ref.stop();
	}
}
