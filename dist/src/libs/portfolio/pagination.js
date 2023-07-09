"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flattenResults = exports.paginate = void 0;
function paginate(input, limit) {
    let pages = [];
    let from = 0;
    for (let i = 1; i <= Math.ceil(input.length / limit); i++) {
        pages.push(input.slice(from, i * limit));
        from += limit;
    }
    return pages;
}
exports.paginate = paginate;
async function flattenResults(everything) {
    return Promise.all(everything).then((results) => results.flat());
}
exports.flattenResults = flattenResults;
//# sourceMappingURL=pagination.js.map