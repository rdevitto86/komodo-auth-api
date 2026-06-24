import type { BaseLogEvent, BaseLoggerConfig } from '../common/base.js';
export interface TelemetryLoggerConfig extends BaseLoggerConfig {
}
export interface TelemetryLogEvent extends BaseLogEvent {
    type: 'telemetry';
    level: 'info';
    details: {
        correlationId?: string;
        name: string;
        duration?: number;
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
    #private;
    constructor(config: TelemetryLoggerConfig);
    /** For testing only — clears the singleton so the next constructor call re-initializes. */
    static _reset(): void;
    trace(name: string, attributes?: Partial<TelemetryLogEvent['details']>, requestId?: string): void;
    flush(): void;
    stop(): void;
}
//# sourceMappingURL=telemetry.d.ts.map