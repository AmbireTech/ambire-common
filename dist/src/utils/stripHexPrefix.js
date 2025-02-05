"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripHexPrefix = void 0;
const isHexPrefixed_1 = require("./isHexPrefixed");
/**
 * Removes '0x' from a given `String` if present
 */
const stripHexPrefix = (str) => {
    if (typeof str !== 'string')
        return str;
    return (0, isHexPrefixed_1.isHexPrefixed)(str) ? str.slice(2) : str;
};
exports.stripHexPrefix = stripHexPrefix;
//# sourceMappingURL=stripHexPrefix.js.map