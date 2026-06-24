export const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

export const isNonNullish = <T>(value: T | null | undefined): value is T => value !== null && value !== undefined;

/** Exhaustive switch guard — throws at runtime with the unexpected value. */
export const assertNever = (value: never): never => {
	throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
};
