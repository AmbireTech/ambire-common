"use strict";
// this is the wallet send calls EIP
// https://eips.ethereum.org/EIPS/eip-5792
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVersion = getVersion;
exports.getPendingStatus = getPendingStatus;
exports.getSuccessStatus = getSuccessStatus;
exports.getFailureStatus = getFailureStatus;
function getVersion(accOp) {
    return accOp && accOp.meta && accOp.meta.walletSendCallsVersion
        ? accOp.meta.walletSendCallsVersion
        : '1.0.0';
}
function getPendingStatus(version) {
    return version === '2.0.0' ? 100 : 'PENDING';
}
function getSuccessStatus(version) {
    return version === '2.0.0' ? 200 : 'CONFIRMED';
}
function getFailureStatus(version) {
    return version === '2.0.0' ? 400 : 'FAILURE';
}
//# sourceMappingURL=5792.js.map