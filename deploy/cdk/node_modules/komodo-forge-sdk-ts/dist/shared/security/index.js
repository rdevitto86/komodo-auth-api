import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { decodeJwt, jwtVerify, SignJWT } from 'jose';
// --- JWT ---
const encoder = new TextEncoder();
export async function signJWT(payload, secret, options) {
    let builder = new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).setIssuedAt();
    if (options?.expiresIn !== undefined)
        builder = builder.setExpirationTime(options.expiresIn);
    if (options?.issuer !== undefined)
        builder = builder.setIssuer(options.issuer);
    if (options?.audience !== undefined)
        builder = builder.setAudience(options.audience);
    return builder.sign(encoder.encode(secret));
}
export async function verifyJWT(token, secret, options) {
    return (await jwtVerify(token, encoder.encode(secret), options)).payload;
}
/** Decodes a JWT without verifying the signature — use only for inspecting metadata. */
export function decodeJWT(token) {
    return decodeJwt(token);
}
// --- AES-256-GCM ---
const IV_BYTES = 12;
const TAG_BYTES = 16;
/**
 * Encrypts a string with AES-256-GCM.
 * @param plaintext - UTF-8 string to encrypt.
 * @param keyHex   - 64-character hex string (32 bytes).
 * @returns Colon-delimited hex string: `iv:ciphertext:authTag`
 */
export function encryptAES256GCM(plaintext, keyHex) {
    const key = Buffer.from(keyHex, 'hex');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}
/**
 * Decrypts a string produced by {@link encryptAES256GCM}.
 * @param encrypted - Colon-delimited hex string: `iv:ciphertext:authTag`
 * @param keyHex    - 64-character hex string (32 bytes).
 */
export function decryptAES256GCM(encrypted, keyHex) {
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted format — expected "iv:ciphertext:authTag"');
    }
    const [ivHex, ciphertextHex, tagHex] = parts;
    const key = Buffer.from(keyHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'), { authTagLength: TAG_BYTES });
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]).toString('utf8');
}
// --- PKCE ---
/** Generates a random PKCE code verifier (RFC 7636). */
export const generatePKCECodeVerifier = () => randomBytes(32).toString('base64url');
/** Derives the S256 PKCE code challenge from a verifier. */
export const generatePKCEChallenge = (verifier) => createHash('sha256').update(verifier).digest('base64url');
// --- OAuth ---
// Mirrors komodo-forge-sdk-go/security/oauth/oauth.go
const ALLOWED_SCOPES = new Set([
    'read',
    'write',
    'admin',
    'checkout:read',
    'checkout:write',
    'orders:read',
    'users:profile',
]);
const VALID_GRANT_TYPES = new Set(['client_credentials', 'authorization_code', 'refresh_token']);
/**
 * Returns true when every scope in the space- or comma-separated string is
 * either a known scope or a service-to-service scope (prefixed "svc:").
 */
export function isValidScope(scope) {
    if (!scope)
        return false;
    const parts = scope.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    return parts.every((s) => s.startsWith('svc:') || ALLOWED_SCOPES.has(s));
}
/** Returns any scopes in the string that are not recognised. */
export function getInvalidScopes(scope) {
    if (!scope)
        return [];
    return scope
        .replace(/,/g, ' ')
        .split(/\s+/)
        .filter((s) => s !== '' && !s.startsWith('svc:') && !ALLOWED_SCOPES.has(s));
}
/** Returns true when the grant type is one of the supported OAuth 2.0 flows. */
export function isValidGrantType(grantType) {
    return VALID_GRANT_TYPES.has(grantType);
}
/** Extracts the Bearer token from an Authorization header value, or returns null. */
export function extractBearerToken(authHeader) {
    if (!authHeader?.startsWith('Bearer '))
        return null;
    return authHeader.slice(7).trim() || null;
}
//# sourceMappingURL=index.js.map