"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EOA = void 0;
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
            if (estimation.provider instanceof Error) {
                return estimation.ambire instanceof Error ? estimation.ambire : estimation.provider;
            }
            // case: the provider passes but ambire estimation doesn't
            // this could either be:
            // - a smart account not allowed error, which we should NOT return
            // - OOG which we should return as ambire inner calls estimate is better
            if (estimation.ambire instanceof Error) {
                return estimation.ambire.cause === 'OOG' ? estimation.ambire : null;
            }
            return null;
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
            const call = calls[0]; // ! as we check calls.length === 1 one line above
            // a normal transfer is 21k, so just return the providerEstimation
            if (call.data === '0x')
                return estimation.providerEstimation.gasUsed;
        }
        const ambireGasUsed = estimation.ambireEstimation ? estimation.ambireEstimation.gasUsed : 0n;
        const gasUsed = estimation.providerEstimation.gasUsed > ambireGasUsed
            ? estimation.providerEstimation.gasUsed
            : ambireGasUsed;
        // add a 10% overhead to prevent OOG
        return gasUsed + gasUsed / 10n;
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
    getNonceId() {
        // EOAs have only an execution layer nonce
        return this.accountState.eoaNonce.toString();
    }
    /**
     * We always state override when using an EOA as otherwise,
     * we won't be able to perform the ambire estimation as it works
     * only with smart accounts
     */
    shouldStateOverrideDuringSimulations() {
        return true;
    }
    canBroadcastByOtherEOA() {
        return false;
    }
    canSetCustomGasPrices() {
        return true;
    }
    canSetCustomGas(_feeOption, accountOp) {
        // we do not allow custom gas for a bundle as we can estimate
        // the gas for the next transaction after the first one has completed
        if (accountOp && accountOp.calls.length > 1)
            return false;
        return this.canSetCustomGasPrices();
    }
}
exports.EOA = EOA;
//# sourceMappingURL=EOA.js.map