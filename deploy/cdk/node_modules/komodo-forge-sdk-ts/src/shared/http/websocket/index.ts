// WebSocket client with reconnection and heartbeat.
// Mirrors komodo-forge-sdk-go/http/websocket/websocket.go.

export interface WebSocketClientOptions {
	/** Heartbeat interval in ms. Set to 0 to disable. Default: 30 000. */
	heartbeatIntervalMs?: number;
	/** Max reconnect attempts. Default: 10. */
	maxReconnectAttempts?: number;
	/** Base reconnect delay in ms (doubles each attempt). Default: 1 000. */
	reconnectBaseDelayMs?: number;
	/** Max reconnect delay cap in ms. Default: 30 000. */
	reconnectMaxDelayMs?: number;
	/** Additional headers to include on the initial HTTP upgrade (Node.js only). */
	headers?: Record<string, string>;
}

type MessageHandler = (data: string | ArrayBuffer | Blob) => void;
type CloseHandler = (code: number, reason: string) => void;
type ErrorHandler = (err: Event) => void;

export class WebSocketClient {
	private ws: WebSocket | null = null;
	private reconnectCount = 0;
	private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	private messageQueue: (string | ArrayBufferLike | Blob | ArrayBufferView)[] = [];
	private closed = false;

	private onMessageHandlers: MessageHandler[] = [];
	private onCloseHandlers: CloseHandler[] = [];
	private onErrorHandlers: ErrorHandler[] = [];

	private readonly opts: Required<WebSocketClientOptions>;

	constructor(
		private readonly url: string,
		opts: WebSocketClientOptions = {},
	) {
		this.opts = {
			heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 30_000,
			maxReconnectAttempts: opts.maxReconnectAttempts ?? 10,
			reconnectBaseDelayMs: opts.reconnectBaseDelayMs ?? 1_000,
			reconnectMaxDelayMs: opts.reconnectMaxDelayMs ?? 30_000,
			headers: opts.headers ?? {},
		};
	}

	/** Opens the WebSocket connection. Resolves when the connection is open. */
	connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.closed = false;
			this.ws = new WebSocket(this.url);
			this.ws.binaryType = 'arraybuffer';

			this.ws.onopen = () => {
				this.reconnectCount = 0;
				this.flushQueue();
				this.startHeartbeat();
				resolve();
			};

			this.ws.onmessage = (ev: MessageEvent) => {
				for (const h of this.onMessageHandlers) h(ev.data as string | ArrayBuffer | Blob);
			};

			this.ws.onerror = (ev: Event) => {
				for (const h of this.onErrorHandlers) h(ev);
				reject(ev);
			};

			this.ws.onclose = (ev: CloseEvent) => {
				this.stopHeartbeat();
				for (const h of this.onCloseHandlers) h(ev.code, ev.reason);
				if (!this.closed) this.scheduleReconnect();
			};
		});
	}

	/** Sends a text or binary message. Queues the message if not yet connected. */
	send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(data);
		} else {
			this.messageQueue.push(data);
		}
	}

	/** Gracefully closes the connection without triggering reconnection. */
	close(code = 1000, reason = 'normal closure'): void {
		this.closed = true;
		this.stopHeartbeat();
		this.ws?.close(code, reason);
		this.ws = null;
	}

	onMessage(handler: MessageHandler): this {
		this.onMessageHandlers.push(handler);
		return this;
	}
	onClose(handler: CloseHandler): this {
		this.onCloseHandlers.push(handler);
		return this;
	}
	onError(handler: ErrorHandler): this {
		this.onErrorHandlers.push(handler);
		return this;
	}

	get readyState(): number {
		return this.ws?.readyState ?? WebSocket.CLOSED;
	}
	get isConnected(): boolean {
		return this.readyState === WebSocket.OPEN;
	}

	private flushQueue(): void {
		while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
			const msg = this.messageQueue.shift()!;
			this.ws.send(msg);
		}
	}

	private startHeartbeat(): void {
		if (this.opts.heartbeatIntervalMs <= 0) return;
		this.heartbeatTimer = setInterval(() => {
			if (this.ws?.readyState === WebSocket.OPEN) {
				this.ws.send(JSON.stringify({ type: 'ping' }));
			}
		}, this.opts.heartbeatIntervalMs);
	}

	private stopHeartbeat(): void {
		if (this.heartbeatTimer !== null) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}
	}

	private scheduleReconnect(): void {
		if (this.reconnectCount >= this.opts.maxReconnectAttempts) return;

		const delay = Math.min(this.opts.reconnectBaseDelayMs * 2 ** this.reconnectCount, this.opts.reconnectMaxDelayMs);
		this.reconnectCount++;

		setTimeout(() => {
			if (!this.closed)
				this.connect().catch(() => {
					/* handled by onError */
				});
		}, delay);
	}
}

/**
 * Returns a 101 Switching Protocols response for WebSocket upgrade requests.
 * Most runtimes (Bun, Deno, Cloudflare Workers) handle the upgrade natively —
 * use their runtime-specific APIs instead. This helper is for environments
 * that need an explicit Response for routing purposes.
 */
export function websocketUpgradeResponse(): Response {
	return new Response(null, {
		status: 101,
		headers: {
			Upgrade: 'websocket',
			Connection: 'Upgrade',
		},
	});
}

/** @deprecated Use WebSocketClient instead. */
export const websocketHandler = websocketUpgradeResponse;
