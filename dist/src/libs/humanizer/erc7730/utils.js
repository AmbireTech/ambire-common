"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSafeSingletonKey = exports.getRegistryKey = exports.getSafeTxCallsFromMessage = exports.parseIntegerLiteral = exports.isHexOfLength = exports.isHexChar = exports.isPlainObject = void 0;
const ethers_1 = require("ethers");
const helpers_1 = require("../../safe/helpers");
const calldata_1 = require("./calldata");
const consts_1 = require("./consts");
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
exports.isPlainObject = isPlainObject;
const isHexChar = (value) => {
    const charCode = value.charCodeAt(0);
    return ((charCode >= 48 && charCode <= 57) ||
        (charCode >= 65 && charCode <= 70) ||
        (charCode >= 97 && charCode <= 102));
};
exports.isHexChar = isHexChar;
const isHexOfLength = (value, hexLength) => value.startsWith('0x') && value.length === hexLength + 2 && [...value.slice(2)].every(exports.isHexChar);
exports.isHexOfLength = isHexOfLength;
const parseIntegerLiteral = (value) => {
    if (!value)
        return null;
    const sign = value[0] === '-' ? -1 : 1;
    const digits = sign === -1 ? value.slice(1) : value;
    if (!digits || ![...digits].every((digit) => digit >= '0' && digit <= '9'))
        return null;
    const parsed = Number(digits) * sign;
    return Number.isInteger(parsed) ? parsed : null;
};
exports.parseIntegerLiteral = parseIntegerLiteral;
const getSafeTxCallsFromMessage = (message) => {
    if (message.content.kind !== 'typedMessage')
        return null;
    if (message.content.primaryType !== consts_1.SAFE_TX_PRIMARY_TYPE)
        return null;
    const { to, value, data, operation } = message.content.message;
    if (typeof to !== 'string' || !(0, ethers_1.isAddress)(to))
        return null;
    if (typeof data !== 'string' || !(0, ethers_1.isHexString)(data))
        return null;
    try {
        const bigintValue = BigInt((value ?? 0));
        const bigintOperation = BigInt((operation ?? 0));
        if (bigintOperation === 0n) {
            return [
                {
                    to,
                    data,
                    value: bigintValue
                }
            ];
        }
        if (bigintOperation !== 1n)
            return null;
        const multiSendDecoded = calldata_1.multiSendInterface.decodeFunctionData('multiSend', (0, calldata_1.getAbiBytesCalldataWithPadding)(data));
        const transactionsHex = multiSendDecoded[0];
        if (typeof transactionsHex !== 'string')
            return null;
        return (0, helpers_1.decodeMultiSend)(transactionsHex)
            .filter((transaction) => transaction.success)
            .map((transaction) => ({
            to: transaction.to,
            data: transaction.data,
            value: transaction.value
        }));
    }
    catch {
        return null;
    }
};
exports.getSafeTxCallsFromMessage = getSafeTxCallsFromMessage;
/** The key a descriptor is registered under, both in the relayer index and in the resolved maps */
const getRegistryKey = (chainId, address) => `eip155:${BigInt(chainId).toString()}:${address.toLowerCase()}`;
exports.getRegistryKey = getRegistryKey;
/**
 * The key a Safe proxy's implementation is recorded under. Shared with the controller that answers
 * the lookup, so the two can't drift into writing and reading different keys.
 */
const getSafeSingletonKey = (chainId, address) => `${chainId.toString()}:${address.toLowerCase()}`;
exports.getSafeSingletonKey = getSafeSingletonKey;
//# sourceMappingURL=utils.js.map