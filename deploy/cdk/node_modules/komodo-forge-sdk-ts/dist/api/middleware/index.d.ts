export type Handler = (req: Request) => Promise<Response>;
export type Middleware = (next: Handler) => Handler;
export declare function setCtx(req: Request, key: symbol, value: unknown): void;
export declare function getCtx(req: Request, key: symbol): unknown;
/** Compose middlewares right-to-left onto a terminal handler (outermost first). */
export declare function chain(handler: Handler, ...middlewares: Middleware[]): Handler;
/**
 * Ensures each request carries a unique X-Request-ID in both context and
 * response headers. Propagates X-Correlation-ID from the client.
 */
export declare const requestIdMiddleware: Middleware;
/**
 * Detects whether a request originates from an API client or a browser
 * and stores the result in context for downstream middleware.
 */
export declare const clientSourceMiddleware: Middleware;
/**
 * Validates an OAuth2 / JWT Bearer token, then attaches the decoded claims
 * (userId, sessionId, scopes, isAdmin) to request context.
 *
 * Requires JWT_SECRET env var (or use RS256 by providing JWT_PUBLIC_KEY).
 * Mirrors komodo-forge-sdk-go/auth/middleware.go AuthMiddleware.
 */
export declare function authMiddleware(secret: string): Middleware;
/**
 * Rejects requests whose JWT does not carry a service-scoped token.
 * Service tokens must have at least one scope prefixed with "svc:".
 * Mirrors komodo-forge-sdk-go/auth/middleware.go RequireServiceScope.
 */
export declare const requireServiceScope: Middleware;
/**
 * Adds standard security headers to every response.
 * Mirrors komodo-forge-sdk-go/http/headers/middleware.go.
 */
export declare const securityHeadersMiddleware: Middleware;
export interface CORSOptions {
    allowedOrigins?: string[];
    allowedMethods?: string[];
    allowedHeaders?: string[];
    allowCredentials?: boolean;
    maxAge?: number;
}
/**
 * Configurable CORS middleware.
 * Mirrors komodo-forge-sdk-go/http/cors/middleware.go.
 */
export declare function corsMiddleware(opts?: CORSOptions): Middleware;
/**
 * Double-submit cookie CSRF protection for browser clients.
 * API clients (detected by clientSourceMiddleware) are exempt.
 * Mirrors komodo-forge-sdk-go/http/csrf/middleware.go.
 */
export declare const csrfMiddleware: Middleware;
interface RateLimiterOptions {
    rps?: number;
    burst?: number;
    keyFn?: (req: Request) => string;
    failOpen?: boolean;
}
/**
 * Token-bucket rate limiter.
 * Mirrors komodo-forge-sdk-go/http/ratelimit.
 *
 * By default, keyed on the client IP (x-forwarded-for or remote addr).
 */
export declare function rateLimiterMiddleware(opts?: RateLimiterOptions): Middleware;
/**
 * Guards against duplicate requests using the Idempotency-Key header.
 * Only applies to state-changing methods (POST, PUT, PATCH, DELETE).
 * API clients (M2M) are exempt.
 * Mirrors komodo-forge-sdk-go/idempotency/middleware.go.
 */
export declare function idempotencyMiddleware(ttlMs?: number): Middleware;
/**
 * Sanitizes request headers, query params, and JSON body against SQL injection,
 * XSS, path traversal, and null bytes.
 * Mirrors komodo-forge-sdk-go/http/sanitization/middleware.go.
 */
export declare const sanitizationMiddleware: Middleware;
/**
 * Normalizes request headers (trim whitespace), URL path (trailing slashes,
 * double slashes), and query parameter casing for common values.
 * Mirrors komodo-forge-sdk-go/http/normalization/normalization.go.
 */
export declare const normalizationMiddleware: Middleware;
export interface IPAccessOptions {
    whitelist?: string[];
    blacklist?: string[];
}
/**
 * IP whitelist/blacklist middleware.
 * CIDR ranges (e.g. "10.0.0.0/8") and exact IPs are both supported.
 * Mirrors komodo-forge-sdk-go/http/ipaccess.
 */
export declare function ipAccessMiddleware(opts?: IPAccessOptions): Middleware;
/**
 * Shallow redaction middleware — creates a sanitized copy of the request for
 * downstream logging without mutating the original.
 * Mirrors komodo-forge-sdk-go/http/redaction/middleware.go.
 */
export declare const redactionMiddleware: Middleware;
/**
 * Structured per-request telemetry logger.
 * Logs method, path, status, latency, bytes on every request.
 * Mirrors komodo-forge-sdk-go/http/telemetry/middleware.go.
 */
export declare const telemetryMiddleware: Middleware;
export declare const ContextKeys: {
    readonly AUTH_VALID: symbol;
    readonly USER_ID: symbol;
    readonly SESSION_ID: symbol;
    readonly REQUEST_ID: symbol;
    readonly CORRELATION_ID: symbol;
    readonly CLIENT_TYPE: symbol;
    readonly CSRF_VALID: symbol;
    readonly IDEMPOTENCY_VALID: symbol;
    readonly SCOPES: symbol;
    readonly IS_ADMIN: symbol;
};
export declare function getRequestId(req: Request): string | undefined;
export declare function getCorrelationId(req: Request): string | undefined;
export declare function getUserId(req: Request): string | undefined;
export declare function getSessionId(req: Request): string | undefined;
export declare function getScopes(req: Request): string[] | undefined;
export declare function isAdmin(req: Request): boolean;
export declare function isAuthValid(req: Request): boolean;
export declare function getClientType(req: Request): string;
export {};
//# sourceMappingURL=index.d.ts.map