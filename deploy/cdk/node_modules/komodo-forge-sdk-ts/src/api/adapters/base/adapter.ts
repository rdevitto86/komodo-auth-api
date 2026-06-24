import { AdapterError } from './errors.js';

export interface BaseAdapterOptions {
	baseURL: string;
	serviceToken?: string;
	/** Request timeout in ms. Defaults to 10 000. */
	timeout?: number;
	/** Max retry attempts on 429 / 5xx. Defaults to 3. */
	maxRetries?: number;
}

export class BaseAdapter {
	protected readonly baseURL: string;
	private readonly serviceToken: string | undefined;
	private readonly timeout: number;
	private readonly maxRetries: number;

	constructor(options: BaseAdapterOptions) {
		this.baseURL = options.baseURL.replace(/\/$/, '');
		this.serviceToken = options.serviceToken;
		this.timeout = options.timeout ?? 10_000;
		this.maxRetries = options.maxRetries ?? 3;
	}

	private buildHeaders(extra: RequestInit['headers']): Headers {
		const headers = extra !== undefined ? new Headers(extra) : new Headers();
		headers.set('Content-Type', 'application/json');
		if (this.serviceToken !== undefined) {
			headers.set('Authorization', `Bearer ${this.serviceToken}`);
		}
		return headers;
	}

	private async request<T>(method: string, path: string, body?: unknown, init?: RequestInit): Promise<T> {
		const url = `${this.baseURL}${path.startsWith('/') ? path : `/${path}`}`;
		let lastError: unknown;

		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => {
				controller.abort();
			}, this.timeout);

			try {
				const fetchInit: RequestInit = {
					...init,
					method,
					headers: this.buildHeaders(init?.headers),
					signal: controller.signal,
				};
				if (body !== undefined) fetchInit.body = JSON.stringify(body);

				const response = await fetch(url, fetchInit);

				if (!response.ok) {
					let code = 'UNKNOWN_ERROR';
					let message = response.statusText;
					try {
						const err = (await response.json()) as { code?: string; message?: string };
						if (typeof err.code === 'string') code = err.code;
						if (typeof err.message === 'string') message = err.message;
					} catch {
						/* use status text as fallback */
					}
					throw new AdapterError(response.status, code, message);
				}

				// 204 No Content
				if (response.status === 204) return undefined as T;

				return (await response.json()) as T;
			} catch (err) {
				// Never retry 4xx (except 429)
				if (err instanceof AdapterError && err.status >= 400 && err.status < 500 && err.status !== 429) {
					throw err;
				}
				lastError = err;
				if (attempt < this.maxRetries) {
					await new Promise<void>((resolve) => {
						setTimeout(resolve, 2 ** attempt * 100);
					});
				}
			} finally {
				clearTimeout(timeoutId);
			}
		}

		throw lastError instanceof Error ? lastError : new Error('Request failed after retries');
	}

	protected get<T>(path: string, init?: RequestInit): Promise<T> {
		return this.request<T>('GET', path, undefined, init);
	}

	protected post<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
		return this.request<T>('POST', path, body, init);
	}

	protected put<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
		return this.request<T>('PUT', path, body, init);
	}

	protected patch<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
		return this.request<T>('PATCH', path, body, init);
	}

	protected delete<T>(path: string, init?: RequestInit): Promise<T> {
		return this.request<T>('DELETE', path, undefined, init);
	}
}
