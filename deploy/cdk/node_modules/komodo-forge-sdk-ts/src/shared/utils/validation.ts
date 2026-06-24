export const isValidEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

/** E.164 format — e.g. +15551234567 */
export const isValidPhone = (value: string): boolean => /^\+[1-9]\d{7,14}$/.test(value);

export const isValidUUID = (value: string): boolean =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

/** Crockford Base32 — 26 characters */
export const isValidULID = (value: string): boolean => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);

export function isValidURL(value: string, allowedProtocols?: readonly string[]): boolean {
	try {
		const url = new URL(value).protocol.replace(/:$/, '');
		return allowedProtocols !== undefined && allowedProtocols.length > 0 ? allowedProtocols.includes(url) : true;
	} catch {
		return false;
	}
}

/** Positive, finite number with at most two decimal places */
export const isValidPrice = (value: number): boolean =>
	Number.isFinite(value) && value >= 0 && Math.round(value * 100) / 100 === value;
