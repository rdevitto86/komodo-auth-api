export interface BaseAdapterOptions {
    baseURL: string;
    serviceToken?: string;
    /** Request timeout in ms. Defaults to 10 000. */
    timeout?: number;
    /** Max retry attempts on 429 / 5xx. Defaults to 3. */
    maxRetries?: number;
}
export declare class BaseAdapter {
    protected readonly baseURL: string;
    private readonly serviceToken;
    private readonly timeout;
    private readonly maxRetries;
    constructor(options: BaseAdapterOptions);
    private buildHeaders;
    private request;
    protected get<T>(path: string, init?: RequestInit): Promise<T>;
    protected post<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
    protected put<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
    protected patch<T>(path: string, body: unknown, init?: RequestInit): Promise<T>;
    protected delete<T>(path: string, init?: RequestInit): Promise<T>;
}
//# sourceMappingURL=adapter.d.ts.map