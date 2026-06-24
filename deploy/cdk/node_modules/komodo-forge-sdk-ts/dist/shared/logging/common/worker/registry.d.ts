import type { BaseLogEvent, LogEventType, Transport } from '../base.js';
/**
 * Thin proxy returned to each logger class. All methods route through the shared registry.
 * Degradation (worker → fetch) is transparent — callers do not need to check worker state.
 */
export interface WorkerRef {
    register(type: LogEventType, cfg: {
        endpoint: string;
        headers: Record<string, string>;
        batchSize: number;
        flushInterval: number;
    }): void;
    send(event: BaseLogEvent): void;
    flush(type?: LogEventType): void;
    stop(): void;
    /** Subscribe to worker errors. Returns an unsubscribe function. */
    onError(handler: (err: Error) => void): () => void;
}
/**
 * Returns a WorkerRef backed by the shared worker thread.
 *
 * The first logger to call this creates the worker. The `transport` argument of every
 * subsequent caller is ignored — first caller wins. If the worker thread dies, all
 * registered onError handlers are called and the registry automatically degrades to fetch.
 */
export declare function getOrCreateWorker(transport?: Transport): WorkerRef;
/**
 * Tears down the worker and clears the globalThis registry.
 * For testing only — lets each test start with a clean slate.
 */
export declare function resetRegistry(): void;
//# sourceMappingURL=registry.d.ts.map