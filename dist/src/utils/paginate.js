"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paginate = paginate;
/**
 * Split a list into pages of at most `limit` items each.
 * Use it to keep batched requests below the limits of an external API.
 */
function paginate(input, limit) {
    const pages = [];
    let from = 0;
    for (let i = 1; i <= Math.ceil(input.length / limit); i++) {
        pages.push(input.slice(from, i * limit));
        from += limit;
    }
    return pages;
}
//# sourceMappingURL=paginate.js.map