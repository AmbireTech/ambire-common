"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flattenResults = flattenResults;
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
//# sourceMappingURL=pagination.js.map