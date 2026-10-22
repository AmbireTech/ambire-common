"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Safe = void 0;
const tslib_1 = require("tslib");
/* eslint-disable @typescript-eslint/no-unused-vars */
const ethers_1 = require("ethers");
const SafeNoSignatureValidation_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/SafeNoSignatureValidation.json"));
const safe_1 = require("../../consts/safe");
const signMessage_1 = require("../../libs/signMessage/signMessage");
const accountOp_1 = require("../accountOp/accountOp");
const broadcast_1 = require("../broadcast/broadcast");
const estimateHelpers_1 = require("../estimate/estimateHelpers");
const gasPrice_1 = require("../gasPrice/gasPrice");
const helpers_1 = require("../portfolio/helpers");
const BaseAccount_1 = require("./BaseAccount");
// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
class Safe extends BaseAccount_1.BaseAccount {
    /**
     * We state override the Safe during estimate with the ambire SA
     * so that we could easily perform estimation. There's about a 15k
     * diff between ambire and Safe account gas usage. We add this
     * extra to the gas to make sure txns are passing
     */
    EXTRA_ESTIMATION_GAS = 15000n;
    /**
     * If the account makes calls to itself (owner/threshold changes),
     * add extra gas per call to self as we're state overriding the estimation
     * and calls to self end up calculate as close to 0 gas
     */
    CALL_TO_SELF_GAS = 40000n;
    /**
     * Add 20k additional gas when setting the nonce for the first time
     */
    NONCE_ZERO_GAS = 20000n;
    /**
     * Add 5k additional gas for nonce > 0
     */
    NONCE_GAS = 5000n;
    /**
     * A one time gas addition if the txn is an userOp.
     * This accounts for the missing signature validation data as we're
     * doing a state override during estimation and replacing the original
     * Safe code with one that allows all signatures to pass
     */
    BUNDLER_OVERHEAD = 40000n;
    getEstimationCriticalError(estimation) {
        if (estimation.ambire instanceof Error)
            return estimation.ambire;
        return null;
    }
    supportsBundlerEstimation() {
        return this.isErc4337Enabled;
    }
    isSponsorable() {
        return false;
    }
    canUseErc4337() {
        return true;
    }
    getAvailableFeeOptions(estimation, feePaymentOptions, op) {
        if (op.meta?.isSafeDeploy) {
            return feePaymentOptions.filter((option) => option.paidBy !== this.account.addr && (0, helpers_1.isNative)(option.token));
        }
        const hasPaymaster = estimation.bundlerEstimation &&
            estimation.bundlerEstimation.paymaster.isUsable() &&
            // disable the Safe gas tank for megaeth for now as we need a special
            // estimation implementation for it to make it work
            this.network.chainId !== 4326n;
        return feePaymentOptions.filter((opt) => (0, helpers_1.isNative)(opt.token) || (hasPaymaster && opt.token.flags.onGasTank));
    }
    getGasUsed(estimation, options) {
        const isError = estimation instanceof Error;
        if (isError || !estimation.ambireEstimation)
            return 0n;
        const ambireBroaddcastGas = (0, gasPrice_1.getBroadcastGas)(this, options.op);
        const nonceGas = this.accountState.nonce === 0n ? this.NONCE_ZERO_GAS : this.NONCE_GAS;
        // each call to self results in a 0 estimate bcz of state overrides
        let callToSelfGas = 0n;
        for (let i = 0; i < options.op.calls.length; i++) {
            const call = options.op.calls[i];
            if (call.to && call.to.toLowerCase() === this.account.addr.toLowerCase()) {
                callToSelfGas += this.CALL_TO_SELF_GAS;
            }
        }
        if (estimation.bundlerEstimation && options.feeToken.flags.onGasTank) {
            return (BigInt(estimation.bundlerEstimation.callGasLimit) +
                callToSelfGas +
                this.EXTRA_ESTIMATION_GAS +
                this.BUNDLER_OVERHEAD +
                nonceGas);
        }
        return (ambireBroaddcastGas +
            estimation.ambireEstimation.gasUsed +
            callToSelfGas +
            this.EXTRA_ESTIMATION_GAS +
            nonceGas);
    }
    getBroadcastOption(feeOption) {
        if (feeOption.paidBy === this.getAccount().addr)
            return broadcast_1.BROADCAST_OPTIONS.byBundler;
        return broadcast_1.BROADCAST_OPTIONS.byOtherEOA;
    }
    canUseReceivingNativeForFee() {
        return false; // because the account cannot pay by itself in native
    }
    getBroadcastCalldata(accountOp) {
        if (accountOp.meta?.isSafeDeploy) {
            const deploymentCall = accountOp.calls[0];
            if (!deploymentCall)
                throw new Error('Safe deployment transaction is missing');
            return deploymentCall.data;
        }
        const exec = new ethers_1.Interface(safe_1.execTransactionAbi);
        const calls = (0, accountOp_1.getSignableCalls)(accountOp);
        const coder = new ethers_1.AbiCoder();
        const multiSendCalls = calls.map((call) => {
            return coder.encode(['uint8', 'address', 'uint256', 'uint256', 'bytes'], [0, call[0], call[1], call[2].length, call[2]]);
        });
        // signature cost is equal to the threshold
        let signature = (0, estimateHelpers_1.getSigForCalculations)();
        for (let i = 1; i < this.accountState.threshold; i++) {
            signature = (0, ethers_1.concat)([signature, (0, estimateHelpers_1.getSigForCalculations)()]);
        }
        return exec.encodeFunctionData('execTransaction', [
            safe_1.multiSendAddr,
            0n,
            (0, ethers_1.concat)(multiSendCalls),
            1n, // multiSend only works with delegate call
            0n, // safe, outer gas gets set
            0n, // safe, outer gas gets set
            0n, // safe, outer gas price gets set
            ethers_1.ZeroAddress, // gasToken
            ethers_1.ZeroAddress, // no refunder
            signature
        ]);
    }
    /**
     * We override the state to an ambire smart account so we could
     * successfully do a bundler estimation. Safe accounts don't have
     * the 4337 module attached so they revert
     */
    getBundlerStateOverride() {
        return {
            [this.account.addr]: {
                code: SafeNoSignatureValidation_json_1.default.binRuntime
            }
        };
    }
    // Safe deployment does not use Ambire entry point deployment authorization.
    shouldSignDeployAuth() {
        return false;
    }
    getAtomicStatus() {
        return 'supported';
    }
    getNonceId() {
        // the Safe will move only its own smart account nonce
        return `${this.accountState.nonce.toString()}`;
    }
    canBroadcastByItself() {
        return true;
    }
    async getBroadcastNonce(activity, op, provider) {
        // the Safe account nonce
        return op.nonce;
    }
    /**
     * We state override safes as the ambire estimation is working
     * with Ambire smart accounts
     */
    shouldStateOverrideDuringSimulations() {
        return true;
    }
    canBroadcastByOtherEOA() {
        return true;
    }
    /**
     * Final commitment Safe data can differ according to the Safe v.
     * The version is chain specific, so it's taken from the account state.
     * We encapsulate the logic here
     */
    getTxnTypedData(safeTx) {
        const safeVersion = this.accountState.safeVersion ?? '';
        if (safeVersion.startsWith('1.1.') || safeVersion.startsWith('1.2'))
            return (0, signMessage_1.getSafeV1TypedData)(this.account.addr, safeTx);
        return (0, signMessage_1.getSafeTypedData)(this.network.chainId, this.account.addr, safeTx);
    }
    canSetCustomGasPrices() {
        return true;
    }
    canSetCustomGas() {
        return this.canSetCustomGasPrices();
    }
}
exports.Safe = Safe;
//# sourceMappingURL=Safe.js.map