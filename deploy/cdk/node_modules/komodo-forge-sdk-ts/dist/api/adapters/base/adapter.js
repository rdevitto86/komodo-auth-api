import { AdapterError } from './errors.js';
export class BaseAdapter {
    baseURL;
    serviceToken;
    timeout;
    maxRetries;
    constructor(options) {
        this.baseURL = options.baseURL.replace(/\/$/, '');
        this.serviceToken = options.serviceToken;
        this.timeout = options.timeout ?? 10_000;
        this.maxRetries = options.maxRetries ?? 3;
    }
    buildHeaders(extra) {
        const headers = extra !== undefined ? new Headers(extra) : new Headers();
        headers.set('Content-Type', 'application/json');
        if (this.serviceToken !== undefined) {
            headers.set('Authorization', `Bearer ${this.serviceToken}`);
        }
        return headers;
    }
    async request(method, path, body, init) {
        const url = `${this.baseURL}${path.startsWith('/') ? path : `/${path}`}`;
        let lastError;
        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
            }, this.timeout);
            try {
                const fetchInit = {
                    ...init,
                    method,
                    headers: this.buildHeaders(init?.headers),
                    signal: controller.signal,
                };
                if (body !== undefined)
                    fetchInit.body = JSON.stringify(body);
                const response = await fetch(url, fetchInit);
                if (!response.ok) {
                    let code = 'UNKNOWN_ERROR';
                    let message = response.statusText;
                    try {
                        const err = (await response.json());
                        if (typeof err.code === 'string')
                            code = err.code;
                        if (typeof err.message === 'string')
                            message = err.message;
                    }
                    catch {
                        /* use status text as fallback */
                    }
                    throw new AdapterError(response.status, code, message);
                }
                // 204 No Content
                if (response.status === 204)
                    return undefined;
                return (await response.json());
            }
            catch (err) {
                // Never retry 4xx (except 429)
                if (err instanceof AdapterError && err.status >= 400 && err.status < 500 && err.status !== 429) {
                    throw err;
                }
                lastError = err;
                if (attempt < this.maxRetries) {
                    await new Promise((resolve) => {
                        setTimeout(resolve, 2 ** attempt * 100);
                    });
                }
            }
            finally {
                clearTimeout(timeoutId);
            }
        }
        throw lastError instanceof Error ? lastError : new Error('Request failed after retries');
    }
    get(path, init) {
        return this.request('GET', path, undefined, init);
    }
    post(path, body, init) {
        return this.request('POST', path, body, init);
    }
    put(path, body, init) {
        return this.request('PUT', path, body, init);
    }
    patch(path, body, init) {
        return this.request('PATCH', path, body, init);
    }
    delete(path, init) {
        return this.request('DELETE', path, undefined, init);
    }
}
//# sourceMappingURL=adapter.js.map