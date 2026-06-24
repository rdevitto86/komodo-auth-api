/** Converts a cent amount to a locale-aware currency string. */
export const formatCurrency = (cents: number, currency: string, locale = 'en-US'): string =>
	new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);

export function formatDate(isoString: string, format: 'relative' | 'long' | 'short' = 'short'): string {
	const date = new Date(isoString);
	if (isNaN(date.getTime())) return isoString;

	if (format === 'relative') {
		const diffSec = Math.round(Math.abs(Date.now() - date.getTime()) / 1000);
		if (diffSec < 60) return 'just now';
		const diffMin = Math.round(diffSec / 60);
		if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
		const diffHour = Math.round(diffMin / 60);
		if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
		const diffDay = Math.round(diffHour / 24);
		return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
	}

	const options: Intl.DateTimeFormatOptions =
		format === 'long'
			? { year: 'numeric', month: 'long', day: 'numeric' }
			: { year: 'numeric', month: 'short', day: 'numeric' };

	return date.toLocaleDateString('en-US', options);
}
