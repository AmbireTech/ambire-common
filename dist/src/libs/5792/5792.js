// this is the wallet send calls EIP
// https://eips.ethereum.org/EIPS/eip-5792
export function getVersion(accOp) {
    return accOp && accOp.meta && accOp.meta.walletSendCallsVersion
        ? accOp.meta.walletSendCallsVersion
        : '1.0.0';
}
export function getPendingStatus(version) {
    return version === '2.0.0' ? 100 : 'PENDING';
}
export function getSuccessStatus(version) {
    return version === '2.0.0' ? 200 : 'CONFIRMED';
}
export function getFailureStatus(version) {
    return version === '2.0.0' ? 400 : 'FAILURE';
}
//# sourceMappingURL=5792.js.map