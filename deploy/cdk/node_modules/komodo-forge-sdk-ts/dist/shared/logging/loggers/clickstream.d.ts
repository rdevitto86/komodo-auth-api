import type { BaseLogEvent, BaseLoggerConfig } from '../common/base.js';
export interface ClickstreamLoggerConfig extends BaseLoggerConfig {
}
export interface ClickstreamLogEvent extends BaseLogEvent {
    type: 'clickstream';
    level: 'info';
    details: {
        correlationId?: string;
        action: 'click' | 'hover' | 'scroll' | 'submit' | 'input' | 'focus' | 'blur';
        target: {
            id?: string;
            label?: string;
            text?: string;
            path?: string;
            aria?: string;
        };
        url: string;
        viewport?: string;
        [key: string]: unknown;
    };
}
/**
 * Clickstream logger for tracking user interactions in the browser.
 *
 * This logger is designed to work in browser environments only. In Node.js or Lambda environments,
 * the logger will be disabled and no events will be sent.
 */
export default class ClickstreamLogger {
    #private;
    constructor(config: ClickstreamLoggerConfig);
    /** For testing only — clears the singleton so the next constructor call re-initializes. */
    static _reset(): void;
    track(action: ClickstreamLogEvent['details']['action'], target: ClickstreamLogEvent['details']['target'], requestId?: string): void;
    flush(): void;
    stop(): void;
}
//# sourceMappingURL=clickstream.d.ts.map