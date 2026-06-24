export declare function omit<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Omit<T, K>;
export declare function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K>;
export declare function groupBy<T>(arr: readonly T[], key: (item: T) => string): Record<string, T[]>;
export declare function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T;
export declare const shallowCopy: <T>(obj: T) => T;
export declare const deepCopy: <T>(obj: T) => T;
//# sourceMappingURL=objects.d.ts.map