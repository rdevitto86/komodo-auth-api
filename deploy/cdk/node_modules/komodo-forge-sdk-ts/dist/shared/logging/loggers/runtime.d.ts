import type { BaseLogEvent, BaseLoggerConfig, LogLevel } from '../common/base.js';
export interface RuntimeLoggerConfig extends BaseLoggerConfig {
    /** Minimum level for console + remote output. Defaults to 'warn'. */
    level?: LogLevel;
}
export interface RuntimeLogEvent extends BaseLogEvent {
    type: 'runtime';
    details?: {
        correlationId?: string;
        error?: string;
        stack?: string;
        component?: string;
        request?: {
            method: string;
            path: string;
            status?: number;
        };
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
    #private;
    constructor(config: RuntimeLoggerConfig);
    /** For testing only — clears the singleton so the next constructor call re-initializes. */
    static _reset(): void;
    /** Local console only. Never shipped remotely regardless of endpoint config. */
    debug(message: string, details?: RuntimeLogEvent['details'], requestId?: string): void;
    info(message: string, details?: RuntimeLogEvent['details'], requestId?: string): void;
    warn(message: string, details?: RuntimeLogEvent['details'], requestId?: string): void;
    error(message: string, details?: RuntimeLogEvent['details'], requestId?: string): void;
    flush(): void;
    stop(): void;
}
//# sourceMappingURL=runtime.d.ts.map