export function paginate(input, limit) {
    const pages = [];
    let from = 0;
    for (let i = 1; i <= Math.ceil(input.length / limit); i++) {
        pages.push(input.slice(from, i * limit));
        from += limit;
    }
    return pages;
}
export function flattenResults(everything) {
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