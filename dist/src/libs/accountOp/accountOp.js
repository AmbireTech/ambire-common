"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canBroadcast = exports.isEOA = exports.callToTuple = exports.GasFeePaymentType = void 0;
var GasFeePaymentType;
(function (GasFeePaymentType) {
    // when a paymaster is used, we put it in the `paidBy` instead of the accountAddr
    GasFeePaymentType["ERC4337"] = "erc4337";
    GasFeePaymentType["AmbireRelayer"] = "ambireRelayer";
    GasFeePaymentType["AmbireGasTank"] = "ambireGasTank";
    // we use this in two cases: 1) Ambire account, fee paid by an EOA 2) account itself is an EAO
    // when the account itself is an EOA, paymentType equals accountAddr
    GasFeePaymentType["EOA"] = "eoa";
})(GasFeePaymentType = exports.GasFeePaymentType || (exports.GasFeePaymentType = {}));
function callToTuple(call) {
    return [call.to, call.value, call.data];
}
exports.callToTuple = callToTuple;
function isEOA(op) {
    if (op.gasFeePayment === null)
        throw new Error('missing gasFeePayment');
    return op.gasFeePayment.paymentType === GasFeePaymentType.EOA
        && op.gasFeePayment.paidBy === op.accountAddr;
}
exports.isEOA = isEOA;
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
        if (op.gasFeePayment.paymentType !== GasFeePaymentType.EOA)
            throw new Error('gas fee payment type is not EOA');
        if (op.gasFeePayment.paidBy !== op.accountAddr)
            throw new Error('gas fee payment cannot be paid by anyone other than the EOA that signed it');
    }
    return true;
}
exports.canBroadcast = canBroadcast;
//# sourceMappingURL=accountOp.js.map