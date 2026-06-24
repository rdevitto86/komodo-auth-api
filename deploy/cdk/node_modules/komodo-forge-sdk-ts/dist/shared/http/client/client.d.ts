export interface HttpClientOptions {
    baseURL?: string;
    timeout?: number;
    headers?: Record<string, string>;
    maxRetries?: number;
    circuitBreaker?: CircuitBreakerConfig;
}
export interface CircuitBreakerConfig {
    failureThreshold?: number;
    successThreshold?: number;
    openTimeoutMs?: number;
    maxHalfOpenRequests?: number;
}
export declare class ErrCircuitOpen extends Error {
    constructor();
}
export declare class HTTPError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(status: number, body: unknown);
}
export default class HttpClient {
    private readonly baseURL;
    private readonly timeoutMs;
    private readonly defaultHeaders;
    private readonly maxRetries;
    private readonly breaker;
    constructor(opts?: HttpClientOptions);
    private breakerEntry;
    private breakerAllow;
    private breakerOnStart;
    private breakerOnSuccess;
    private breakerOnFailure;
    private hostOf;
    private buildURL;
    do(request: Request): Promise<Response>;
    /** Issues a GET and JSON-decodes a 2xx body into T. Throws HTTPError on non-2xx. */
    getJSON<T>(path: string, init?: RequestInit): Promise<T>;
    /** Marshals body as JSON, issues a POST, and decodes a 2xx response into T. */
    postJSON<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
    /** Issues a PUT with a JSON body. */
    putJSON<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
    /** Issues a PATCH with a JSON body. */
    patchJSON<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
    /** Issues a DELETE and decodes the 2xx response into T. */
    deleteJSON<T>(path: string, init?: RequestInit): Promise<T>;
    private methodJSON;
}
//# sourceMappingURL=client.d.ts.map