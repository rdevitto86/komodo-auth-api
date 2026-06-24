// Error code registry mirroring komodo-forge-sdk-go/http/errors
// Range roots — each service owns a block of 1000 IDs (xxx001–xxx999).
export const Ranges = {
    Global: 10, // forge-sdk — generic HTTP errors
    DB: 11, // forge-sdk — database errors
    Auth: 20, // forge-sdk + komodo-auth-api
    Entitlements: 21, // komodo-entitlements-api
    Features: 22, // komodo-features-api
    User: 30, // komodo-user-api
    Address: 31, // komodo-address-api
    Order: 40, // komodo-order-api
    OrderItem: 41, // komodo-order-api (line items)
    Returns: 42, // komodo-returns-api
    Cart: 43, // komodo-cart-api
    Inventory: 44, // komodo-inventory-api
    Shipping: 45, // komodo-shipping-api
    Payment: 50, // komodo-payments-api
    ShopItem: 60, // komodo-shop-items-api
    Search: 61, // komodo-search-api
    Communications: 70, // komodo-communications-api
    Events: 71, // komodo-event-bus-api
    Analytics: 80, // reserved
    Support: 81, // komodo-support-api
    Loyalty: 90, // komodo-loyalty-api
    Reviews: 91, // komodo-reviews-api
};
/** Constructs a string error code ID from a range root and 1-based offset. */
export function codeID(rangeRoot, offset) {
    return `${rangeRoot}${offset.toString().padStart(3, '0')}`;
}
// 10xxx — generic HTTP-level errors, usable by any service
export const Global = {
    BadRequest: { id: '10001', status: 400, message: 'Bad request' },
    Unauthorized: { id: '10002', status: 401, message: 'Unauthorized' },
    PaymentRequired: { id: '10003', status: 402, message: 'Payment required' },
    Forbidden: { id: '10004', status: 403, message: 'Forbidden' },
    NotFound: { id: '10005', status: 404, message: 'Not found' },
    MethodNotAllowed: { id: '10006', status: 405, message: 'Method not allowed' },
    Conflict: { id: '10007', status: 409, message: 'Conflict' },
    UnprocessableEntity: { id: '10008', status: 422, message: 'Unprocessable entity' },
    TooManyRequests: { id: '10009', status: 429, message: 'Too many requests' },
    Internal: { id: '10010', status: 500, message: 'Internal server error' },
    NotImplemented: { id: '10011', status: 501, message: 'Not implemented' },
    BadGateway: { id: '10012', status: 502, message: 'Bad gateway' },
    ServiceUnavailable: { id: '10013', status: 503, message: 'Service unavailable' },
    GatewayTimeout: { id: '10014', status: 504, message: 'Gateway timeout' },
};
// 11xxx — database errors, owned by DynamoDB/Aurora/PostgreSQL clients
export const DB = {
    ConnectionFailed: { id: '11001', status: 500, message: 'Database connection failed' },
    QueryFailed: { id: '11002', status: 500, message: 'Database query failed' },
    TransactionFailed: { id: '11003', status: 500, message: 'Database transaction failed' },
    RecordNotFound: { id: '11004', status: 404, message: 'Record not found' },
    DuplicateEntry: { id: '11005', status: 409, message: 'Duplicate entry' },
};
// 20xxx — auth/JWT errors, used by auth middleware and komodo-auth-api
export const Auth = {
    InvalidClientCredentials: { id: '20001', status: 401, message: 'Invalid client credentials' },
    InvalidGrantType: { id: '20002', status: 400, message: 'Invalid grant type' },
    InvalidScope: { id: '20003', status: 400, message: 'Invalid scope' },
    InvalidToken: { id: '20004', status: 401, message: 'Invalid token' },
    InvalidKey: { id: '20005', status: 401, message: 'Invalid auth key' },
    ExpiredToken: { id: '20006', status: 401, message: 'Token expired' },
    UnauthorizedClient: { id: '20007', status: 401, message: 'Unauthorized client' },
    UnsupportedGrantType: { id: '20008', status: 400, message: 'Unsupported grant type' },
    UnsupportedResponseType: { id: '20009', status: 400, message: 'Unsupported response type' },
    InvalidRedirectURI: { id: '20010', status: 400, message: 'Invalid redirect URI' },
    AccessDenied: { id: '20011', status: 403, message: 'Access denied' },
    InsufficientScope: { id: '20012', status: 403, message: 'Insufficient scope' },
};
/** Builds a JSON error Response from an ErrorCode. */
export function buildErrorResponse(req, code, detail) {
    const body = {
        status: code.status,
        code: code.id,
        message: code.message,
        request_id: req.headers.get('x-request-id') ?? undefined,
        timestamp: new Date().toISOString(),
    };
    if (detail !== undefined)
        body.detail = detail;
    return new Response(JSON.stringify(body), {
        status: code.status,
        headers: { 'Content-Type': 'application/json' },
    });
}
//# sourceMappingURL=index.js.map