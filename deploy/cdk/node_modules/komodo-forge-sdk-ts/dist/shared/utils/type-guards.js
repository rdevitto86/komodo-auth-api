export const isDefined = (value) => value !== undefined;
export const isNonNullish = (value) => value !== null && value !== undefined;
/** Exhaustive switch guard — throws at runtime with the unexpected value. */
export const assertNever = (value) => {
    throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
};
//# sourceMappingURL=type-guards.js.map