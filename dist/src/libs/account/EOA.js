"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EOA = void 0;
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-unused-vars */
const ethers_1 = require("ethers");
const broadcast_1 = require("../broadcast/broadcast");
const BaseAccount_1 = require("./BaseAccount");
// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
class EOA extends BaseAccount_1.BaseAccount {
    providerEstimation;
    ambireEstimation;
    getEstimationCriticalError(estimation, op) {
        const numberOfCalls = op.calls.length;
        if (numberOfCalls === 1) {
            if (estimation.provider instanceof Error)
                return estimation.provider;
        }
        if (numberOfCalls > 1) {
            if (estimation.ambire instanceof Error)
                return estimation.ambire;
        }
        return null;
    }
    supportsBundlerEstimation() {
        return false;
    }
    getAvailableFeeOptions(estimation, feePaymentOptions) {
        const native = feePaymentOptions.find((opt) => opt.paidBy === this.account.addr &&
            opt.token.address === ethers_1.ZeroAddress &&
            !opt.token.flags.onGasTank);
        if (!native)
            throw new Error('no native fee payment option, it should not happen');
        return [native];
    }
    getGasUsed(estimation, options) {
        const isError = estimation instanceof Error;
        if (isError || !estimation.providerEstimation || !options.op)
            return 0n;
        const calls = options.op.calls;
        if (calls.length === 1) {
            const call = calls[0];
            // a normal transfer is 21k, so just return the providerEstimation
            if (call.data === '0x')
                return estimation.providerEstimation.gasUsed;
        }
        const ambireGasUsed = estimation.ambireEstimation ? estimation.ambireEstimation.gasUsed : 0n;
        return estimation.providerEstimation.gasUsed > ambireGasUsed
            ? estimation.providerEstimation.gasUsed
            : ambireGasUsed;
    }
    getBroadcastOption(feeOption, options) {
        return broadcast_1.BROADCAST_OPTIONS.bySelf;
    }
    shouldBroadcastCallsSeparately(op) {
        return op.calls.length > 1;
    }
    canUseReceivingNativeForFee() {
        return false;
    }
    getBroadcastCalldata() {
        return '0x';
    }
    getAtomicStatus() {
        return 'unsupported';
    }
}
exports.EOA = EOA;
//# sourceMappingURL=EOA.js.map