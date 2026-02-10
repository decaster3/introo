export function getPaginationParams(req, defaultLimit = 20, maxLimit = 1000) {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const requestedLimit = parseInt(req.query.limit) || defaultLimit;
    const limit = Math.min(Math.max(1, requestedLimit), maxLimit);
    const skip = (page - 1) * limit;
    return { page, limit, skip };
}
export function createPaginatedResponse(data, total, params) {
    const totalPages = Math.ceil(total / params.limit);
    return {
        data,
        pagination: {
            page: params.page,
            limit: params.limit,
            total,
            totalPages,
            hasMore: params.page < totalPages,
        },
    };
}
//# sourceMappingURL=pagination.js.map