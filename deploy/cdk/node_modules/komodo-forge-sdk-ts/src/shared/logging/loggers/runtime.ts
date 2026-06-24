import { redact } from '../../redaction/index.js';
import type { BaseLogEvent, BaseLoggerConfig, LogLevel } from '../common/base.js';
import { formatEvent } from '../common/format.js';
import type { WorkerRef } from '../common/worker/registry.js';
import { getOrCreateWorker } from '../common/worker/registry.js';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 1, info: 2, warn: 3, error: 4 };

export interface RuntimeLoggerConfig extends BaseLoggerConfig {
	/** Minimum level for console + remote output. Defaults to 'warn'. */
	level?: LogLevel;
}

export interface RuntimeLogEvent extends BaseLogEvent {
	type: 'runtime';
	details?: {
		correlationId?: string; // sessionStorage UUID (browser) or X-Correlation-ID (server)
		error?: string;
		stack?: string;
		component?: string;
		request?: { method: string; path: string; status?: number };
		[key: string]: unknown;
	};
}

/**
 * Runtime logger for application-level events.
 *
 * - Browser-only: Uses sessionStorage for correlationId, sends to remote endpoint.
 * - Server-side: Uses X-Correlation-ID header, sends to remote endpoint.
 * - Always logs to console (with level filtering).
 */
export default class RuntimeLogger {
	static #instance: RuntimeLogger | null = null;

	readonly #ref!: WorkerRef;
	readonly #service!: string;
	readonly #env!: string;
	readonly #version!: string;
	readonly #verbose!: boolean;
	readonly #minLevel!: number;
	readonly #enableRemote!: boolean;

	constructor(config: RuntimeLoggerConfig) {
		if (RuntimeLogger.#instance) return RuntimeLogger.#instance;

		this.#service = config.service;
		this.#env = config.env;
		this.#version = config.version;
		this.#verbose = config.env !== 'production';
		this.#minLevel = LEVEL_WEIGHT[config.level ?? 'warn'];
		this.#enableRemote = !!config.endpoint;
		this.#ref = getOrCreateWorker(config.transport);

		if (config.endpoint) {
			this.#ref.register('runtime', {
				endpoint: config.endpoint,
				headers: config.headers ?? {},
				batchSize: config.batchSize ?? 10,
				flushInterval: config.flushInterval ?? 10_000,
			});
		}

		this.#ref.onError((err) => {
			console.warn('[RuntimeLogger] worker degraded, falling back to fetch:', err.message);
		});

		RuntimeLogger.#instance = this;
	}

	/** For testing only — clears the singleton so the next constructor call re-initializes. */
	static _reset(): void {
		RuntimeLogger.#instance = null;
	}

	/** Local console only. Never shipped remotely regardless of endpoint config. */
	debug(message: string, details?: RuntimeLogEvent['details'], requestId?: string): void {
		if (LEVEL_WEIGHT.debug < this.#minLevel) return;
		const event = this.#build('debug', message, details, requestId);
		consoleOut('debug', event, this.#verbose);
	}

	info(message: string, details?: RuntimeLogEvent['details'], requestId?: string): void {
		if (LEVEL_WEIGHT.info < this.#minLevel) return;
		const event = this.#build('info', message, details, requestId);
		consoleOut('info', event, this.#verbose);
		if (this.#enableRemote) this.#ship(event);
	}

	warn(message: string, details?: RuntimeLogEvent['details'], requestId?: string): void {
		if (LEVEL_WEIGHT.warn < this.#minLevel) return;
		const event = this.#build('warn', message, details, requestId);
		consoleOut('warn', event, this.#verbose);
		if (this.#enableRemote) this.#ship(event);
	}

	error(message: string, details?: RuntimeLogEvent['details'], requestId?: string): void {
		/* istanbul ignore next -- error is the highest level; minLevel can never exceed it */
		if (LEVEL_WEIGHT.error < this.#minLevel) return;
		const event = this.#build('error', message, details, requestId);
		consoleOut('error', event, this.#verbose);
		if (this.#enableRemote) this.#ship(event);
	}

	flush(): void {
		this.#ref.flush('runtime');
	}
	stop(): void {
		this.#ref.stop();
	}

	#build(level: LogLevel, message: string, details?: RuntimeLogEvent['details'], requestId?: string): RuntimeLogEvent {
		const event: RuntimeLogEvent = {
			timestamp: new Date().toISOString(),
			level,
			type: 'runtime',
			service: this.#service,
			env: this.#env,
			version: this.#version,
			message,
		};

		if (requestId !== undefined) event.requestId = requestId;
		if (details !== undefined) event.details = details;

		return event;
	}

	#ship(event: RuntimeLogEvent): void {
		this.#ref.send(redact(event as unknown as Record<string, unknown>) as unknown as BaseLogEvent);
	}
}

function consoleOut(level: LogLevel, event: RuntimeLogEvent, verbose: boolean = false): void {
	/* istanbul ignore next -- event is always a typed RuntimeLogEvent; null guard is defensive */
	if (!event) return;
	const formatted = formatEvent(event, verbose);
	switch (level) {
		case 'debug':
			console.debug(formatted);
			break;
		case 'info':
			console.info(formatted);
			break;
		case 'warn':
			console.warn(formatted);
			break;
		case 'error':
			console.error(formatted);
			break;
	}
}
