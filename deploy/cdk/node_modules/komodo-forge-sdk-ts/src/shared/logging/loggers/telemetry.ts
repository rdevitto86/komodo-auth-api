import { redact } from '../../redaction/index.js';
import type { BaseLogEvent, BaseLoggerConfig } from '../common/base.js';
import { formatEvent } from '../common/format.js';
import type { WorkerRef } from '../common/worker/registry.js';
import { getOrCreateWorker } from '../common/worker/registry.js';

export interface TelemetryLoggerConfig extends BaseLoggerConfig {}

export interface TelemetryLogEvent extends BaseLogEvent {
	type: 'telemetry';
	level: 'info';
	details: {
		correlationId?: string;
		name: string;
		duration?: number; // ms
		component?: string;
		traceId?: string;
		spanId?: string;
		[key: string]: unknown;
	};
}

/**
 * Telemetry logger for sending telemetry data to the backend.
 *
 * - Browser-only: Uses sessionStorage for correlationId, sends to remote endpoint.
 * - Server-side: Uses X-Correlation-ID header, sends to remote endpoint.
 * - Always logs to console (with level filtering).
 */
export default class TelemetryLogger {
	static #instance: TelemetryLogger | null = null;

	readonly #ref!: WorkerRef;
	readonly #service!: string;
	readonly #env!: string;
	readonly #version!: string;
	readonly #verbose!: boolean;

	constructor(config: TelemetryLoggerConfig) {
		if (TelemetryLogger.#instance) return TelemetryLogger.#instance;

		this.#service = config.service;
		this.#env = config.env;
		this.#version = config.version;
		this.#verbose = config.env !== 'production';
		this.#ref = getOrCreateWorker(config.transport);

		if (config.endpoint) {
			this.#ref.register('telemetry', {
				endpoint: config.endpoint,
				headers: config.headers ?? {},
				batchSize: config.batchSize ?? 10,
				flushInterval: config.flushInterval ?? 30_000,
			});
		}

		this.#ref.onError((err) => {
			console.warn('[TelemetryLogger] worker degraded, falling back to fetch:', err.message);
		});

		TelemetryLogger.#instance = this;
	}

	/** For testing only — clears the singleton so the next constructor call re-initializes. */
	static _reset(): void {
		TelemetryLogger.#instance = null;
	}

	trace(name: string, attributes?: Partial<TelemetryLogEvent['details']>, requestId?: string): void {
		const event: TelemetryLogEvent = {
			timestamp: new Date().toISOString(),
			level: 'info',
			type: 'telemetry',
			service: this.#service,
			env: this.#env,
			version: this.#version,
			message: name,
			details: { name, ...attributes } as TelemetryLogEvent['details'],
		};
		if (requestId !== undefined) event.requestId = requestId;

		if (this.#verbose) console.debug(formatEvent(event, true));
		this.#ref.send(redact(event as unknown as Record<string, unknown>) as unknown as BaseLogEvent);
	}

	flush(): void {
		this.#ref.flush('telemetry');
	}
	stop(): void {
		this.#ref.stop();
	}
}
