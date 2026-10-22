"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CALLDATA_SELECTOR_HEX_LENGTH = void 0;
exports.decodeCall = decodeCall;
exports.decodeCallDataRecursively = decodeCallDataRecursively;
exports.withDecodedCalls = withDecodedCalls;
const ethers_1 = require("ethers");
const viem_1 = require("viem");
const richJson_1 = require("../richJson/richJson");
/** Length of the 0x prefixed function selector at the start of call data. */
exports.CALLDATA_SELECTOR_HEX_LENGTH = 10;
const ADDRESS_HEX_LENGTH = 42;
/**
 *
 * @param type string of the type of the solidity function argument, should be tuple
 * example tuple(address,uint256[]), tuple(address,tuple(address,address,uint[]))
 * @returns the inner arguments in top-most tuple
 * For tuple(address,uint[],tuple(address)) => ['address', 'uint[]','tuple(address)']
 */
function splitTupleArgs(type) {
    if (!type.startsWith('tuple(') || !type.endsWith(')'))
        return null;
    type = type.slice(6, -1);
    const res = [];
    let depth = 0;
    let current = '';
    for (let c of type) {
        if (c === ',' && depth === 0) {
            res.push(current);
            current = '';
            continue;
        }
        if (c === '(' || c === '[')
            depth++;
        if (c === ')' || c === ']')
            depth--;
        current += c;
    }
    if (current)
        res.push(current);
    return res;
}
function unknownToDecodedArgsToCustomType(key, val, type) {
    if (typeof val === 'boolean')
        return { key: type || key, val };
    else if (typeof val === 'string')
        return { key: type || key, val };
    else if (typeof val === 'bigint' || typeof val === 'number')
        return { key: type || key, val: BigInt(val) };
    else if (typeof val === 'object') {
        if (!val)
            return { key: type || key, val: false };
        else if (Array.isArray(val)) {
            let innerTypes = undefined;
            if (type && type.endsWith(']')) {
                const indexOfLastBracket = type.lastIndexOf('[');
                const typesOfInnerElements = type.slice(0, indexOfLastBracket);
                innerTypes = Array.from({ length: val.length }).map(() => typesOfInnerElements);
            }
            else if (type && type.startsWith('tuple')) {
                innerTypes = splitTupleArgs(type);
            }
            return { key, val: arrayUnknownDecodedArgsToCustomType(val, innerTypes || null) };
        }
        else {
            const entries = Object.entries(val).map(([k, v]) => unknownToDecodedArgsToCustomType(k, v, null));
            return { key: key, val: entries };
        }
    }
    // will reach here for symbol  or undefined
    return { key: type || key, val: false };
}
function arrayUnknownDecodedArgsToCustomType(args, types) {
    const dataToReturn = [];
    args.forEach((val, i) => {
        let key = `param${i}`;
        dataToReturn.push(unknownToDecodedArgsToCustomType(key, val, types?.[i] || null));
    });
    return dataToReturn;
}
function decodeCall(data, foundSignatures) {
    if (!(0, viem_1.isHex)(data))
        return null;
    let resultWithDiff = {
        diff: Infinity,
        decoded: null
    };
    for (const { signature } of foundSignatures) {
        try {
            const iface = new ethers_1.Interface(['function ' + signature]);
            const parsed = iface.parseTransaction({ data });
            if (!parsed)
                continue;
            const argsToReturn = arrayUnknownDecodedArgsToCustomType(parsed.args, parsed.fragment.inputs.map((i) => i.type));
            const reEncoded = iface.encodeFunctionData(parsed.fragment, parsed.args);
            const diffInBytes = (data.length - reEncoded.length) / 2;
            const result = {
                diffInBytes,
                signature,
                selector: data.slice(0, exports.CALLDATA_SELECTOR_HEX_LENGTH),
                args: argsToReturn
            };
            if (!diffInBytes)
                return result;
            if (resultWithDiff.diff > diffInBytes) {
                resultWithDiff = {
                    diff: diffInBytes,
                    decoded: result
                };
            }
        }
        catch (e) {
            // we will not be able to decode the function if it is malformed
            console.warn(`decodeCall: ${e.message}`);
            // TODO should we ignore it?
        }
    }
    // this is just a false positive MITIGATION
    // in cases where the data part is 1 slot (32 bytes) and there is
    // a found function that does not have arguments
    // encountered as issue on a zero slot 0x00000.000000
    if (data.length === '0x'.length + 32 * 2 && resultWithDiff.diff === 32 - 4)
        return null;
    // mitigation for false positive when there is no exact match
    if (resultWithDiff.diff && data.startsWith('0x00000000'))
        return null;
    return resultWithDiff.decoded;
}
function decodeNestedArg(arg, getSignatures, lookedUpSelectors) {
    if (typeof arg.val === 'string' &&
        (0, viem_1.isHex)(arg.val) &&
        arg.val.length >= exports.CALLDATA_SELECTOR_HEX_LENGTH &&
        arg.val.length !== ADDRESS_HEX_LENGTH)
        return {
            key: arg.key,
            val: decodeCallDataWithNesting(arg.val, getSignatures, lookedUpSelectors) || arg.val
        };
    if (Array.isArray(arg.val))
        return {
            key: arg.key,
            val: arg.val.map((nestedArg) => decodeNestedArg(nestedArg, getSignatures, lookedUpSelectors))
        };
    return arg;
}
function decodeCallDataWithNesting(data, getSignatures, lookedUpSelectors) {
    if (!(0, viem_1.isHex)(data) || data.length < exports.CALLDATA_SELECTOR_HEX_LENGTH)
        return null;
    const selector = data.slice(0, exports.CALLDATA_SELECTOR_HEX_LENGTH);
    lookedUpSelectors.add(selector);
    const signatures = getSignatures(selector);
    if (!signatures.length)
        return null;
    const decoded = decodeCall(data, signatures);
    if (!decoded)
        return null;
    return {
        ...decoded,
        args: decoded.args.map((arg) => decodeNestedArg(arg, getSignatures, lookedUpSelectors))
    };
}
/**
 * Decodes call data with the signatures known for its selector, then keeps decoding every
 * argument that is call data itself. `getSignatures` gives the known signatures of a selector,
 * or an empty list. Nothing is fetched, so the result also lists every selector that was looked
 * up, letting the caller fetch the unknown ones and decode again.
 */
function decodeCallDataRecursively(data, getSignatures) {
    const lookedUpSelectors = new Set();
    const decodedCall = decodeCallDataWithNesting(data, getSignatures, lookedUpSelectors);
    return { decodedCall, selectors: [...lookedUpSelectors] };
}
/**
 * Returns the calls with `decodedCall` set from `getDecodedCall`, which is asked once per
 * distinct call data and gives null when the data can't be decoded. A call that isn't decoded
 * gets `isDecodingCall` when `isDecoding` says its signatures are still on the way. Calls that
 * come out the same are kept as they are, and so is the whole array when none of them changed,
 * so a caller that re-renders on a reference change only does so when the decoding actually
 * changed.
 */
function withDecodedCalls(calls, getDecodedCall, isDecoding) {
    const decodedCallsByData = new Map();
    let hasChanged = false;
    const callsWithDecodedData = calls.map((call) => {
        if (!decodedCallsByData.has(call.data)) {
            decodedCallsByData.set(call.data, getDecodedCall(call.data) || undefined);
        }
        const decodedCall = decodedCallsByData.get(call.data);
        const isDecodingCall = !decodedCall && isDecoding(call.data) ? true : undefined;
        if ((0, richJson_1.stringify)(call.decodedCall) === (0, richJson_1.stringify)(decodedCall) &&
            call.isDecodingCall === isDecodingCall)
            return call;
        hasChanged = true;
        return { ...call, decodedCall, isDecodingCall };
    });
    return hasChanged ? callsWithDecodedData : calls;
}
//# sourceMappingURL=index.js.map