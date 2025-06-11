"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toSingletonCall = toSingletonCall;
exports.callToTuple = callToTuple;
exports.canBroadcast = canBroadcast;
exports.isAccountOpsIntentEqual = isAccountOpsIntentEqual;
exports.getSignableCalls = getSignableCalls;
exports.getSignableHash = getSignableHash;
exports.accountOpSignableHash = accountOpSignableHash;
const ethers_1 = require("ethers");
const deploy_1 = require("../../consts/deploy");
const richJson_1 = require("../richJson/richJson");
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
/**
 * Compare two AccountOps intents.
 *
 * By 'intent,' we are referring to the sender of the transaction, the network it is sent on, and the included calls.
 *
 * Since we are comparing the intents, we exclude any other properties of the AccountOps.
 */
function isAccountOpsIntentEqual(accountOps1, accountOps2) {
    const createIntent = (accountOps) => {
        return accountOps.map(({ accountAddr, chainId, calls }) => ({
            accountAddr,
            chainId,
            calls
        }));
    };
    return (0, richJson_1.stringify)(createIntent(accountOps1)) === (0, richJson_1.stringify)(createIntent(accountOps2));
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
//# sourceMappingURL=accountOp.js.map