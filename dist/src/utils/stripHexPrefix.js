import { isHexPrefixed } from './isHexPrefixed';
/**
 * Removes '0x' from a given `String` if present
 */
export const stripHexPrefix = (str) => {
    if (typeof str !== 'string')
        return str;
    return isHexPrefixed(str) ? str.slice(2) : str;
};
//# sourceMappingURL=stripHexPrefix.js.map