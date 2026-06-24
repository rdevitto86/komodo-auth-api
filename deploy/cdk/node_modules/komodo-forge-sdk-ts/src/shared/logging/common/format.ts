import type { BaseLogEvent } from './base.js';

/**
 * Formats a log event for console output.
 *
 * Format: TIMESTAMP [LEVEL|TYPE] message | { "key": "value", ... }
 *
 * Examples:
 *   2026-04-11T15:58:22.401Z [ERROR] Failed to process payment | { "transactionId": "tx_9821", "errorCode": "GATEWAY_TIMEOUT" }
 *   2026-04-11T15:58:22.401Z [CLICKSTREAM] click on #buy-now | { "action": "click", "target": { "id": "buy-now" } }
 *
 * Non-verbose (production): only runtime warn/error reach the console; all analytics are remote-only.
 * Returns an empty string when the event should be suppressed.
 */
export function formatEvent(event: BaseLogEvent, verbose: boolean): string {
	const isRuntime = event.type === 'runtime';

	if (!verbose) {
		if (!isRuntime || event.level === 'debug' || event.level === 'info') return '';
	}

	const label = isRuntime ? event.level.toUpperCase() : event.type.toUpperCase();
	const details =
		event.details !== undefined ? ' | ' + JSON.stringify(event.details, null, 2).replace(/\n\s*/g, ' ') : '';

	return `${event.timestamp} [${label}] ${event.message}${details}`;
}
