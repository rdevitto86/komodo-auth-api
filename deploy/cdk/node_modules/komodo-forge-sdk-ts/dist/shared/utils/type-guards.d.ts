export declare const isDefined: <T>(value: T | undefined) => value is T;
export declare const isNonNullish: <T>(value: T | null | undefined) => value is T;
/** Exhaustive switch guard — throws at runtime with the unexpected value. */
export declare const assertNever: (value: never) => never;
//# sourceMappingURL=type-guards.d.ts.map