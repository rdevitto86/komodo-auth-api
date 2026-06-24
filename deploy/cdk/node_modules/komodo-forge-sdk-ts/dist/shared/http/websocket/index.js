// WebSocket client with reconnection and heartbeat.
// Mirrors komodo-forge-sdk-go/http/websocket/websocket.go.
export class WebSocketClient {
    url;
    ws = null;
    reconnectCount = 0;
    heartbeatTimer = null;
    messageQueue = [];
    closed = false;
    onMessageHandlers = [];
    onCloseHandlers = [];
    onErrorHandlers = [];
    opts;
    constructor(url, opts = {}) {
        this.url = url;
        this.opts = {
            heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 30_000,
            maxReconnectAttempts: opts.maxReconnectAttempts ?? 10,
            reconnectBaseDelayMs: opts.reconnectBaseDelayMs ?? 1_000,
            reconnectMaxDelayMs: opts.reconnectMaxDelayMs ?? 30_000,
            headers: opts.headers ?? {},
        };
    }
    /** Opens the WebSocket connection. Resolves when the connection is open. */
    connect() {
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
            this.ws.onmessage = (ev) => {
                for (const h of this.onMessageHandlers)
                    h(ev.data);
            };
            this.ws.onerror = (ev) => {
                for (const h of this.onErrorHandlers)
                    h(ev);
                reject(ev);
            };
            this.ws.onclose = (ev) => {
                this.stopHeartbeat();
                for (const h of this.onCloseHandlers)
                    h(ev.code, ev.reason);
                if (!this.closed)
                    this.scheduleReconnect();
            };
        });
    }
    /** Sends a text or binary message. Queues the message if not yet connected. */
    send(data) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(data);
        }
        else {
            this.messageQueue.push(data);
        }
    }
    /** Gracefully closes the connection without triggering reconnection. */
    close(code = 1000, reason = 'normal closure') {
        this.closed = true;
        this.stopHeartbeat();
        this.ws?.close(code, reason);
        this.ws = null;
    }
    onMessage(handler) {
        this.onMessageHandlers.push(handler);
        return this;
    }
    onClose(handler) {
        this.onCloseHandlers.push(handler);
        return this;
    }
    onError(handler) {
        this.onErrorHandlers.push(handler);
        return this;
    }
    get readyState() {
        return this.ws?.readyState ?? WebSocket.CLOSED;
    }
    get isConnected() {
        return this.readyState === WebSocket.OPEN;
    }
    flushQueue() {
        while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
            const msg = this.messageQueue.shift();
            this.ws.send(msg);
        }
    }
    startHeartbeat() {
        if (this.opts.heartbeatIntervalMs <= 0)
            return;
        this.heartbeatTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.send(JSON.stringify({ type: 'ping' }));
            }
        }, this.opts.heartbeatIntervalMs);
    }
    stopHeartbeat() {
        if (this.heartbeatTimer !== null) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }
    scheduleReconnect() {
        if (this.reconnectCount >= this.opts.maxReconnectAttempts)
            return;
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
export function websocketUpgradeResponse() {
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
//# sourceMappingURL=index.js.map