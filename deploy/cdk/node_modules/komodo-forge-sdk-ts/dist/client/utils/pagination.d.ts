export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
}
export interface CursorPage {
    cursor?: string;
    limit: number;
}
export interface OffsetPage {
    page: number;
    pageSize: number;
}
export declare const buildCursorPage: (cursor: string | undefined, limit: number) => CursorPage;
export declare const buildOffsetPage: (page: number, pageSize: number) => OffsetPage;
export declare function parsePaginationQuery(query: Record<string, string | undefined>): OffsetPage;
//# sourceMappingURL=pagination.d.ts.map