// Middleware stack for Komodo API services.
// Mirrors komodo-forge-sdk-go/http/middleware.
//
// Middleware pattern: (next: Handler) => Handler
// Use `chain()` to compose multiple middlewares onto a single handler.

import { Auth, buildErrorResponse, Global } from '../../shared/http/errors/index.js';
import type { JWTPayload } from '../../shared/security/index.js';
import { verifyJWT } from '../../shared/security/index.js';

// --- Core types ---

export type Handler = (req: Request) => Promise<Response>;
export type Middleware = (next: Handler) => Handler;

/** Per-request context stored in a WeakMap so it's GC'd when the Request is released. */
const _ctx = new WeakMap<Request, Map<symbol, unknown>>();

const CTX = {
	AUTH_VALID: Symbol('auth_valid'),
	USER_ID: Symbol('user_id'),
	SESSION_ID: Symbol('session_id'),
	REQUEST_ID: Symbol('request_id'),
	CORRELATION_ID: Symbol('correlation_id'),
	CLIENT_TYPE: Symbol('client_type'),
	CSRF_VALID: Symbol('csrf_valid'),
	IDEMPOTENCY_VALID: Symbol('idempotency_valid'),
	SCOPES: Symbol('scopes'),
	IS_ADMIN: Symbol('is_admin'),
} as const;

export function setCtx(req: Request, key: symbol, value: unknown): void {
	let map = _ctx.get(req);
	if (!map) {
		map = new Map();
		_ctx.set(req, map);
	}
	map.set(key, value);
}

export function getCtx(req: Request, key: symbol): unknown {
	return _ctx.get(req)?.get(key);
}

/** Compose middlewares right-to-left onto a terminal handler (outermost first). */
export function chain(handler: Handler, ...middlewares: Middleware[]): Handler {
	return middlewares.reduceRight((h, mw) => mw(h), handler);
}

// --- Request ID ---

/** Generates a UUID-like request ID using the Web Crypto API. */
function generateRequestId(): string {
	return crypto.randomUUID();
}

/**
 * Ensures each request carries a unique X-Request-ID in both context and
 * response headers. Propagates X-Correlation-ID from the client.
 */
export const requestIdMiddleware: Middleware = (next) => async (req) => {
	const reqId = req.headers.get('x-request-id') ?? generateRequestId();

	const mutableReq = new Request(req, {
		headers: (() => {
			const h = new Headers(req.headers);
			h.set('x-request-id', reqId);
			return h;
		})(),
	});

	setCtx(mutableReq, CTX.REQUEST_ID, reqId);

	const corrId = req.headers.get('x-correlation-id');
	if (corrId) setCtx(mutableReq, CTX.CORRELATION_ID, corrId);

	const resp = await next(mutableReq);
	const mutableResp = new Response(resp.body, resp);
	mutableResp.headers.set('x-request-id', reqId);
	if (corrId) mutableResp.headers.set('x-correlation-id', corrId);
	return mutableResp;
};

// --- Client Source ---

const CLIENT_TYPE_API = 'api';
const CLIENT_TYPE_BROWSER = 'browser';

/**
 * Detects whether a request originates from an API client or a browser
 * and stores the result in context for downstream middleware.
 */
export const clientSourceMiddleware: Middleware = (next) => async (req) => {
	const hasAuth = req.headers.get('authorization') !== null;
	const hasReferer = req.headers.get('referer') !== null;
	const hasCookie = req.headers.get('cookie') !== null;

	const clientType = hasAuth && !hasReferer && !hasCookie ? CLIENT_TYPE_API : CLIENT_TYPE_BROWSER;
	setCtx(req, CTX.CLIENT_TYPE, clientType);
	return next(req);
};

// --- Auth / JWT ---

interface KomodoClaims extends JWTPayload {
	scp?: string[];
	adm?: boolean;
	sub?: string;
	jti?: string;
}

/**
 * Validates an OAuth2 / JWT Bearer token, then attaches the decoded claims
 * (userId, sessionId, scopes, isAdmin) to request context.
 *
 * Requires JWT_SECRET env var (or use RS256 by providing JWT_PUBLIC_KEY).
 * Mirrors komodo-forge-sdk-go/auth/middleware.go AuthMiddleware.
 */
export function authMiddleware(secret: string): Middleware {
	return (next) => async (req) => {
		const authHeader = req.headers.get('authorization');
		if (!authHeader?.startsWith('Bearer ')) {
			return buildErrorResponse(req, Auth.InvalidToken, 'missing or invalid authorization header');
		}

		const token = authHeader.slice(7);

		let claims: KomodoClaims;
		try {
			claims = await verifyJWT<KomodoClaims>(token, secret);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'token validation failed';
			return buildErrorResponse(req, Auth.InvalidToken, msg);
		}

		setCtx(req, CTX.AUTH_VALID, true);
		if (claims.sub) setCtx(req, CTX.USER_ID, claims.sub);
		if (claims.jti) setCtx(req, CTX.SESSION_ID, claims.jti);

		const scopes = claims.scp ?? [];
		const isAdmin = claims.adm ?? false;

		if (scopes.length > 0) {
			setCtx(req, CTX.SCOPES, scopes);
			setCtx(req, CTX.CLIENT_TYPE, CLIENT_TYPE_API);
		}
		if (isAdmin || scopes.length === 0) {
			setCtx(req, CTX.CLIENT_TYPE, CLIENT_TYPE_BROWSER);
		}
		if (isAdmin) setCtx(req, CTX.IS_ADMIN, true);

		return next(req);
	};
}

/**
 * Rejects requests whose JWT does not carry a service-scoped token.
 * Service tokens must have at least one scope prefixed with "svc:".
 * Mirrors komodo-forge-sdk-go/auth/middleware.go RequireServiceScope.
 */
export const requireServiceScope: Middleware = (next) => (req) => {
	const scopes = getCtx(req, CTX.SCOPES) as string[] | undefined;
	if (!scopes || scopes.length === 0) {
		return Promise.resolve(buildErrorResponse(req, Auth.InsufficientScope));
	}
	const hasServiceScope = scopes.some((s) => s.startsWith('svc:'));
	if (!hasServiceScope) {
		return Promise.resolve(buildErrorResponse(req, Auth.InsufficientScope));
	}
	return next(req);
};

// --- Security Headers (Helmet-style) ---

/**
 * Adds standard security headers to every response.
 * Mirrors komodo-forge-sdk-go/http/headers/middleware.go.
 */
export const securityHeadersMiddleware: Middleware = (next) => async (req) => {
	const resp = await next(req);
	const mutable = new Response(resp.body, resp);
	mutable.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
	mutable.headers.set('X-Content-Type-Options', 'nosniff');
	mutable.headers.set('X-Frame-Options', 'DENY');
	mutable.headers.set('Referrer-Policy', 'no-referrer');
	mutable.headers.set('Permissions-Policy', 'geolocation=(), camera=()');
	mutable.headers.set('Cache-Control', 'no-store');
	return mutable;
};

// --- CORS ---

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
export function corsMiddleware(opts: CORSOptions = {}): Middleware {
	const origins = opts.allowedOrigins ?? ['*'];
	const methods = opts.allowedMethods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
	const headers = opts.allowedHeaders ?? ['Content-Type', 'Authorization', 'X-Request-ID', 'X-CSRF-Token'];
	const maxAge = opts.maxAge ?? 86_400;
	const creds = opts.allowCredentials ?? false;

	return (next) => async (req) => {
		const origin = req.headers.get('origin') ?? '';
		const allowed = origins.includes('*') || origins.includes(origin) ? origin : '';

		if (req.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: {
					'Access-Control-Allow-Origin': allowed,
					'Access-Control-Allow-Methods': methods.join(', '),
					'Access-Control-Allow-Headers': headers.join(', '),
					'Access-Control-Max-Age': String(maxAge),
					...(creds ? { 'Access-Control-Allow-Credentials': 'true' } : {}),
				},
			});
		}

		const resp = await next(req);
		const mutable = new Response(resp.body, resp);
		if (allowed) mutable.headers.set('Access-Control-Allow-Origin', allowed);
		if (creds) mutable.headers.set('Access-Control-Allow-Credentials', 'true');
		return mutable;
	};
}

// --- CSRF ---

/**
 * Double-submit cookie CSRF protection for browser clients.
 * API clients (detected by clientSourceMiddleware) are exempt.
 * Mirrors komodo-forge-sdk-go/http/csrf/middleware.go.
 */
export const csrfMiddleware: Middleware = (next) => async (req) => {
	const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
	if (safeMethods.has(req.method)) return next(req);

	const clientType = getCtx(req, CTX.CLIENT_TYPE) ?? CLIENT_TYPE_BROWSER;
	if (clientType === CLIENT_TYPE_API) {
		setCtx(req, CTX.CSRF_VALID, true);
		return next(req);
	}

	const csrfToken = req.headers.get('x-csrf-token');
	if (!csrfToken) {
		return buildErrorResponse(req, Global.BadRequest, 'invalid CSRF token');
	}

	setCtx(req, CTX.CSRF_VALID, true);
	return next(req);
};

// --- Rate Limiter ---

interface TokenBucket {
	tokens: number;
	lastMs: number;
}

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
export function rateLimiterMiddleware(opts: RateLimiterOptions = {}): Middleware {
	const rps = opts.rps ?? (Number(process.env['RATE_LIMIT_RPS']) || 10);
	const burst = opts.burst ?? (Number(process.env['RATE_LIMIT_BURST']) || 20);
	const failOpen = opts.failOpen ?? process.env['RATE_LIMIT_FAIL_OPEN'] !== 'false';
	const buckets = new Map<string, TokenBucket>();

	const defaultKey = (req: Request): string => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

	const keyFn = opts.keyFn ?? defaultKey;

	const allow = (key: string): { allowed: boolean; retryAfterMs: number } => {
		const now = Date.now();
		let b = buckets.get(key);
		if (!b) {
			b = { tokens: burst, lastMs: now };
			buckets.set(key, b);
		}

		const elapsed = (now - b.lastMs) / 1_000;
		b.tokens = Math.min(burst, b.tokens + elapsed * rps);
		b.lastMs = now;

		if (b.tokens >= 1) {
			b.tokens--;
			return { allowed: true, retryAfterMs: 0 };
		}

		const deficit = 1 - b.tokens;
		return { allowed: false, retryAfterMs: Math.ceil((deficit / rps) * 1_000) };
	};

	return (next) => async (req) => {
		try {
			const key = keyFn(req);
			const { allowed, retryAfterMs } = allow(key);

			if (!allowed) {
				const resp = buildErrorResponse(req, Global.TooManyRequests, 'rate limit exceeded');
				if (retryAfterMs > 0) {
					const mutable = new Response(resp.body, resp);
					mutable.headers.set('Retry-After', String(Math.ceil(retryAfterMs / 1_000)));
					return mutable;
				}
				return resp;
			}

			return next(req);
		} catch {
			if (failOpen) return next(req);
			return buildErrorResponse(req, Global.Internal, 'rate limiter error');
		}
	};
}

// --- Idempotency ---

const idempotencyStore = new Map<string, { expiresAt: number }>();

function cleanIdempotencyStore(): void {
	const now = Date.now();
	for (const [key, entry] of idempotencyStore) {
		if (now > entry.expiresAt) idempotencyStore.delete(key);
	}
}

/**
 * Guards against duplicate requests using the Idempotency-Key header.
 * Only applies to state-changing methods (POST, PUT, PATCH, DELETE).
 * API clients (M2M) are exempt.
 * Mirrors komodo-forge-sdk-go/idempotency/middleware.go.
 */
export function idempotencyMiddleware(ttlMs = 86_400_000): Middleware {
	return (next) => async (req) => {
		const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
		if (safeMethods.has(req.method)) return next(req);

		const clientType = getCtx(req, CTX.CLIENT_TYPE) ?? CLIENT_TYPE_BROWSER;
		if (clientType === CLIENT_TYPE_API) {
			setCtx(req, CTX.IDEMPOTENCY_VALID, true);
			return next(req);
		}

		const key = req.headers.get('idempotency-key');
		if (!key) {
			return buildErrorResponse(req, Global.BadRequest, 'idempotency key required');
		}

		cleanIdempotencyStore();

		if (idempotencyStore.has(key)) {
			const resp = buildErrorResponse(req, Global.Conflict, 'duplicate request');
			const mutable = new Response(resp.body, resp);
			mutable.headers.set('Idempotency-Replayed', 'true');
			return mutable;
		}

		idempotencyStore.set(key, { expiresAt: Date.now() + ttlMs });
		setCtx(req, CTX.IDEMPOTENCY_VALID, true);
		return next(req);
	};
}

// --- Sanitization ---

const SQL_INJECTION =
	/(?:union|select|insert|update|delete|drop|create|alter|exec(?:ute)?|script|javascript|onerror|onload|<script|<\/script)/i;
const XSS = /(?:<script|<\/script|javascript:|onerror=|onload=|<iframe|<\/iframe|<object|<\/object|<embed|<\/embed)/i;
const PATH_TRAV = /\.\.\/|\.\.[\\/]/g;
const NULL_BYTE = /\x00/g;

function sanitizeStr(s: string): string {
	return s.replace(NULL_BYTE, '').replace(PATH_TRAV, '').replace(SQL_INJECTION, '').replace(XSS, '').trim();
}

function sanitizeJSON(val: unknown): unknown {
	if (typeof val === 'string') return sanitizeStr(val);
	if (Array.isArray(val)) return val.map(sanitizeJSON);
	if (val !== null && typeof val === 'object') {
		return Object.fromEntries(
			Object.entries(val as Record<string, unknown>).map(([k, v]) => [sanitizeStr(k), sanitizeJSON(v)]),
		);
	}
	return val;
}

/**
 * Sanitizes request headers, query params, and JSON body against SQL injection,
 * XSS, path traversal, and null bytes.
 * Mirrors komodo-forge-sdk-go/http/sanitization/middleware.go.
 */
export const sanitizationMiddleware: Middleware = (next) => async (req) => {
	const url = new URL(req.url);

	const params = new URLSearchParams();
	for (const [k, v] of url.searchParams) {
		params.append(sanitizeStr(k), sanitizeStr(v));
	}
	url.search = params.toString();

	const sanitizedHeaders = new Headers();
	for (const [k, v] of req.headers) {
		sanitizedHeaders.set(k, sanitizeStr(v));
	}

	let body: string | ReadableStream | null = null;
	const ct = req.headers.get('content-type') ?? '';
	if (req.body && ct.includes('application/json')) {
		try {
			const raw = await req.json();
			body = JSON.stringify(sanitizeJSON(raw));
		} catch {
			return buildErrorResponse(req, Global.BadRequest, 'failed to parse JSON body');
		}
	} else {
		body = req.body;
	}

	const sanitizedInit: RequestInit = { method: req.method, headers: sanitizedHeaders, body };
	// duplex is required in Node.js when body is a readable stream
	if (req.body) (sanitizedInit as Record<string, unknown>)['duplex'] = 'half';
	const sanitizedReq = new Request(url.toString(), sanitizedInit);

	return next(sanitizedReq);
};

// --- Normalization ---

/**
 * Normalizes request headers (trim whitespace), URL path (trailing slashes,
 * double slashes), and query parameter casing for common values.
 * Mirrors komodo-forge-sdk-go/http/normalization/normalization.go.
 */
export const normalizationMiddleware: Middleware = (next) => async (req) => {
	const url = new URL(req.url);

	let path = url.pathname;
	if (path !== '/') path = path.replace(/\/+$/, '');
	path = path.replace(/\/\/+/g, '/');
	url.pathname = path;

	const booleanNorm: Record<string, string> = {
		True: 'true',
		TRUE: 'true',
		False: 'false',
		FALSE: 'false',
	};
	const caseNorm: Record<string, string> = {
		ASC: 'asc',
		Asc: 'asc',
		DESC: 'desc',
		Desc: 'desc',
		SORT: 'sort',
		Sort: 'sort',
	};

	const params = new URLSearchParams();
	for (const [k, v] of url.searchParams) {
		params.append(k.trim(), booleanNorm[v] ?? caseNorm[v] ?? v.trim());
	}
	url.search = params.toString();

	const normHeaders = new Headers();
	for (const [k, v] of req.headers) {
		normHeaders.set(k, v.trim());
	}

	const normInit: RequestInit = { method: req.method.toUpperCase(), headers: normHeaders, body: req.body };
	if (req.body) (normInit as Record<string, unknown>)['duplex'] = 'half';
	const normReq = new Request(url.toString(), normInit);

	return next(normReq);
};

// --- IP Access Control ---

export interface IPAccessOptions {
	whitelist?: string[];
	blacklist?: string[];
}

function ipInCIDR(ip: string, cidr: string): boolean {
	try {
		const [range, bits] = cidr.split('/');
		const mask = ~((1 << (32 - Number(bits))) - 1);
		const ipNum = ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
		const rangeNum = range!.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0;
		return (ipNum & mask) === (rangeNum & mask);
	} catch {
		return false;
	}
}

function ipAllowed(ip: string, opts: IPAccessOptions): boolean {
	const wl = opts.whitelist ?? [];
	const bl = opts.blacklist ?? [];

	if (wl.length > 0) {
		return wl.some((entry) => (entry.includes('/') ? ipInCIDR(ip, entry) : entry === ip));
	}
	if (bl.length > 0) {
		return !bl.some((entry) => (entry.includes('/') ? ipInCIDR(ip, entry) : entry === ip));
	}
	return true;
}

/**
 * IP whitelist/blacklist middleware.
 * CIDR ranges (e.g. "10.0.0.0/8") and exact IPs are both supported.
 * Mirrors komodo-forge-sdk-go/http/ipaccess.
 */
export function ipAccessMiddleware(opts: IPAccessOptions = {}): Middleware {
	const whitelistRaw = process.env['IP_WHITELIST'] ?? '';
	const blacklistRaw = process.env['IP_BLACKLIST'] ?? '';

	const whitelist = opts.whitelist ?? (whitelistRaw ? whitelistRaw.split(',').map((s) => s.trim()) : []);
	const blacklist = opts.blacklist ?? (blacklistRaw ? blacklistRaw.split(',').map((s) => s.trim()) : []);

	return (next) => async (req) => {
		const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown';

		if (!ipAllowed(ip, { whitelist, blacklist })) {
			return buildErrorResponse(req, Global.Forbidden, 'IP not allowed');
		}

		return next(req);
	};
}

// --- Redaction (logging) ---

const SENSITIVE_HEADER = /^(?:authorization|cookie|set-cookie|x-api-key|x-amz-signature)$/i;
const SENSITIVE_KEY = /(?:password|passwd|secret|credit_?card|card_?number|ssn|token|client_secret)/i;
const BEARER_TOKEN = /^\s*bearer\s+[\w\-._~+/]+=*$/i;

function redactHeaders(headers: Headers): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of headers) {
		out[k] = SENSITIVE_HEADER.test(k) || BEARER_TOKEN.test(v) ? '[REDACTED]' : v;
	}
	return out;
}

/**
 * Shallow redaction middleware — creates a sanitized copy of the request for
 * downstream logging without mutating the original.
 * Mirrors komodo-forge-sdk-go/http/redaction/middleware.go.
 */
export const redactionMiddleware: Middleware = (next) => async (req) => {
	const safeHeaders = redactHeaders(req.headers);

	const url = new URL(req.url);
	const params = new URLSearchParams();
	for (const [k, v] of url.searchParams) {
		params.append(k, SENSITIVE_KEY.test(k) ? '[REDACTED]' : v);
	}
	url.search = params.toString();

	const redactInit: RequestInit = { method: req.method, headers: safeHeaders, body: req.body };
	if (req.body) (redactInit as Record<string, unknown>)['duplex'] = 'half';
	const redactedReq = new Request(url.toString(), redactInit);

	return next(redactedReq);
};

// --- Telemetry / Request Logging ---

/**
 * Structured per-request telemetry logger.
 * Logs method, path, status, latency, bytes on every request.
 * Mirrors komodo-forge-sdk-go/http/telemetry/middleware.go.
 */
export const telemetryMiddleware: Middleware = (next) => async (req) => {
	const start = Date.now();
	const reqId = (getCtx(req, CTX.REQUEST_ID) as string | undefined) ?? req.headers.get('x-request-id') ?? '-';

	try {
		const resp = await next(req);
		const latencyMs = Date.now() - start;
		const url = new URL(req.url);

		const payload = {
			request_id: reqId,
			method: req.method,
			path: url.pathname,
			query: url.search,
			status: resp.status,
			latency_ms: latencyMs,
			user_agent: req.headers.get('user-agent') ?? '',
			referer: req.headers.get('referer') ?? '',
		};

		if (resp.status >= 400) {
			console.error(JSON.stringify({ level: 'error', msg: 'request failed', ...payload }));
		} else {
			console.log(JSON.stringify({ level: 'info', msg: 'request completed', ...payload }));
		}

		return resp;
	} catch (err) {
		const latencyMs = Date.now() - start;
		console.error(
			JSON.stringify({
				level: 'error',
				msg: 'request panicked',
				request_id: reqId,
				method: req.method,
				latency_ms: latencyMs,
				error: err instanceof Error ? err.message : String(err),
			}),
		);
		return buildErrorResponse(req, Global.Internal, 'unexpected error');
	}
};

// --- Context accessors (re-exported for use by handlers) ---

export const ContextKeys = CTX;

export function getRequestId(req: Request): string | undefined {
	return getCtx(req, CTX.REQUEST_ID) as string | undefined;
}
export function getCorrelationId(req: Request): string | undefined {
	return getCtx(req, CTX.CORRELATION_ID) as string | undefined;
}
export function getUserId(req: Request): string | undefined {
	return getCtx(req, CTX.USER_ID) as string | undefined;
}
export function getSessionId(req: Request): string | undefined {
	return getCtx(req, CTX.SESSION_ID) as string | undefined;
}
export function getScopes(req: Request): string[] | undefined {
	return getCtx(req, CTX.SCOPES) as string[] | undefined;
}
export function isAdmin(req: Request): boolean {
	return (getCtx(req, CTX.IS_ADMIN) as boolean | undefined) ?? false;
}
export function isAuthValid(req: Request): boolean {
	return (getCtx(req, CTX.AUTH_VALID) as boolean | undefined) ?? false;
}
export function getClientType(req: Request): string {
	return (getCtx(req, CTX.CLIENT_TYPE) as string | undefined) ?? CLIENT_TYPE_BROWSER;
}
