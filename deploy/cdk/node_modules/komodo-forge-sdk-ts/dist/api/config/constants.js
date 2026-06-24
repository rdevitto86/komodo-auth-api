// Environment variable name constants.
// Mirrors komodo-forge-sdk-go/config/config.go — keep both files in sync.
// --- Server / Docker ---
export const APP_NAME = 'APP_NAME';
export const LOG_LEVEL = 'LOG_LEVEL';
export const ENV = 'ENV';
export const PORT = 'PORT';
export const PORT_PRIVATE = 'PORT_PRIVATE';
export const PORT_METRICS = 'PORT_METRICS';
export const VERSION = 'VERSION';
// --- AWS ---
export const AWS_REGION = 'AWS_REGION';
export const AWS_ENDPOINT = 'AWS_ENDPOINT';
export const AWS_SECRET_PREFIX = 'AWS_SECRET_PREFIX';
export const AWS_SECRET_BATCH = 'AWS_SECRET_BATCH';
export const DYNAMODB_ENDPOINT = 'DYNAMODB_ENDPOINT';
export const DYNAMODB_TABLE = 'DYNAMODB_TABLE';
export const DYNAMODB_ACCESS_KEY = 'DYNAMODB_ACCESS_KEY';
export const DYNAMODB_SECRET_KEY = 'DYNAMODB_SECRET_KEY';
export const S3_BUCKET = 'S3_BUCKET';
export const S3_ENDPOINT = 'S3_ENDPOINT';
// --- HTTP ---
export const HOST = 'HOST';
export const MAX_CONTENT_LENGTH = 'MAX_CONTENT_LENGTH';
export const RATE_LIMIT_RPS = 'RATE_LIMIT_RPS';
export const RATE_LIMIT_BURST = 'RATE_LIMIT_BURST';
export const RATE_LIMIT_FAIL_OPEN = 'RATE_LIMIT_FAIL_OPEN';
export const BUCKET_TTL_SECOND = 'BUCKET_TTL_SECOND';
export const IP_WHITELIST = 'IP_WHITELIST';
export const IP_BLACKLIST = 'IP_BLACKLIST';
export const IDEMPOTENCY_TTL_SEC = 'IDEMPOTENCY_TTL_SEC';
// --- Security / Auth ---
export const JWT_PUBLIC_KEY = 'JWT_PUBLIC_KEY';
export const JWT_PRIVATE_KEY = 'JWT_PRIVATE_KEY';
export const JWT_AUDIENCE = 'JWT_AUDIENCE';
export const JWT_ISSUER = 'JWT_ISSUER';
export const JWT_KID = 'JWT_KID';
export const JWT_SECRET = 'JWT_SECRET';
// --- Database ---
export const DB_HOST = 'DB_HOST';
export const DB_PORT = 'DB_PORT';
export const DB_NAME = 'DB_NAME';
export const DB_USER = 'DB_USER';
export const DB_PASSWORD = 'DB_PASSWORD';
export const DB_SSL_MODE = 'DB_SSL_MODE';
//# sourceMappingURL=constants.js.map