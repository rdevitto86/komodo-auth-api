import { getCorrelationId } from '../../http/utils/index.js';
import { redact } from '../../redaction/index.js';
import { formatEvent } from '../common/format.js';
import { getOrCreateWorker } from '../common/worker/registry.js';
/**
 * Interaction logger for tracking user interactions in the browser.
 *
 * This logger is designed to work in browser environments only. In Node.js or Lambda environments,
 * the logger will be disabled and no events will be sent.
 */
export default class InteractionLogger {
    static #instance = null;
    #ref;
    #service;
    #env;
    #version;
    #verbose;
    /** False in Node/Lambda — semantic UI events have no meaning outside a browser. */
    #enabled;
    constructor(config) {
        if (InteractionLogger.#instance)
            return InteractionLogger.#instance;
        this.#service = config.service;
        this.#env = config.env;
        this.#version = config.version;
        this.#verbose = config.env !== 'production';
        this.#enabled = 'window' in globalThis;
        this.#ref = getOrCreateWorker(config.transport);
        if (this.#enabled && config.endpoint) {
            this.#ref.register('interaction', {
                endpoint: config.endpoint,
                headers: config.headers ?? {},
                batchSize: config.batchSize ?? 10,
                flushInterval: config.flushInterval ?? 10_000,
            });
        }
        this.#ref.onError((err) => {
            console.warn('[InteractionLogger] worker degraded, falling back to fetch:', err.message);
        });
        InteractionLogger.#instance = this;
    }
    /** For testing only — clears the singleton so the next constructor call re-initializes. */
    static _reset() {
        InteractionLogger.#instance = null;
    }
    track(action, data, requestId) {
        if (!this.#enabled)
            return;
        const details = {
            action,
            url: globalThis.location?.href ?? '',
            correlationId: getCorrelationId(),
        };
        if (data !== undefined)
            details.data = data;
        const event = {
            timestamp: new Date().toISOString(),
            level: 'info',
            type: 'interaction',
            service: this.#service,
            env: this.#env,
            version: this.#version,
            message: action,
            details,
        };
        if (requestId !== undefined)
            event.requestId = requestId;
        if (this.#verbose)
            console.debug(formatEvent(event, true));
        this.#ref.send(redact(event));
    }
    flush() {
        this.#ref.flush('interaction');
    }
    stop() {
        this.#ref.stop();
    }
}
//# sourceMappingURL=interaction.js.map