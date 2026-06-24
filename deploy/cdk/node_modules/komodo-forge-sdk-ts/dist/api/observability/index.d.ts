export type { HealthCheckResult } from '../../shared/http/handlers/health/index.js';
export { healthHandler, readinessHandler } from '../../shared/http/handlers/health/index.js';
/** Registers SIGTERM/SIGINT handlers that call the provided cleanup function. */
export declare function onShutdown(cleanup: () => Promise<void>): void;
export declare const metrics: {
    /** Increments a named counter by delta (default 1). */
    counter(name: string, delta?: number): void;
    /** Sets a named gauge to an absolute value. */
    gauge(name: string, value: number): void;
    /** Records an observation into a named histogram. */
    histogram(name: string, value: number): void;
    /** Returns all metrics as a plain object for serialization or a /metrics endpoint. */
    snapshot(): Record<string, unknown>;
    /** Returns a Prometheus-compatible /metrics scrape body (text/plain). */
    prometheusText(): string;
};
/** HTTP handler for the /metrics endpoint. Returns Prometheus-formatted metrics. */
export declare function metricsHandler(_req?: Request): Response;
//# sourceMappingURL=index.d.ts.map