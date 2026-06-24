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

export const buildCursorPage = (cursor: string | undefined, limit: number): CursorPage =>
	cursor !== undefined ? { cursor, limit } : { limit };

export const buildOffsetPage = (page: number, pageSize: number): OffsetPage => ({
	page: Math.max(1, page),
	pageSize: Math.max(1, pageSize),
});

export function parsePaginationQuery(query: Record<string, string | undefined>): OffsetPage {
	const rawPage = query['page'];
	const rawPageSize = query['pageSize'];
	const page = rawPage !== undefined ? parseInt(rawPage, 10) : 1;
	const pageSize = rawPageSize !== undefined ? parseInt(rawPageSize, 10) : 20;
	return buildOffsetPage(isNaN(page) ? 1 : page, isNaN(pageSize) ? 20 : pageSize);
}
