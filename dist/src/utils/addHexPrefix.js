"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addHexPrefix = void 0;
const isHexPrefixed_1 = require("./isHexPrefixed");
/**
 * Adds "0x" to a given `String` if it does not already start with "0x".
 */
const addHexPrefix = (str) => {
    if (typeof str !== 'string') {
        return str;
    }
    return (0, isHexPrefixed_1.isHexPrefixed)(str) ? str : `0x${str}`;
};
exports.addHexPrefix = addHexPrefix;
//# sourceMappingURL=addHexPrefix.js.map