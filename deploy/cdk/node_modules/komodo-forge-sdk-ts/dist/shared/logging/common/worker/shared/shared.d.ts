export type WorkerDirective = 'CONFIG' | 'LOG' | 'FLUSH' | 'STOP';
export type WorkerAck = 'ERROR' | 'STOP';
export interface WorkerMessage {
    directive: WorkerDirective;
    provider?: string;
    payload?: unknown;
}
export interface WorkerAckMessage {
    directive: WorkerAck;
    provider?: string;
    payload?: unknown;
}
export type PostFn = (msg: WorkerAckMessage) => void;
export declare function createWorkerLogic(post: PostFn): {
    handleMessage: (msg: WorkerMessage) => Promise<void>;
};
//# sourceMappingURL=shared.d.ts.map