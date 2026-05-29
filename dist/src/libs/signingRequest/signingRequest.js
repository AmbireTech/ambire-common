import { hexlify, TypedDataEncoder } from 'ethers';
import { accountOpSignableHash } from '../accountOp/accountOp';
import { getTypedData } from '../signMessage/signMessage';
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
        domainHash = TypedDataEncoder.hashDomain(typedData.domain);
        messageHash = TypedDataEncoder.hashStruct(typedData.primaryType, typesWithoutDomain, typedData.message);
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
export function getSigningRequestDisplayData(request) {
    const data = request.type === 'eip-712' ? getEIP712SigningRequestData(request.data) : request.data;
    return getSerializableSigningRequestData(data);
}
export function getEIP712SigningRequest(data) {
    return {
        type: 'eip-712',
        data
    };
}
export function getRawTransactionSigningRequest(data) {
    return {
        type: 'raw-transaction',
        data
    };
}
export function getExecuteSigningRequest({ accountOp, accountState, network }) {
    const accountOpHash = hexlify(accountOpSignableHash(accountOp, network.chainId));
    if (!accountState.isV2) {
        return {
            type: 'message',
            data: {
                message: accountOpHash
            }
        };
    }
    return getEIP712SigningRequest(getTypedData(network.chainId, accountState.accountAddr, accountOpHash));
}
export function get7702AuthorizationSigningRequest({ chainId, contract, nonce }) {
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