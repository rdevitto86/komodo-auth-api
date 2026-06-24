const CORRELATION_KEY = 'komodo_cid';
let _cached: string | null = null;

/**
 * Returns the correlation ID for the current browser session.
 *
 * Generated once per tab via crypto.randomUUID(), persisted in sessionStorage.
 * Survives page navigations; resets when the tab closes.
 *
 * Server context: returns 'server' — pass X-Correlation-ID from the incoming
 * request as `correlationId` in log event `details` instead.
 */
export function getCorrelationId(): string {
	if (!('window' in globalThis)) return 'server';
	if (_cached !== null) return _cached;

	try {
		const stored = sessionStorage.getItem(CORRELATION_KEY);
		if (stored !== null) {
			_cached = stored;
			return _cached;
		}
		const id = crypto.randomUUID();
		sessionStorage.setItem(CORRELATION_KEY, id);
		_cached = id;
		return _cached;
	} catch {
		// sessionStorage unavailable (private browsing restrictions, cross-origin iframe, etc.)
		_cached = crypto.randomUUID();
		return _cached;
	}
}
