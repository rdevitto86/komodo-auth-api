export declare function getEnvString(key: string): string | undefined;
export declare function getEnvString(key: string, fallback: string): string;
export declare function requireEnvString(key: string): string;
export declare function getEnvNumber(key: string): number | undefined;
export declare function getEnvNumber(key: string, fallback: number): number;
export declare function requireEnvNumber(key: string): number;
export declare function getEnvBoolean(key: string): boolean | undefined;
export declare function getEnvBoolean(key: string, fallback: boolean): boolean;
export declare function requireEnvBoolean(key: string): boolean;
/** Throws at startup if any of the listed env vars are missing or empty. */
export declare function validateRequiredEnv(keys: readonly string[]): void;
//# sourceMappingURL=utils.d.ts.map