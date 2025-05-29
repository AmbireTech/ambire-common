"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EOA7702 = void 0;
const tslib_1 = require("tslib");
/* eslint-disable class-methods-use-this */
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const AmbireAccount7702_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount7702.json"));
const accountOp_1 = require("../accountOp/accountOp");
const broadcast_1 = require("../broadcast/broadcast");
const gasPrice_1 = require("../gasPrice/gasPrice");
const helpers_1 = require("../portfolio/helpers");
const BaseAccount_1 = require("./BaseAccount");
// this class describes an EOA that CAN transition to 7702
// even if it is YET to transition to 7702
class EOA7702 extends BaseAccount_1.BaseAccount {
    // when doing the 7702 activator, we should add the additional gas required
    // for the authorization list:
    // PER_EMPTY_ACCOUNT_COST: 25000
    // access list storage key: 1900
    // access list address: 2400
    ACTIVATOR_GAS_USED = 29300n;
    /**
     * Introduce a public variable we can use to make a simple check on the FE
     * whether this account type is 7702.
     * This should only be used in cases where refactoring the logic on the FE
     * would mean a time-consuming event like sorting the fee payment options.
     * Use this as an exception rather than rule. Long term, we should refactor
     */
    is7702 = true;
    getEstimationCriticalError(estimation, op) {
        // the critical error should be from the provider if we can broadcast in EOA only mode
        if (!this.accountState.isSmarterEoa && op.calls.length === 1) {
            return estimation.provider instanceof Error ? estimation.provider : null;
        }
        if (estimation.ambire instanceof Error)
            return estimation.ambire;
        return null;
    }
    supportsBundlerEstimation() {
        return true;
    }
    /*
     * Available options:
     * - Native
     * - Token/Gas tank, if bundler estimation & paymaster
     */
    getAvailableFeeOptions(estimation, feePaymentOptions, op) {
        const isDelegating = op.meta && op.meta.setDelegation !== undefined;
        return feePaymentOptions.filter((opt) => opt.paidBy === this.account.addr &&
            ((0, helpers_1.isNative)(opt.token) ||
                (!isDelegating &&
                    opt.availableAmount > 0n &&
                    estimation.bundlerEstimation &&
                    estimation.bundlerEstimation.paymaster.isUsable())));
    }
    getGasUsed(estimation, options) {
        const isError = estimation instanceof Error;
        if (isError)
            return 0n;
        if ((0, helpers_1.isNative)(options.feeToken)) {
            // if we're delegating, we need to add the gas used for the authorization list
            const isDelegating = options.op.meta && options.op.meta.setDelegation !== undefined;
            const revokeGas = isDelegating ? this.ACTIVATOR_GAS_USED : 0n;
            if (this.accountState.isSmarterEoa) {
                // smarter EOAs with a failing ambire estimation cannot broadcast
                if (!estimation.ambireEstimation)
                    return 0n;
                // paying in native + smartEOA makes the provider estimation more accurate
                if (estimation.providerEstimation)
                    return estimation.providerEstimation.gasUsed + revokeGas;
                // trust the ambire estimaton as it's more precise
                // but also add the broadcast gas as it's not included in the ambire estimate
                return estimation.ambireEstimation.gasUsed + (0, gasPrice_1.getBroadcastGas)(this, options.op) + revokeGas;
            }
            // if calls are only 1, use the provider if set
            const numberOfCalls = options.op.calls.length;
            if (numberOfCalls === 1) {
                if (estimation.providerEstimation)
                    return estimation.providerEstimation.gasUsed + revokeGas;
                return estimation.ambireEstimation ? estimation.ambireEstimation.gasUsed + revokeGas : 0n;
            }
            // txn type 4 from here: not smarter with a batch, we need the bundler
            if (!estimation.bundlerEstimation)
                return 0n;
            return BigInt(estimation.bundlerEstimation.callGasLimit) + this.ACTIVATOR_GAS_USED;
        }
        // if we're paying in tokens, we're using the bundler
        if (!estimation.bundlerEstimation)
            return 0n;
        return this.accountState.isSmarterEoa
            ? BigInt(estimation.bundlerEstimation.callGasLimit)
            : BigInt(estimation.bundlerEstimation.callGasLimit) + this.ACTIVATOR_GAS_USED;
    }
    getBroadcastOption(feeOption, options) {
        if (options.op.meta && options.op.meta.setDelegation !== undefined)
            return broadcast_1.BROADCAST_OPTIONS.delegation;
        if (options.isSponsored)
            return broadcast_1.BROADCAST_OPTIONS.byBundler;
        const feeToken = feeOption.token;
        if ((0, helpers_1.isNative)(feeToken)) {
            // if there's no native in the account, use the bundler as a broadcast method
            if (feeToken.amount === 0n)
                return broadcast_1.BROADCAST_OPTIONS.byBundler;
            // if the call is only 1, broadcast normally
            if (options.op.calls.length === 1)
                return broadcast_1.BROADCAST_OPTIONS.bySelf;
            // if already smart, executeBySender() on itself
            if (this.accountState.isSmarterEoa)
                return broadcast_1.BROADCAST_OPTIONS.bySelf7702;
        }
        // txn type 4 OR paying in token
        return broadcast_1.BROADCAST_OPTIONS.byBundler;
    }
    // if the EOA is not yet smarter and the broadcast option is a bundler,
    // sign the authorization
    shouldSignAuthorization(broadcastOption) {
        return !this.accountState.isSmarterEoa && broadcastOption === broadcast_1.BROADCAST_OPTIONS.byBundler;
    }
    canUseReceivingNativeForFee(amount) {
        // when we use the bundler, we can use receiving eth for fee payment
        return !this.accountState.isSmarterEoa || amount === 0n;
    }
    getBroadcastCalldata(accountOp) {
        const ambireAccount = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
        return ambireAccount.encodeFunctionData('executeBySender', [(0, accountOp_1.getSignableCalls)(accountOp)]);
    }
    getBundlerStateOverride(userOp) {
        if (this.accountState.isSmarterEoa || !!userOp.eip7702Auth)
            return undefined;
        // if EOA without eip7702Auth, make it look like a smart account so we could
        // do the estimation
        return {
            [this.account.addr]: {
                code: AmbireAccount7702_json_1.default.binRuntime
            }
        };
    }
    isSponsorable() {
        return this.network.chainId === 100n;
    }
    getAtomicStatus() {
        return this.accountState.isSmarterEoa ? 'supported' : 'ready';
    }
}
exports.EOA7702 = EOA7702;
//# sourceMappingURL=EOA7702.js.map