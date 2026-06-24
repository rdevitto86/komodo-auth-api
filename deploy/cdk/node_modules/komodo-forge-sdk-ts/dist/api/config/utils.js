import { ConfigError } from './types.js';
const getRaw = (key) => process.env[key];
export function getEnvString(key, fallback) {
    return getRaw(key) ?? fallback;
}
export function requireEnvString(key) {
    const value = getRaw(key);
    if (value === undefined || value === '') {
        throw new ConfigError(`Missing required environment variable: ${key}`);
    }
    return value;
}
export function getEnvNumber(key, fallback) {
    const raw = getRaw(key);
    if (raw === undefined)
        return fallback;
    const n = Number(raw);
    if (isNaN(n))
        throw new ConfigError(`${key} is not a valid number: "${raw}"`);
    return n;
}
export function requireEnvNumber(key) {
    const raw = getRaw(key);
    if (raw === undefined || raw === '') {
        throw new ConfigError(`Missing required environment variable: ${key}`);
    }
    const n = Number(raw);
    if (isNaN(n))
        throw new ConfigError(`${key} is not a valid number: "${raw}"`);
    return n;
}
// --- Boolean ---
function parseBoolean(key, raw) {
    if (raw === 'true' || raw === '1')
        return true;
    if (raw === 'false' || raw === '0')
        return false;
    throw new ConfigError(`${key} is not a valid boolean: "${raw}" (expected true/false/1/0)`);
}
export function getEnvBoolean(key, fallback) {
    const raw = getRaw(key);
    if (raw === undefined)
        return fallback;
    return parseBoolean(key, raw);
}
export function requireEnvBoolean(key) {
    const raw = getRaw(key);
    if (raw === undefined || raw === '') {
        throw new ConfigError(`Missing required environment variable: ${key}`);
    }
    return parseBoolean(key, raw);
}
// --- Bulk validation ---
/** Throws at startup if any of the listed env vars are missing or empty. */
export function validateRequiredEnv(keys) {
    const missing = keys.filter((k) => {
        const v = getRaw(k);
        return v === undefined || v === '';
    });
    if (missing.length > 0) {
        throw new ConfigError(`Missing required environment variables:\n${missing.map((k) => `  - ${k}`).join('\n')}`);
    }
}
//# sourceMappingURL=utils.js.map