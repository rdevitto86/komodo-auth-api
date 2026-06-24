export interface HealthCheckResult {
    status: 'ok' | 'degraded' | 'unavailable';
    version?: string;
    checks?: Record<string, 'ok' | 'fail'>;
}
/** Returns a 200 liveness response — {"status":"ok"}. */
export declare const healthHandler: (_req?: Request) => Response;
/** Returns a readiness response based on the provided check results. */
export declare function readinessHandler(checks: Record<string, boolean>, _req?: Request): Response;
export default healthHandler;
//# sourceMappingURL=index.d.ts.map