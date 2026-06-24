import { getCorrelationId } from '../../http/utils/index.js';
import { redact } from '../../redaction/index.js';
import { formatEvent } from '../common/format.js';
import { getOrCreateWorker } from '../common/worker/registry.js';
/**
 * Clickstream logger for tracking user interactions in the browser.
 *
 * This logger is designed to work in browser environments only. In Node.js or Lambda environments,
 * the logger will be disabled and no events will be sent.
 */
export default class ClickstreamLogger {
    static #instance = null;
    #ref;
    #service;
    #env;
    #version;
    #verbose;
    /** False in Node/Lambda — no DOM. Set once at construction. */
    #enabled;
    constructor(config) {
        if (ClickstreamLogger.#instance)
            return ClickstreamLogger.#instance;
        this.#service = config.service;
        this.#env = config.env;
        this.#version = config.version;
        this.#verbose = config.env !== 'production';
        this.#enabled = 'window' in globalThis;
        this.#ref = getOrCreateWorker(config.transport);
        if (this.#enabled && config.endpoint) {
            this.#ref.register('clickstream', {
                endpoint: config.endpoint,
                headers: config.headers ?? {},
                batchSize: config.batchSize ?? 20,
                flushInterval: config.flushInterval ?? 5_000,
            });
        }
        this.#ref.onError((err) => {
            console.warn('[ClickstreamLogger] worker degraded, falling back to fetch:', err.message);
        });
        ClickstreamLogger.#instance = this;
    }
    /** For testing only — clears the singleton so the next constructor call re-initializes. */
    static _reset() {
        ClickstreamLogger.#instance = null;
    }
    track(action, target, requestId) {
        if (!this.#enabled)
            return;
        const details = {
            action,
            target,
            url: globalThis.location?.href ?? '',
            correlationId: getCorrelationId(),
        };
        const w = globalThis.innerWidth;
        const h = globalThis.innerHeight;
        if (w !== undefined && h !== undefined)
            details.viewport = `${w}x${h}`;
        const event = {
            timestamp: new Date().toISOString(),
            level: 'info',
            type: 'clickstream',
            service: this.#service,
            env: this.#env,
            version: this.#version,
            message: `${action} on ${target.label ?? target.id ?? target.path ?? 'element'}`,
            details,
        };
        if (requestId !== undefined)
            event.requestId = requestId;
        if (this.#verbose)
            console.debug(formatEvent(event, true));
        this.#ref.send(redact(event));
    }
    flush() {
        this.#ref.flush('clickstream');
    }
    stop() {
        this.#ref.stop();
    }
}
//# sourceMappingURL=clickstream.js.map