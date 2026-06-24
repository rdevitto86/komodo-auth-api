export declare const isValidEmail: (value: string) => boolean;
/** E.164 format — e.g. +15551234567 */
export declare const isValidPhone: (value: string) => boolean;
export declare const isValidUUID: (value: string) => boolean;
/** Crockford Base32 — 26 characters */
export declare const isValidULID: (value: string) => boolean;
export declare function isValidURL(value: string, allowedProtocols?: readonly string[]): boolean;
/** Positive, finite number with at most two decimal places */
export declare const isValidPrice: (value: number) => boolean;
//# sourceMappingURL=validation.d.ts.map