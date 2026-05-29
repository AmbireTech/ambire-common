"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSigningRequestDisplayData = getSigningRequestDisplayData;
exports.getEIP712SigningRequest = getEIP712SigningRequest;
exports.getRawTransactionSigningRequest = getRawTransactionSigningRequest;
exports.getExecuteSigningRequest = getExecuteSigningRequest;
exports.get7702AuthorizationSigningRequest = get7702AuthorizationSigningRequest;
const ethers_1 = require("ethers");
const accountOp_1 = require("../accountOp/accountOp");
const signMessage_1 = require("../signMessage/signMessage");
/**
 * The goal of this function is to traverse the passed value
 * and successfully parse it so a readable json
 */
function getSerializableSigningRequestData(value, seen = new WeakSet()) {
    if (typeof value === 'bigint')
        return value.toString();
    if (!value || typeof value !== 'object')
        return value;
    if (seen.has(value))
        return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) {
        const result = value.map((item) => getSerializableSigningRequestData(item, seen));
        seen.delete(value);
        return result;
    }
    const result = Object.entries(value).reduce((acc, [key, val]) => {
        if (typeof val === 'function' || typeof val === 'undefined')
            return acc;
        acc[key] = getSerializableSigningRequestData(val, seen);
        return acc;
    }, {});
    seen.delete(value);
    return result;
}
function getEIP712SigningRequestData(data) {
    const typedData = data;
    let domainHash;
    let messageHash;
    try {
        const typesWithoutDomain = Object.fromEntries(Object.entries(typedData.types).filter(([typeName]) => typeName !== 'EIP712Domain'));
        domainHash = ethers_1.TypedDataEncoder.hashDomain(typedData.domain);
        messageHash = ethers_1.TypedDataEncoder.hashStruct(typedData.primaryType, typesWithoutDomain, typedData.message);
    }
    catch {
        return data;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return { data, domainHash, messageHash };
    }
    return {
        ...data,
        domainHash,
        messageHash
    };
}
function getSigningRequestDisplayData(request) {
    const data = request.type === 'eip-712' ? getEIP712SigningRequestData(request.data) : request.data;
    return getSerializableSigningRequestData(data);
}
function getEIP712SigningRequest(data) {
    return {
        type: 'eip-712',
        data
    };
}
function getRawTransactionSigningRequest(data) {
    return {
        type: 'raw-transaction',
        data
    };
}
function getExecuteSigningRequest({ accountOp, accountState, network }) {
    const accountOpHash = (0, ethers_1.hexlify)((0, accountOp_1.accountOpSignableHash)(accountOp, network.chainId));
    if (!accountState.isV2) {
        return {
            type: 'message',
            data: {
                message: accountOpHash
            }
        };
    }
    return getEIP712SigningRequest((0, signMessage_1.getTypedData)(network.chainId, accountState.accountAddr, accountOpHash));
}
function get7702AuthorizationSigningRequest({ chainId, contract, nonce }) {
    return {
        type: 'eip-7702-authorization',
        data: {
            chainId,
            contract,
            nonce
        }
    };
}
//# sourceMappingURL=signingRequest.js.map