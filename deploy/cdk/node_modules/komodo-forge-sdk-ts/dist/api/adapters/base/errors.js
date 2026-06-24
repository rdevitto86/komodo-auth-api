export class AdapterError extends Error {
    status;
    code;
    constructor(status, code, message) {
        super(message);
        this.name = 'AdapterError';
        this.status = status;
        this.code = code;
    }
}
//# sourceMappingURL=errors.js.map