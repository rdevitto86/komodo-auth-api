// HttpClient — typed fetch wrapper with circuit breaker, retry, and timeout.
// Mirrors the behaviour of komodo-forge-sdk-go/http/client.
export class ErrCircuitOpen extends Error {
    constructor() {
        super('circuit breaker is open');
        this.name = 'ErrCircuitOpen';
    }
}
export class HTTPError extends Error {
    status;
    body;
    constructor(status, body) {
        super(`upstream returned ${status}`);
        this.name = 'HTTPError';
        this.status = status;
        this.body = body;
    }
}
export default class HttpClient {
    baseURL;
    timeoutMs;
    defaultHeaders;
    maxRetries;
    breaker;
    constructor(opts = {}) {
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
    breakerEntry(host) {
        let entry = this.breaker.hosts.get(host);
        if (!entry) {
            entry = { state: 'closed', failures: 0, successes: 0, halfOpenInFlight: 0, openedAt: 0 };
            this.breaker.hosts.set(host, entry);
        }
        return entry;
    }
    breakerAllow(host) {
        if (!this.breaker)
            return true;
        const { cfg } = this.breaker;
        const e = this.breakerEntry(host);
        if (e.state === 'open') {
            if (Date.now() - e.openedAt < cfg.openTimeoutMs)
                return false;
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
    breakerOnStart(host) {
        if (!this.breaker)
            return;
        const e = this.breakerEntry(host);
        if (e.state === 'half-open')
            e.halfOpenInFlight++;
    }
    breakerOnSuccess(host) {
        if (!this.breaker)
            return;
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
        }
        else {
            e.failures = 0;
        }
    }
    breakerOnFailure(host) {
        if (!this.breaker)
            return;
        const { cfg } = this.breaker;
        const e = this.breakerEntry(host);
        if (e.state === 'half-open') {
            e.halfOpenInFlight = Math.max(0, e.halfOpenInFlight - 1);
            e.state = 'open';
            e.openedAt = Date.now();
            e.failures = 0;
            e.successes = 0;
        }
        else {
            e.failures++;
            if (e.failures >= cfg.failureThreshold) {
                e.state = 'open';
                e.openedAt = Date.now();
                e.failures = 0;
            }
        }
    }
    hostOf(url) {
        try {
            return new URL(url).host;
        }
        catch {
            return url;
        }
    }
    buildURL(path) {
        if (this.baseURL === '')
            return path;
        return `${this.baseURL}${path.startsWith('/') ? path : `/${path}`}`;
    }
    async do(request) {
        const host = this.hostOf(request.url);
        if (!this.breakerAllow(host))
            throw new ErrCircuitOpen();
        this.breakerOnStart(host);
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
        }, this.timeoutMs);
        try {
            const resp = await fetch(request, { signal: controller.signal });
            if (resp.status >= 400) {
                this.breakerOnFailure(host);
            }
            else {
                this.breakerOnSuccess(host);
            }
            return resp;
        }
        catch (err) {
            this.breakerOnFailure(host);
            throw err;
        }
        finally {
            clearTimeout(timer);
        }
    }
    /** Issues a GET and JSON-decodes a 2xx body into T. Throws HTTPError on non-2xx. */
    async getJSON(path, init) {
        const url = this.buildURL(path);
        let lastError;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            if (attempt > 0) {
                await new Promise((resolve) => {
                    setTimeout(resolve, 2 ** (attempt - 1) * 100);
                });
            }
            try {
                const req = new Request(url, {
                    ...init,
                    method: 'GET',
                    headers: { ...this.defaultHeaders, Accept: 'application/json', ...init?.headers },
                });
                const resp = await this.do(req);
                const body = await resp.json();
                if (!resp.ok) {
                    const err = new HTTPError(resp.status, body);
                    if (resp.status >= 400 && resp.status < 500 && resp.status !== 429)
                        throw err;
                    lastError = err;
                    continue;
                }
                return body;
            }
            catch (err) {
                if (err instanceof HTTPError && err.status >= 400 && err.status < 500 && err.status !== 429)
                    throw err;
                lastError = err;
            }
        }
        throw lastError instanceof Error ? lastError : new Error('request failed after retries');
    }
    /** Marshals body as JSON, issues a POST, and decodes a 2xx response into T. */
    async postJSON(path, body, init) {
        const url = this.buildURL(path);
        const payload = JSON.stringify(body);
        let lastError;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            if (attempt > 0) {
                await new Promise((resolve) => {
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
                        ...init?.headers,
                    },
                    body: payload,
                });
                const resp = await this.do(req);
                const respBody = resp.status === 204 ? undefined : await resp.json();
                if (!resp.ok) {
                    const err = new HTTPError(resp.status, respBody);
                    if (resp.status >= 400 && resp.status < 500 && resp.status !== 429)
                        throw err;
                    lastError = err;
                    continue;
                }
                return respBody;
            }
            catch (err) {
                if (err instanceof HTTPError && err.status >= 400 && err.status < 500 && err.status !== 429)
                    throw err;
                lastError = err;
            }
        }
        throw lastError instanceof Error ? lastError : new Error('request failed after retries');
    }
    /** Issues a PUT with a JSON body. */
    async putJSON(path, body, init) {
        return this.methodJSON('PUT', path, body, init);
    }
    /** Issues a PATCH with a JSON body. */
    async patchJSON(path, body, init) {
        return this.methodJSON('PATCH', path, body, init);
    }
    /** Issues a DELETE and decodes the 2xx response into T. */
    async deleteJSON(path, init) {
        const url = this.buildURL(path);
        const req = new Request(url, {
            ...init,
            method: 'DELETE',
            headers: { ...this.defaultHeaders, Accept: 'application/json', ...init?.headers },
        });
        const resp = await this.do(req);
        if (!resp.ok)
            throw new HTTPError(resp.status, await resp.json().catch(() => null));
        return (resp.status === 204 ? undefined : await resp.json());
    }
    async methodJSON(method, path, body, init) {
        const url = this.buildURL(path);
        const req = new Request(url, {
            ...init,
            method,
            headers: {
                ...this.defaultHeaders,
                'Content-Type': 'application/json',
                Accept: 'application/json',
                ...init?.headers,
            },
            body: JSON.stringify(body),
        });
        const resp = await this.do(req);
        if (!resp.ok)
            throw new HTTPError(resp.status, await resp.json().catch(() => null));
        return (resp.status === 204 ? undefined : await resp.json());
    }
}
//# sourceMappingURL=client.js.map