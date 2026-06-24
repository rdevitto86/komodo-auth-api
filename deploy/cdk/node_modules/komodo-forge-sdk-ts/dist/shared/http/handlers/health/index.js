// Health check handler. Mirrors komodo-forge-sdk-go/http/handlers/health/health.go.
/** Returns a 200 liveness response — {"status":"ok"}. */
export const healthHandler = (_req) => new Response(JSON.stringify({ status: 'ok' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
});
/** Returns a readiness response based on the provided check results. */
export function readinessHandler(checks, _req) {
    const checkResults = {};
    let allOk = true;
    for (const [name, ok] of Object.entries(checks)) {
        checkResults[name] = ok ? 'ok' : 'fail';
        if (!ok)
            allOk = false;
    }
    const status = allOk ? 'ok' : 'unavailable';
    const httpStatus = allOk ? 200 : 503;
    return new Response(JSON.stringify({ status, checks: checkResults }), {
        status: httpStatus,
        headers: { 'Content-Type': 'application/json' },
    });
}
export default healthHandler;
//# sourceMappingURL=index.js.map