"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flattenResults = exports.paginate = void 0;
function paginate(input, limit) {
    const pages = [];
    let from = 0;
    for (let i = 1; i <= Math.ceil(input.length / limit); i++) {
        pages.push(input.slice(from, i * limit));
        from += limit;
    }
    return pages;
}
exports.paginate = paginate;
function flattenResults(everything) {
    return Promise.all(everything).then((results) => {
        if (!results || !results.length) {
            return [[], {}];
        }
        const allTokens = [];
        let metadata = {};
        results.forEach((result) => {
            if (Array.isArray(result) && result.length > 0) {
                const [hintsArray, meta] = result;
                if (Array.isArray(hintsArray)) {
                    allTokens.push(...hintsArray);
                }
                if (Object.keys(metadata).length === 0) {
                    metadata = { ...meta };
                }
            }
        });
        return [allTokens, metadata];
    });
}
exports.flattenResults = flattenResults;
//# sourceMappingURL=pagination.js.map