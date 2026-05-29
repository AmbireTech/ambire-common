"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.areAccountOpsEqual = void 0;
exports.toSingletonCall = toSingletonCall;
exports.callToTuple = callToTuple;
exports.canBroadcast = canBroadcast;
exports.getSignableCalls = getSignableCalls;
exports.getSignableHash = getSignableHash;
exports.accountOpSignableHash = accountOpSignableHash;
exports.haveCallsChanged = haveCallsChanged;
exports.haveAccountOpsChanged = haveAccountOpsChanged;
const ethers_1 = require("ethers");
const deploy_1 = require("../../consts/deploy");
/**
 * If we want to deploy a contract, the to field of Call will actually
 * be empty (undefined). In order to simulate it in a transaction or
 * perform it using a smart account, we need to transform the call to
 * a call to the singleton
 *
 * @param call
 * @returns Call
 */
function toSingletonCall(call) {
    if (call.to)
        return call;
    const singletonABI = [
        {
            inputs: [
                { internalType: 'bytes', name: '_initCode', type: 'bytes' },
                { internalType: 'bytes32', name: '_salt', type: 'bytes32' }
            ],
            name: 'deploy',
            outputs: [{ internalType: 'address payable', name: 'createdContract', type: 'address' }],
            stateMutability: 'nonpayable',
            type: 'function'
        }
    ];
    const singletonInterface = new ethers_1.Interface(singletonABI);
    return {
        to: deploy_1.SINGLETON,
        value: call.value,
        data: singletonInterface.encodeFunctionData('deploy', [call.data, (0, ethers_1.toBeHex)(0, 32)])
    };
}
function callToTuple(call) {
    return [call.to, call.value.toString(), call.data];
}
function canBroadcast(op, accountIsEOA) {
    if (op.signingKeyAddr === null)
        throw new Error('missing signingKeyAddr');
    if (op.signature === null)
        throw new Error('missing signature');
    if (op.gasFeePayment === null)
        throw new Error('missing gasFeePayment');
    if (op.gasLimit === null)
        throw new Error('missing gasLimit');
    if (op.nonce === null)
        throw new Error('missing nonce');
    if (accountIsEOA) {
        if (op.gasFeePayment.isGasTank)
            throw new Error('gas fee payment with gas tank cannot be used with an EOA');
        if (op.gasFeePayment.inToken !== '0x0000000000000000000000000000000000000000')
            throw new Error('gas fee payment needs to be in the native asset');
        if (op.gasFeePayment.paidBy !== op.accountAddr)
            throw new Error('gas fee payment cannot be paid by anyone other than the EOA that signed it');
    }
    return true;
}
function getSignableCalls(op) {
    const callsToSign = op.calls.map(toSingletonCall).map(callToTuple);
    if (op.activatorCall)
        callsToSign.push(callToTuple(op.activatorCall));
    if (op.feeCall)
        callsToSign.push(callToTuple(op.feeCall));
    return callsToSign;
}
function getSignableHash(addr, chainId, nonce, calls) {
    const abiCoder = new ethers_1.AbiCoder();
    return (0, ethers_1.getBytes)((0, ethers_1.keccak256)(abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [addr, chainId, nonce, calls])));
}
/**
 * This function returns the hash as a Uint8Array instead of string
 * and the reason for this is the implementation that follows:
 *
 * const hash = accountOpSignableHash(op); // get the hash
 * const signature = await wallet.signMessage(hash)
 *
 * The signMessage method is an ethers method. It checks whether
 * the hash is a string or not. If it's a string, it calls
 * ethers.toUtf8Bytes to it, completing ignoring that the string
 * might actually be abi-encoded (like in our case).
 *
 * Applying ethers.toUtf8Bytes to a string is only correct if the
 * string is... a utf8 string. In our case, IT IS NOT.
 * That's why we need to wrap in with ethers.getBytes to prevent
 * the sign message from breaking it.
 *
 * If despite everything you wish to return a string instead of a Uint8Array,
 * you have to wrap the hash with ethers.getBytes each time before passing it
 * to signMessage. Also, the reverse method of ethers.getBytes is ethers.hexlify
 * if you need to transform it back.
 *
 * @param op AccountOp
 * @returns Uint8Array
 */
function accountOpSignableHash(op, chainId) {
    return getSignableHash(op.accountAddr, chainId, op.nonce ?? 0n, getSignableCalls(op));
}
const areAccountOpsEqual = (ops1, ops2) => {
    if (ops1.length !== ops2.length)
        return false;
    const ops2Ids = new Set(ops2.map((op) => op.id));
    for (const op1 of ops1) {
        if (!ops2Ids.has(op1.id))
            return false;
        if (op1.nonce !== ops2.find((op2) => op2.id === op1.id)?.nonce)
            return false;
    }
    return true;
};
exports.areAccountOpsEqual = areAccountOpsEqual;
function haveCallsChanged(callsOne, callsTwo) {
    const lengthDiff = callsOne.length !== callsTwo.length;
    if (lengthDiff)
        return true;
    // if some of their properties differ, then calls have changed
    for (let i = 0; i < callsOne.length; i++) {
        const callOne = callsOne[i];
        const callTwo = callsTwo[i];
        if (callOne.to !== callTwo?.to ||
            callOne.data !== callTwo?.data ||
            callOne.value !== callTwo?.value ||
            callOne.id !== callTwo?.id) {
            return true;
        }
    }
    return false;
}
function haveAccountOpsChanged(accountOpsOne, accountOpsTwo) {
    const lengthDiff = accountOpsOne.length !== accountOpsTwo.length;
    if (lengthDiff)
        return true;
    for (let i = 0; i < accountOpsOne.length; i++) {
        const oneOp = accountOpsOne[i];
        const twoOp = accountOpsTwo[i];
        if (haveCallsChanged(oneOp.calls, twoOp.calls))
            return true;
    }
    return false;
}
//# sourceMappingURL=accountOp.js.map