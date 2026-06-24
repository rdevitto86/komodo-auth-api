/**
 * Returns the correlation ID for the current browser session.
 *
 * Generated once per tab via crypto.randomUUID(), persisted in sessionStorage.
 * Survives page navigations; resets when the tab closes.
 *
 * Server context: returns 'server' — pass X-Correlation-ID from the incoming
 * request as `correlationId` in log event `details` instead.
 */
export declare function getCorrelationId(): string;
//# sourceMappingURL=index.d.ts.map