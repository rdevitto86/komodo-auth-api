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
export declare class WebSocketClient {
    private readonly url;
    private ws;
    private reconnectCount;
    private heartbeatTimer;
    private messageQueue;
    private closed;
    private onMessageHandlers;
    private onCloseHandlers;
    private onErrorHandlers;
    private readonly opts;
    constructor(url: string, opts?: WebSocketClientOptions);
    /** Opens the WebSocket connection. Resolves when the connection is open. */
    connect(): Promise<void>;
    /** Sends a text or binary message. Queues the message if not yet connected. */
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
    /** Gracefully closes the connection without triggering reconnection. */
    close(code?: number, reason?: string): void;
    onMessage(handler: MessageHandler): this;
    onClose(handler: CloseHandler): this;
    onError(handler: ErrorHandler): this;
    get readyState(): number;
    get isConnected(): boolean;
    private flushQueue;
    private startHeartbeat;
    private stopHeartbeat;
    private scheduleReconnect;
}
/**
 * Returns a 101 Switching Protocols response for WebSocket upgrade requests.
 * Most runtimes (Bun, Deno, Cloudflare Workers) handle the upgrade natively —
 * use their runtime-specific APIs instead. This helper is for environments
 * that need an explicit Response for routing purposes.
 */
export declare function websocketUpgradeResponse(): Response;
/** @deprecated Use WebSocketClient instead. */
export declare const websocketHandler: typeof websocketUpgradeResponse;
export {};
//# sourceMappingURL=index.d.ts.map