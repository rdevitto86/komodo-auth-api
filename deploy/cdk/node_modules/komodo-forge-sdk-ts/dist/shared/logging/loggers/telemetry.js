import { redact } from '../../redaction/index.js';
import { formatEvent } from '../common/format.js';
import { getOrCreateWorker } from '../common/worker/registry.js';
/**
 * Telemetry logger for sending telemetry data to the backend.
 *
 * - Browser-only: Uses sessionStorage for correlationId, sends to remote endpoint.
 * - Server-side: Uses X-Correlation-ID header, sends to remote endpoint.
 * - Always logs to console (with level filtering).
 */
export default class TelemetryLogger {
    static #instance = null;
    #ref;
    #service;
    #env;
    #version;
    #verbose;
    constructor(config) {
        if (TelemetryLogger.#instance)
            return TelemetryLogger.#instance;
        this.#service = config.service;
        this.#env = config.env;
        this.#version = config.version;
        this.#verbose = config.env !== 'production';
        this.#ref = getOrCreateWorker(config.transport);
        if (config.endpoint) {
            this.#ref.register('telemetry', {
                endpoint: config.endpoint,
                headers: config.headers ?? {},
                batchSize: config.batchSize ?? 10,
                flushInterval: config.flushInterval ?? 30_000,
            });
        }
        this.#ref.onError((err) => {
            console.warn('[TelemetryLogger] worker degraded, falling back to fetch:', err.message);
        });
        TelemetryLogger.#instance = this;
    }
    /** For testing only — clears the singleton so the next constructor call re-initializes. */
    static _reset() {
        TelemetryLogger.#instance = null;
    }
    trace(name, attributes, requestId) {
        const event = {
            timestamp: new Date().toISOString(),
            level: 'info',
            type: 'telemetry',
            service: this.#service,
            env: this.#env,
            version: this.#version,
            message: name,
            details: { name, ...attributes },
        };
        if (requestId !== undefined)
            event.requestId = requestId;
        if (this.#verbose)
            console.debug(formatEvent(event, true));
        this.#ref.send(redact(event));
    }
    flush() {
        this.#ref.flush('telemetry');
    }
    stop() {
        this.#ref.stop();
    }
}
//# sourceMappingURL=telemetry.js.map