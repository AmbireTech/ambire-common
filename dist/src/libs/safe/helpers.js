"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAFE_DELEGATE_CALL_OPERATION = exports.SAFE_CALL_OPERATION = exports.multiCallAbi = void 0;
exports.encodeCalls = encodeCalls;
exports.getSafeTxn = getSafeTxn;
exports.getSafeBroadcastTxn = getSafeBroadcastTxn;
exports.decodeMultiSend = decodeMultiSend;
exports.buildSafeMessageOrigin = buildSafeMessageOrigin;
exports.parseSafeMessageOrigin = parseSafeMessageOrigin;
exports.getSameNonceRequests = getSameNonceRequests;
const ethers_1 = require("ethers");
const estimateHelpers_1 = require("../estimate/estimateHelpers");
const safe_1 = require("../../consts/safe");
const accountOp_1 = require("../accountOp/accountOp");
exports.multiCallAbi = [
    { inputs: [], stateMutability: 'nonpayable', type: 'constructor' },
    {
        inputs: [{ internalType: 'bytes', name: 'transactions', type: 'bytes' }],
        name: 'multiSend',
        outputs: [],
        stateMutability: 'payable',
        type: 'function'
    }
];
exports.SAFE_CALL_OPERATION = 0;
exports.SAFE_DELEGATE_CALL_OPERATION = 1;
function encodeCalls(op) {
    const calls = (0, accountOp_1.getSignableCalls)(op);
    if (calls.length === 1) {
        const singleCall = calls[0];
        return {
            to: singleCall[0],
            value: BigInt(singleCall[1]),
            data: singleCall[2],
            operation: exports.SAFE_CALL_OPERATION
        };
    }
    const multiSendData = new ethers_1.Interface(exports.multiCallAbi).encodeFunctionData('multiSend', [
        (0, ethers_1.concat)(calls.map((call) => {
            return (0, ethers_1.solidityPacked)(['uint8', 'address', 'uint256', 'uint256', 'bytes'], [exports.SAFE_CALL_OPERATION, call[0], BigInt(call[1]), BigInt((0, ethers_1.getBytes)(call[2]).length), call[2]]);
        }))
    ]);
    return {
        to: safe_1.multiSendAddr,
        value: 0n,
        data: multiSendData,
        operation: exports.SAFE_DELEGATE_CALL_OPERATION
    };
}
/**
 * Construct a Safe txn for signing
 */
function getSafeTxn(op, state) {
    // todo: we're blindly trusting the returned txn from Safe Global, is this OK?
    if (op.safeTx) {
        return {
            to: op.safeTx.to,
            value: (0, ethers_1.toBeHex)(op.safeTx.value),
            data: op.safeTx.data ? op.safeTx.data : '0x',
            operation: op.safeTx.operation,
            safeTxGas: (0, ethers_1.toBeHex)(op.safeTx.safeTxGas),
            baseGas: (0, ethers_1.toBeHex)(op.safeTx.baseGas),
            gasPrice: (0, ethers_1.toBeHex)(op.safeTx.gasPrice),
            gasToken: op.safeTx.gasToken,
            refundReceiver: op.safeTx.refundReceiver ? op.safeTx.refundReceiver : '0x',
            nonce: (0, ethers_1.toBeHex)(op.safeTx.nonce)
        };
    }
    const { to, value, data, operation } = encodeCalls(op);
    return {
        to: to,
        value: (0, ethers_1.toBeHex)(value),
        data: data,
        operation,
        safeTxGas: (0, ethers_1.toBeHex)(0),
        baseGas: (0, ethers_1.toBeHex)(0),
        gasPrice: (0, ethers_1.toBeHex)(0),
        gasToken: ethers_1.ZeroAddress,
        refundReceiver: ethers_1.ZeroAddress,
        nonce: (0, ethers_1.toBeHex)(op.nonce || state.nonce || 0n)
    };
}
function getSafeBroadcastTxn(op, state) {
    const exec = new ethers_1.Interface(safe_1.execTransactionAbi);
    const safeTxn = getSafeTxn(op, state);
    return {
        to: op.accountAddr,
        value: 0n,
        data: exec.encodeFunctionData('execTransaction', [
            safeTxn.to,
            safeTxn.value,
            safeTxn.data,
            safeTxn.operation,
            safeTxn.safeTxGas,
            safeTxn.baseGas,
            safeTxn.gasPrice,
            safeTxn.gasToken,
            safeTxn.refundReceiver,
            op.signature && op.signature !== '0x' ? op.signature : (0, estimateHelpers_1.getSigForCalculations)()
        ])
    };
}
// operation (1 byte) + to (20 bytes) + value (32 bytes) + dataLength (32 bytes)
const MULTI_SEND_HEADER_SIZE = 1 + 20 + 32 + 32;
function decodeMultiSend(transactionsHex) {
    const bytes = (0, ethers_1.getBytes)(transactionsHex);
    let i = 0;
    const results = [];
    while (i < bytes.length) {
        const remaining = bytes.length - i;
        // Not enough bytes left for a full header, so the remainder can't be a real entry.
        if (remaining < MULTI_SEND_HEADER_SIZE) {
            results.push({
                success: false,
                reason: `${remaining} byte(s) left, which is not enough for a transaction header (needs ${MULTI_SEND_HEADER_SIZE})`
            });
            break;
        }
        const operation = bytes[i];
        i += 1;
        const to = (0, ethers_1.hexlify)(bytes.slice(i, i + 20));
        i += 20;
        const value = BigInt((0, ethers_1.hexlify)(bytes.slice(i, i + 32)));
        i += 32;
        const dataLength = Number(BigInt((0, ethers_1.hexlify)(bytes.slice(i, i + 32))));
        i += 32;
        // The declared data length doesn't fit in what's left, so the entry is truncated.
        if (dataLength > bytes.length - i) {
            results.push({
                success: false,
                reason: `declared data length ${dataLength} exceeds the ${bytes.length - i} byte(s) left`
            });
            break;
        }
        const data = (0, ethers_1.hexlify)(bytes.slice(i, i + dataLength));
        i += dataLength;
        results.push({
            success: true,
            operation,
            to,
            value,
            data
        });
    }
    return results;
}
/**
 * The requesting dapp is only known on the device that originates the message.
 * We stamp its name and url into Safe's `origin` field so other owners co-signing
 * on a different device can see the request context (they fetch the message from
 * the Safe Transaction Service, which carries no dapp identity of its own).
 * `origin` is capped at 200 chars; if it doesn't fit we skip it rather than risk
 * the message proposal failing validation (missing metadata is recoverable).
 */
function buildSafeMessageOrigin(dapp) {
    const name = dapp?.name || '';
    const url = dapp?.url || '';
    if (!name && !url)
        return undefined;
    const origin = JSON.stringify({ name, url });
    if (origin.length > 200)
        return undefined;
    return origin;
}
function parseSafeMessageOrigin(origin) {
    if (!origin)
        return {};
    try {
        const parsed = JSON.parse(origin);
        if (parsed && typeof parsed === 'object') {
            const name = typeof parsed.name === 'string' ? parsed.name : undefined;
            const url = typeof parsed.url === 'string' ? parsed.url : undefined;
            return { name, url };
        }
    }
    catch {
        // origin may be a plain, non-JSON string set by another wallet; treat it as the name
        return { name: origin };
    }
    return {};
}
/**
 * Safe requests may have multiple "call" ones with the same nonce
 */
function getSameNonceRequests(requests) {
    return requests.reduce((acc, r) => {
        const key = r.signAccountOp.accountOp.nonce?.toString() || '0';
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(r);
        return acc;
    }, {});
}
//# sourceMappingURL=helpers.js.map