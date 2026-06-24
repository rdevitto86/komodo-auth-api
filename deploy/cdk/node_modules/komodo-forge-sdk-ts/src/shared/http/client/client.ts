// HttpClient — typed fetch wrapper with circuit breaker, retry, and timeout.
// Mirrors the behaviour of komodo-forge-sdk-go/http/client.

export interface HttpClientOptions {
	baseURL?: string;
	timeout?: number;
	headers?: Record<string, string>;
	maxRetries?: number;
	circuitBreaker?: CircuitBreakerConfig;
}

export interface CircuitBreakerConfig {
	failureThreshold?: number; // failures before opening; default 5
	successThreshold?: number; // consecutive successes to close; default 2
	openTimeoutMs?: number; // how long Open stays before moving to HalfOpen; default 60 000
	maxHalfOpenRequests?: number; // concurrent probe requests; default 1
}

type BreakerState = 'closed' | 'open' | 'half-open';

interface BreakerEntry {
	state: BreakerState;
	failures: number;
	successes: number;
	halfOpenInFlight: number;
	openedAt: number;
}

export class ErrCircuitOpen extends Error {
	constructor() {
		super('circuit breaker is open');
		this.name = 'ErrCircuitOpen';
	}
}

export class HTTPError extends Error {
	readonly status: number;
	readonly body: unknown;

	constructor(status: number, body: unknown) {
		super(`upstream returned ${status}`);
		this.name = 'HTTPError';
		this.status = status;
		this.body = body;
	}
}

export default class HttpClient {
	private readonly baseURL: string;
	private readonly timeoutMs: number;
	private readonly defaultHeaders: Record<string, string>;
	private readonly maxRetries: number;
	private readonly breaker: {
		cfg: Required<CircuitBreakerConfig>;
		hosts: Map<string, BreakerEntry>;
	} | null;

	constructor(opts: HttpClientOptions = {}) {
		this.baseURL = opts.baseURL?.replace(/\/$/, '') ?? '';
		this.timeoutMs = opts.timeout ?? 30_000;
		this.defaultHeaders = opts.headers ?? {};
		this.maxRetries = opts.maxRetries ?? 0;
		this.breaker = opts.circuitBreaker
			? {
					cfg: {
						failureThreshold: opts.circuitBreaker.failureThreshold ?? 5,
						successThreshold: opts.circuitBreaker.successThreshold ?? 2,
						openTimeoutMs: opts.circuitBreaker.openTimeoutMs ?? 60_000,
						maxHalfOpenRequests: opts.circuitBreaker.maxHalfOpenRequests ?? 1,
					},
					hosts: new Map(),
				}
			: null;
	}

	private breakerEntry(host: string): BreakerEntry {
		let entry = this.breaker!.hosts.get(host);
		if (!entry) {
			entry = { state: 'closed', failures: 0, successes: 0, halfOpenInFlight: 0, openedAt: 0 };
			this.breaker!.hosts.set(host, entry);
		}
		return entry;
	}

	private breakerAllow(host: string): boolean {
		if (!this.breaker) return true;
		const { cfg } = this.breaker;
		const e = this.breakerEntry(host);

		if (e.state === 'open') {
			if (Date.now() - e.openedAt < cfg.openTimeoutMs) return false;
			e.state = 'half-open';
			e.failures = 0;
			e.successes = 0;
			e.halfOpenInFlight = 0;
		}

		if (e.state === 'half-open') {
			return e.halfOpenInFlight < cfg.maxHalfOpenRequests;
		}

		return true;
	}

	private breakerOnStart(host: string): void {
		if (!this.breaker) return;
		const e = this.breakerEntry(host);
		if (e.state === 'half-open') e.halfOpenInFlight++;
	}

	private breakerOnSuccess(host: string): void {
		if (!this.breaker) return;
		const { cfg } = this.breaker;
		const e = this.breakerEntry(host);

		if (e.state === 'half-open') {
			e.halfOpenInFlight = Math.max(0, e.halfOpenInFlight - 1);
			e.successes++;
			if (e.successes >= cfg.successThreshold) {
				e.state = 'closed';
				e.failures = 0;
				e.successes = 0;
			}
		} else {
			e.failures = 0;
		}
	}

	private breakerOnFailure(host: string): void {
		if (!this.breaker) return;
		const { cfg } = this.breaker;
		const e = this.breakerEntry(host);

		if (e.state === 'half-open') {
			e.halfOpenInFlight = Math.max(0, e.halfOpenInFlight - 1);
			e.state = 'open';
			e.openedAt = Date.now();
			e.failures = 0;
			e.successes = 0;
		} else {
			e.failures++;
			if (e.failures >= cfg.failureThreshold) {
				e.state = 'open';
				e.openedAt = Date.now();
				e.failures = 0;
			}
		}
	}

	private hostOf(url: string): string {
		try {
			return new URL(url).host;
		} catch {
			return url;
		}
	}

	private buildURL(path: string): string {
		if (this.baseURL === '') return path;
		return `${this.baseURL}${path.startsWith('/') ? path : `/${path}`}`;
	}

	async do(request: Request): Promise<Response> {
		const host = this.hostOf(request.url);

		if (!this.breakerAllow(host)) throw new ErrCircuitOpen();
		this.breakerOnStart(host);

		const controller = new AbortController();
		const timer = setTimeout(() => {
			controller.abort();
		}, this.timeoutMs);

		try {
			const resp = await fetch(request, { signal: controller.signal });
			if (resp.status >= 400) {
				this.breakerOnFailure(host);
			} else {
				this.breakerOnSuccess(host);
			}
			return resp;
		} catch (err) {
			this.breakerOnFailure(host);
			throw err;
		} finally {
			clearTimeout(timer);
		}
	}

	/** Issues a GET and JSON-decodes a 2xx body into T. Throws HTTPError on non-2xx. */
	async getJSON<T>(path: string, init?: RequestInit): Promise<T> {
		const url = this.buildURL(path);
		let lastError: unknown;

		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			if (attempt > 0) {
				await new Promise<void>((resolve) => {
					setTimeout(resolve, 2 ** (attempt - 1) * 100);
				});
			}

			try {
				const req = new Request(url, {
					...init,
					method: 'GET',
					headers: { ...this.defaultHeaders, Accept: 'application/json', ...(init?.headers as Record<string, string>) },
				});
				const resp = await this.do(req);
				const body = await resp.json();

				if (!resp.ok) {
					const err = new HTTPError(resp.status, body);
					if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) throw err;
					lastError = err;
					continue;
				}
				return body as T;
			} catch (err) {
				if (err instanceof HTTPError && err.status >= 400 && err.status < 500 && err.status !== 429) throw err;
				lastError = err;
			}
		}

		throw lastError instanceof Error ? lastError : new Error('request failed after retries');
	}

	/** Marshals body as JSON, issues a POST, and decodes a 2xx response into T. */
	async postJSON<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
		const url = this.buildURL(path);
		const payload = JSON.stringify(body);
		let lastError: unknown;

		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			if (attempt > 0) {
				await new Promise<void>((resolve) => {
					setTimeout(resolve, 2 ** (attempt - 1) * 100);
				});
			}

			try {
				const req = new Request(url, {
					...init,
					method: 'POST',
					headers: {
						...this.defaultHeaders,
						'Content-Type': 'application/json',
						Accept: 'application/json',
						...(init?.headers as Record<string, string>),
					},
					body: payload,
				});
				const resp = await this.do(req);
				const respBody = resp.status === 204 ? undefined : await resp.json();

				if (!resp.ok) {
					const err = new HTTPError(resp.status, respBody);
					if (resp.status >= 400 && resp.status < 500 && resp.status !== 429) throw err;
					lastError = err;
					continue;
				}
				return respBody as T;
			} catch (err) {
				if (err instanceof HTTPError && err.status >= 400 && err.status < 500 && err.status !== 429) throw err;
				lastError = err;
			}
		}

		throw lastError instanceof Error ? lastError : new Error('request failed after retries');
	}

	/** Issues a PUT with a JSON body. */
	async putJSON<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
		return this.methodJSON<T>('PUT', path, body, init);
	}

	/** Issues a PATCH with a JSON body. */
	async patchJSON<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
		return this.methodJSON<T>('PATCH', path, body, init);
	}

	/** Issues a DELETE and decodes the 2xx response into T. */
	async deleteJSON<T>(path: string, init?: RequestInit): Promise<T> {
		const url = this.buildURL(path);
		const req = new Request(url, {
			...init,
			method: 'DELETE',
			headers: { ...this.defaultHeaders, Accept: 'application/json', ...(init?.headers as Record<string, string>) },
		});
		const resp = await this.do(req);
		if (!resp.ok) throw new HTTPError(resp.status, await resp.json().catch(() => null));
		return (resp.status === 204 ? undefined : await resp.json()) as T;
	}

	private async methodJSON<T>(method: string, path: string, body: unknown, init?: RequestInit): Promise<T> {
		const url = this.buildURL(path);
		const req = new Request(url, {
			...init,
			method,
			headers: {
				...this.defaultHeaders,
				'Content-Type': 'application/json',
				Accept: 'application/json',
				...(init?.headers as Record<string, string>),
			},
			body: JSON.stringify(body),
		});
		const resp = await this.do(req);
		if (!resp.ok) throw new HTTPError(resp.status, await resp.json().catch(() => null));
		return (resp.status === 204 ? undefined : await resp.json()) as T;
	}
}
