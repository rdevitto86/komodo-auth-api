// Isolated base types — no SDK imports. Everything else in shared/logging imports from here.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogEventType = 'runtime' | 'clickstream' | 'interaction' | 'telemetry';
export type Transport = 'auto' | 'fetch' | 'web-worker' | 'node-worker';

/**
 * Fields present on every log event regardless of type.
 * correlationId is intentionally absent — it belongs in `details` since its
 * source differs per context (sessionStorage in browser, X-Correlation-ID header on server).
 */
export interface BaseLogEvent {
	timestamp: string; // ISO 8601 — set at emit time
	level: LogLevel;
	type: LogEventType;
	service: string; // e.g. 'komodo-api', 'komodo-ui'
	env: string; // 'production' | 'staging' | 'development'
	version: string; // semver from config
	requestId?: string; // X-Request-ID — per HTTP request
	userId?: string; // populated when authenticated
	sessionId?: string; // JWT session identifier
	message: string;
	details?: Record<string, unknown>;
}

// Common fields shared by all logger configs. Not exported — each logger exposes
// its own named config type so they can diverge independently over time.
export interface BaseLoggerConfig {
	service: string;
	version: string;
	env: string;
	/**
	 * Worker transport. Defaults to 'auto'.
	 * Only the first logger instantiated takes effect — subsequent loggers share the
	 * already-running worker regardless of what transport they request.
	 */
	transport?: Transport;
	/** Remote endpoint. If omitted the logger is console-only — no events are shipped. */
	endpoint?: string;
	/** Auth/metadata headers sent with every remote batch. Stored in memory, never logged. */
	headers?: Record<string, string>;
	batchSize?: number;
	flushInterval?: number;
}
