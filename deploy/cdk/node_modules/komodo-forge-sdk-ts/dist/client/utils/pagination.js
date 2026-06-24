export const buildCursorPage = (cursor, limit) => cursor !== undefined ? { cursor, limit } : { limit };
export const buildOffsetPage = (page, pageSize) => ({
    page: Math.max(1, page),
    pageSize: Math.max(1, pageSize),
});
export function parsePaginationQuery(query) {
    const rawPage = query['page'];
    const rawPageSize = query['pageSize'];
    const page = rawPage !== undefined ? parseInt(rawPage, 10) : 1;
    const pageSize = rawPageSize !== undefined ? parseInt(rawPageSize, 10) : 20;
    return buildOffsetPage(isNaN(page) ? 1 : page, isNaN(pageSize) ? 20 : pageSize);
}
//# sourceMappingURL=pagination.js.map