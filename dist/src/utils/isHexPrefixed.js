"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHexPrefixed = void 0;
/**
 * Returns a `Boolean` on whether or not the a `String` starts with '0x'
 */
const isHexPrefixed = (str) => {
    if (typeof str !== 'string') {
        throw new Error(`isHexPrefixed \`str\` value must be type 'string', is currently type ${typeof str}`);
    }
    return str.slice(0, 2) === '0x';
};
exports.isHexPrefixed = isHexPrefixed;
//# sourceMappingURL=isHexPrefixed.js.map