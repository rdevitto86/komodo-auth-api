export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogEventType = 'runtime' | 'clickstream' | 'interaction' | 'telemetry';
export type Transport = 'auto' | 'fetch' | 'web-worker' | 'node-worker';
/**
 * Fields present on every log event regardless of type.
 * correlationId is intentionally absent — it belongs in `details` since its
 * source differs per context (sessionStorage in browser, X-Correlation-ID header on server).
 */
export interface BaseLogEvent {
    timestamp: string;
    level: LogLevel;
    type: LogEventType;
    service: string;
    env: string;
    version: string;
    requestId?: string;
    userId?: string;
    sessionId?: string;
    message: string;
    details?: Record<string, unknown>;
}
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
//# sourceMappingURL=base.d.ts.map