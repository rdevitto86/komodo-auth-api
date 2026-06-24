import { redact } from '../../redaction/index.js';
import { formatEvent } from '../common/format.js';
import { getOrCreateWorker } from '../common/worker/registry.js';
const LEVEL_WEIGHT = { debug: 1, info: 2, warn: 3, error: 4 };
/**
 * Runtime logger for application-level events.
 *
 * - Browser-only: Uses sessionStorage for correlationId, sends to remote endpoint.
 * - Server-side: Uses X-Correlation-ID header, sends to remote endpoint.
 * - Always logs to console (with level filtering).
 */
export default class RuntimeLogger {
    static #instance = null;
    #ref;
    #service;
    #env;
    #version;
    #verbose;
    #minLevel;
    #enableRemote;
    constructor(config) {
        if (RuntimeLogger.#instance)
            return RuntimeLogger.#instance;
        this.#service = config.service;
        this.#env = config.env;
        this.#version = config.version;
        this.#verbose = config.env !== 'production';
        this.#minLevel = LEVEL_WEIGHT[config.level ?? 'warn'];
        this.#enableRemote = !!config.endpoint;
        this.#ref = getOrCreateWorker(config.transport);
        if (config.endpoint) {
            this.#ref.register('runtime', {
                endpoint: config.endpoint,
                headers: config.headers ?? {},
                batchSize: config.batchSize ?? 10,
                flushInterval: config.flushInterval ?? 10_000,
            });
        }
        this.#ref.onError((err) => {
            console.warn('[RuntimeLogger] worker degraded, falling back to fetch:', err.message);
        });
        RuntimeLogger.#instance = this;
    }
    /** For testing only — clears the singleton so the next constructor call re-initializes. */
    static _reset() {
        RuntimeLogger.#instance = null;
    }
    /** Local console only. Never shipped remotely regardless of endpoint config. */
    debug(message, details, requestId) {
        if (LEVEL_WEIGHT.debug < this.#minLevel)
            return;
        const event = this.#build('debug', message, details, requestId);
        consoleOut('debug', event, this.#verbose);
    }
    info(message, details, requestId) {
        if (LEVEL_WEIGHT.info < this.#minLevel)
            return;
        const event = this.#build('info', message, details, requestId);
        consoleOut('info', event, this.#verbose);
        if (this.#enableRemote)
            this.#ship(event);
    }
    warn(message, details, requestId) {
        if (LEVEL_WEIGHT.warn < this.#minLevel)
            return;
        const event = this.#build('warn', message, details, requestId);
        consoleOut('warn', event, this.#verbose);
        if (this.#enableRemote)
            this.#ship(event);
    }
    error(message, details, requestId) {
        /* istanbul ignore next -- error is the highest level; minLevel can never exceed it */
        if (LEVEL_WEIGHT.error < this.#minLevel)
            return;
        const event = this.#build('error', message, details, requestId);
        consoleOut('error', event, this.#verbose);
        if (this.#enableRemote)
            this.#ship(event);
    }
    flush() {
        this.#ref.flush('runtime');
    }
    stop() {
        this.#ref.stop();
    }
    #build(level, message, details, requestId) {
        const event = {
            timestamp: new Date().toISOString(),
            level,
            type: 'runtime',
            service: this.#service,
            env: this.#env,
            version: this.#version,
            message,
        };
        if (requestId !== undefined)
            event.requestId = requestId;
        if (details !== undefined)
            event.details = details;
        return event;
    }
    #ship(event) {
        this.#ref.send(redact(event));
    }
}
function consoleOut(level, event, verbose = false) {
    /* istanbul ignore next -- event is always a typed RuntimeLogEvent; null guard is defensive */
    if (!event)
        return;
    const formatted = formatEvent(event, verbose);
    switch (level) {
        case 'debug':
            console.debug(formatted);
            break;
        case 'info':
            console.info(formatted);
            break;
        case 'warn':
            console.warn(formatted);
            break;
        case 'error':
            console.error(formatted);
            break;
    }
}
//# sourceMappingURL=runtime.js.map