"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Not the best approach - consider using `tldts` or `psl` for more accurate domain parsing.
 */
const getRootDomain = (url) => {
    const { hostname } = new URL(url);
    const parts = hostname.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : hostname;
};
exports.default = getRootDomain;
//# sourceMappingURL=getRootDomain.js.map