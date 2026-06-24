export function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K> {
	const keySet = new Set<PropertyKey>(keys);
	return Object.fromEntries(Object.entries(obj).filter(([k]) => !keySet.has(k))) as Omit<T, K>;
}

export function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
	const result = {} as Pick<T, K>;
	for (const key of keys) {
		if (key in obj) result[key] = obj[key];
	}
	return result;
}

export function groupBy<T>(arr: readonly T[], key: (item: T) => string): Record<string, T[]> {
	const result: Record<string, T[]> = {};
	for (const item of arr) {
		const k = key(item);
		const group = result[k];
		if (group !== undefined) {
			group.push(item);
		} else {
			result[k] = [item];
		}
	}
	return result;
}

export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
	const output: Record<string, unknown> = { ...target };
	const isPlainObject = (value: unknown): value is Record<string, unknown> =>
		typeof value === 'object' && value !== null && !Array.isArray(value);

	for (const key of Object.keys(source) as Array<keyof T & string>) {
		const srcVal = source[key];
		const tgtVal = output[key];

		if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
			output[key] = deepMerge(tgtVal, srcVal as Partial<typeof tgtVal>);
		} else if (srcVal !== undefined) {
			output[key] = srcVal;
		}
	}
	return output as T;
}

export const shallowCopy = <T>(obj: T): T => ({ ...obj });

export const deepCopy = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));
