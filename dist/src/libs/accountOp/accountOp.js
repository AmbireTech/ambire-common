"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSignableCalls = exports.isNative = exports.accountOpSignableHash = exports.isAccountOpsIntentEqual = exports.canBroadcast = exports.callToTuple = exports.AccountOpStatus = void 0;
const ethers_1 = require("ethers");
const networks_1 = require("../../consts/networks");
const bigintJson_1 = require("../bigintJson/bigintJson");
var AccountOpStatus;
(function (AccountOpStatus) {
    AccountOpStatus["Pending"] = "pending";
    AccountOpStatus["BroadcastedButNotConfirmed"] = "broadcasted-but-not-confirmed";
    AccountOpStatus["Success"] = "success";
    AccountOpStatus["Failure"] = "failure";
    AccountOpStatus["UnknownButPastNonce"] = "unknown-but-past-nonce";
})(AccountOpStatus || (exports.AccountOpStatus = AccountOpStatus = {}));
function callToTuple(call) {
    return [call.to, call.value.toString(), call.data];
}
exports.callToTuple = callToTuple;
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
exports.canBroadcast = canBroadcast;
/**
 * Compare two AccountOps intents.
 *
 * By 'intent,' we are referring to the sender of the transaction, the network it is sent on, and the included calls.
 *
 * Since we are comparing the intents, we exclude any other properties of the AccountOps.
 */
function isAccountOpsIntentEqual(accountOps1, accountOps2) {
    const createIntent = (accountOps) => {
        return accountOps.map(({ accountAddr, networkId, calls }) => ({
            accountAddr,
            networkId,
            calls
        }));
    };
    return (0, bigintJson_1.stringify)(createIntent(accountOps1)) === (0, bigintJson_1.stringify)(createIntent(accountOps2));
}
exports.isAccountOpsIntentEqual = isAccountOpsIntentEqual;
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
function accountOpSignableHash(op) {
    const opNetworks = networks_1.networks.filter((network) => op.networkId === network.id);
    if (!opNetworks.length)
        throw new Error('unsupported network');
    const abiCoder = new ethers_1.ethers.AbiCoder();
    return ethers_1.ethers.getBytes(ethers_1.ethers.keccak256(abiCoder.encode(['address', 'uint', 'uint', 'tuple(address, uint, bytes)[]'], [op.accountAddr, opNetworks[0].chainId, op.nonce ?? 0n, getSignableCalls(op)])));
}
exports.accountOpSignableHash = accountOpSignableHash;
/**
 * We're paying the fee in native only if:
 * - it's not a gas tank payment
 * - the gasFeePayment.inToken points to address 0
 *
 * @param gasFeePayment
 * @returns boolean
 */
function isNative(gasFeePayment) {
    return (!gasFeePayment.isGasTank &&
        gasFeePayment.inToken == '0x0000000000000000000000000000000000000000');
}
exports.isNative = isNative;
function getSignableCalls(op) {
    const callsToSign = op.calls.map((call) => callToTuple(call));
    if (op.feeCall)
        callsToSign.push(callToTuple(op.feeCall));
    return callsToSign;
}
exports.getSignableCalls = getSignableCalls;
//# sourceMappingURL=accountOp.js.map