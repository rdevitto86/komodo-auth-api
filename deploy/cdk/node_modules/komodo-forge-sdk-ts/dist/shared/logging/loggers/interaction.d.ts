import type { BaseLogEvent, BaseLoggerConfig } from '../common/base.js';
export interface InteractionLoggerConfig extends BaseLoggerConfig {
}
export interface InteractionLogEvent extends BaseLogEvent {
    type: 'interaction';
    level: 'info';
    details: {
        correlationId?: string;
        action: string;
        url: string;
        data?: Record<string, unknown>;
        [key: string]: unknown;
    };
}
/**
 * Interaction logger for tracking user interactions in the browser.
 *
 * This logger is designed to work in browser environments only. In Node.js or Lambda environments,
 * the logger will be disabled and no events will be sent.
 */
export default class InteractionLogger {
    #private;
    constructor(config: InteractionLoggerConfig);
    /** For testing only — clears the singleton so the next constructor call re-initializes. */
    static _reset(): void;
    track(action: string, data?: Record<string, unknown>, requestId?: string): void;
    flush(): void;
    stop(): void;
}
//# sourceMappingURL=interaction.d.ts.map