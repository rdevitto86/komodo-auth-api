export interface ErrorCode {
    id: string;
    status: number;
    message: string;
}
export interface ErrorResponse {
    status: number;
    code: string;
    message: string;
    detail?: string | undefined;
    request_id?: string | undefined;
    timestamp: string;
}
export declare const Ranges: {
    readonly Global: 10;
    readonly DB: 11;
    readonly Auth: 20;
    readonly Entitlements: 21;
    readonly Features: 22;
    readonly User: 30;
    readonly Address: 31;
    readonly Order: 40;
    readonly OrderItem: 41;
    readonly Returns: 42;
    readonly Cart: 43;
    readonly Inventory: 44;
    readonly Shipping: 45;
    readonly Payment: 50;
    readonly ShopItem: 60;
    readonly Search: 61;
    readonly Communications: 70;
    readonly Events: 71;
    readonly Analytics: 80;
    readonly Support: 81;
    readonly Loyalty: 90;
    readonly Reviews: 91;
};
/** Constructs a string error code ID from a range root and 1-based offset. */
export declare function codeID(rangeRoot: number, offset: number): string;
export declare const Global: {
    readonly BadRequest: {
        readonly id: "10001";
        readonly status: 400;
        readonly message: "Bad request";
    };
    readonly Unauthorized: {
        readonly id: "10002";
        readonly status: 401;
        readonly message: "Unauthorized";
    };
    readonly PaymentRequired: {
        readonly id: "10003";
        readonly status: 402;
        readonly message: "Payment required";
    };
    readonly Forbidden: {
        readonly id: "10004";
        readonly status: 403;
        readonly message: "Forbidden";
    };
    readonly NotFound: {
        readonly id: "10005";
        readonly status: 404;
        readonly message: "Not found";
    };
    readonly MethodNotAllowed: {
        readonly id: "10006";
        readonly status: 405;
        readonly message: "Method not allowed";
    };
    readonly Conflict: {
        readonly id: "10007";
        readonly status: 409;
        readonly message: "Conflict";
    };
    readonly UnprocessableEntity: {
        readonly id: "10008";
        readonly status: 422;
        readonly message: "Unprocessable entity";
    };
    readonly TooManyRequests: {
        readonly id: "10009";
        readonly status: 429;
        readonly message: "Too many requests";
    };
    readonly Internal: {
        readonly id: "10010";
        readonly status: 500;
        readonly message: "Internal server error";
    };
    readonly NotImplemented: {
        readonly id: "10011";
        readonly status: 501;
        readonly message: "Not implemented";
    };
    readonly BadGateway: {
        readonly id: "10012";
        readonly status: 502;
        readonly message: "Bad gateway";
    };
    readonly ServiceUnavailable: {
        readonly id: "10013";
        readonly status: 503;
        readonly message: "Service unavailable";
    };
    readonly GatewayTimeout: {
        readonly id: "10014";
        readonly status: 504;
        readonly message: "Gateway timeout";
    };
};
export declare const DB: {
    readonly ConnectionFailed: {
        readonly id: "11001";
        readonly status: 500;
        readonly message: "Database connection failed";
    };
    readonly QueryFailed: {
        readonly id: "11002";
        readonly status: 500;
        readonly message: "Database query failed";
    };
    readonly TransactionFailed: {
        readonly id: "11003";
        readonly status: 500;
        readonly message: "Database transaction failed";
    };
    readonly RecordNotFound: {
        readonly id: "11004";
        readonly status: 404;
        readonly message: "Record not found";
    };
    readonly DuplicateEntry: {
        readonly id: "11005";
        readonly status: 409;
        readonly message: "Duplicate entry";
    };
};
export declare const Auth: {
    readonly InvalidClientCredentials: {
        readonly id: "20001";
        readonly status: 401;
        readonly message: "Invalid client credentials";
    };
    readonly InvalidGrantType: {
        readonly id: "20002";
        readonly status: 400;
        readonly message: "Invalid grant type";
    };
    readonly InvalidScope: {
        readonly id: "20003";
        readonly status: 400;
        readonly message: "Invalid scope";
    };
    readonly InvalidToken: {
        readonly id: "20004";
        readonly status: 401;
        readonly message: "Invalid token";
    };
    readonly InvalidKey: {
        readonly id: "20005";
        readonly status: 401;
        readonly message: "Invalid auth key";
    };
    readonly ExpiredToken: {
        readonly id: "20006";
        readonly status: 401;
        readonly message: "Token expired";
    };
    readonly UnauthorizedClient: {
        readonly id: "20007";
        readonly status: 401;
        readonly message: "Unauthorized client";
    };
    readonly UnsupportedGrantType: {
        readonly id: "20008";
        readonly status: 400;
        readonly message: "Unsupported grant type";
    };
    readonly UnsupportedResponseType: {
        readonly id: "20009";
        readonly status: 400;
        readonly message: "Unsupported response type";
    };
    readonly InvalidRedirectURI: {
        readonly id: "20010";
        readonly status: 400;
        readonly message: "Invalid redirect URI";
    };
    readonly AccessDenied: {
        readonly id: "20011";
        readonly status: 403;
        readonly message: "Access denied";
    };
    readonly InsufficientScope: {
        readonly id: "20012";
        readonly status: 403;
        readonly message: "Insufficient scope";
    };
};
/** Builds a JSON error Response from an ErrorCode. */
export declare function buildErrorResponse(req: Request, code: ErrorCode, detail?: string): Response;
//# sourceMappingURL=index.d.ts.map