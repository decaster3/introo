import { Request } from 'express';
export interface PaginationParams {
    page: number;
    limit: number;
    skip: number;
}
export interface PaginatedResponse<T> {
    data: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasMore: boolean;
    };
}
export declare function getPaginationParams(req: Request, defaultLimit?: number, maxLimit?: number): PaginationParams;
export declare function createPaginatedResponse<T>(data: T[], total: number, params: PaginationParams): PaginatedResponse<T>;
//# sourceMappingURL=pagination.d.ts.map