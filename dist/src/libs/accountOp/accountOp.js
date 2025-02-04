import { AbiCoder, getBytes, Interface, keccak256, toBeHex } from 'ethers';
import { SINGLETON } from '../../consts/deploy';
import { stringify } from '../richJson/richJson';
export var AccountOpStatus;
(function (AccountOpStatus) {
    AccountOpStatus["Pending"] = "pending";
    AccountOpStatus["BroadcastedButNotConfirmed"] = "broadcasted-but-not-confirmed";
    AccountOpStatus["Success"] = "success";
    AccountOpStatus["Failure"] = "failure";
    AccountOpStatus["Rejected"] = "rejected";
    AccountOpStatus["UnknownButPastNonce"] = "unknown-but-past-nonce";
    AccountOpStatus["BroadcastButStuck"] = "broadcast-but-stuck";
})(AccountOpStatus || (AccountOpStatus = {}));
/**
 * If we want to deploy a contract, the to field of Call will actually
 * be empty (undefined). In order to simulate it in a transaction or
 * perform it using a smart account, we need to transform the call to
 * a call to the singleton
 *
 * @param call
 * @returns Call
 */
export function toSingletonCall(call) {
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
    const singletonInterface = new Interface(singletonABI);
    return {
        to: SINGLETON,
        value: call.value,
        data: singletonInterface.encodeFunctionData('deploy', [call.data, toBeHex(0, 32)])
    };
}
export function callToTuple(call) {
    return [call.to, call.value.toString(), call.data];
}
export function canBroadcast(op, accountIsEOA) {
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
export function isAccountOpsIntentEqual(accountOps1, accountOps2) {
    const createIntent = (accountOps) => {
        return accountOps.map(({ accountAddr, networkId, calls }) => ({
            accountAddr,
            networkId,
            calls
        }));
    };
    return stringify(createIntent(accountOps1)) === stringify(createIntent(accountOps2));
}
export function getSignableCalls(op) {
    const callsToSign = op.calls.map(toSingletonCall).map(callToTuple);
    if (op.activatorCall)
        callsToSign.push(callToTuple(op.activatorCall));
    if (op.feeCall)
        callsToSign.push(callToTuple(op.feeCall));
    return callsToSign;
}
export function getSignableCallsForBundlerEstimate(op) {
    const callsToSign = getSignableCalls(op);
    // add the fee call one more time when doing a bundler estimate
    // this is because the feeCall during estimation is fake (approve instead
    // of transfer, incorrect amount) and more ofteh than not, this causes
    // a lower estimation than the real one, causing bad UX in the process
    if (op.feeCall)
        callsToSign.push(callToTuple(op.feeCall));
    return callsToSign;
}
export function getSignableHash(addr, chainId, nonce, calls) {
    const abiCoder = new AbiCoder();
    return getBytes(keccak256(abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [addr, chainId, nonce, calls])));
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
export function accountOpSignableHash(op, chainId) {
    return getSignableHash(op.accountAddr, chainId, op.nonce ?? 0n, getSignableCalls(op));
}
//# sourceMappingURL=accountOp.js.map