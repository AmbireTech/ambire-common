"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.countUnicodeLettersAndNumbers = exports.formatReason = exports.isReasonValid = exports.getErrorCodeStringFromReason = exports.panicErrorCodeToReason = void 0;
exports.getDataFromError = getDataFromError;
const ethers_1 = require("ethers");
const constants_1 = require("./constants");
const panicErrorCodeToReason = (errorCode) => {
    switch (errorCode) {
        case 0x0n:
            return 'Generic compiler inserted panic';
        case 0x1n:
            return 'Assertion error';
        case 0x11n:
            return 'Arithmetic operation underflowed or overflowed outside of an unchecked block';
        case 0x12n:
            return 'Division or modulo division by zero';
        case 0x21n:
            return 'Tried to convert a value into an enum, but the value was too big or negative';
        case 0x22n:
            return 'Incorrectly encoded storage byte array';
        case 0x31n:
            return '.pop() was called on an empty array';
        case 0x32n:
            return 'Array accessed at an out-of-bounds or negative index';
        case 0x41n:
            return 'Too much memory was allocated, or an array was created that is too large';
        case 0x51n:
            return 'Called a zero-initialized variable of internal function type';
        default:
            return undefined;
    }
};
exports.panicErrorCodeToReason = panicErrorCodeToReason;
const isReasonValid = (reason) => {
    return (!!reason &&
        typeof reason === 'string' &&
        reason !== '0x' &&
        reason !== 'Unknown error' &&
        reason !== 'UNKNOWN_ERROR' &&
        !reason.startsWith(constants_1.ERROR_PREFIX) &&
        !reason.startsWith(constants_1.PANIC_ERROR_PREFIX) &&
        !reason.toLowerCase().includes('could not coalesce error'));
};
exports.isReasonValid = isReasonValid;
/**
 * Counts the number of valid Unicode numbers and letters in a string.
 */
const countUnicodeLettersAndNumbers = (str) => {
    let validCount = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charAt(i);
        // Check if it's an alphabetic character (from any language) or a number
        if (/[\p{L}\p{N}]/u.test(char)) {
            validCount++;
        }
    }
    return validCount;
};
exports.countUnicodeLettersAndNumbers = countUnicodeLettersAndNumbers;
/**
 * Some reasons are encoded in hex, this function will decode them to a human-readable string
 * which can then be matched to a specific error message.
 */
const formatReason = (reason) => {
    const trimmedReason = reason.trim();
    if (!(0, ethers_1.isHexString)(trimmedReason))
        return trimmedReason;
    if (trimmedReason.startsWith(constants_1.ERROR_PREFIX) || trimmedReason.startsWith(constants_1.PANIC_ERROR_PREFIX))
        return trimmedReason;
    try {
        const decodedString = (0, ethers_1.toUtf8String)(trimmedReason);
        // Return the decoded string if it contains valid Unicode letters
        return countUnicodeLettersAndNumbers(decodedString) > 0 ? decodedString : trimmedReason;
    }
    catch {
        return trimmedReason;
    }
};
exports.formatReason = formatReason;
const getErrorCodeStringFromReason = (reason, withSpace = true) => {
    if (!reason || !isReasonValid(reason))
        return '';
    const truncatedReason = reason.length > 100 ? `${reason.slice(0, 100)}...` : reason;
    return `${withSpace ? ' ' : ''}Error code: ${truncatedReason}`;
};
exports.getErrorCodeStringFromReason = getErrorCodeStringFromReason;
function getDataFromError(error) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorData = error.data ?? error.error?.data;
    if (errorData === undefined) {
        return '';
    }
    let returnData = typeof errorData === 'string' ? errorData : errorData.data;
    if (typeof returnData === 'object' && returnData.data) {
        returnData = returnData.data;
    }
    if (returnData === undefined || typeof returnData !== 'string') {
        return '';
    }
    return returnData;
}
//# sourceMappingURL=helpers.js.map