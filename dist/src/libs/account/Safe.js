/* eslint-disable @typescript-eslint/no-unused-vars */
import { AbiCoder, concat, Interface, ZeroAddress } from 'ethers';
import { execTransactionAbi, multiSendAddr } from '../../consts/safe';
import { getSafeTypedData, getSafeV1TypedData } from '../../libs/signMessage/signMessage';
import { getSignableCalls } from '../accountOp/accountOp';
import { BROADCAST_OPTIONS } from '../broadcast/broadcast';
import { getSigForCalculations } from '../estimate/estimateHelpers';
import { getBroadcastGas } from '../gasPrice/gasPrice';
import { isNative } from '../portfolio/helpers';
import { BaseAccount } from './BaseAccount';
// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
export class Safe extends BaseAccount {
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
    getEstimationCriticalError(estimation) {
        if (estimation.ambire instanceof Error)
            return estimation.ambire;
        return null;
    }
    supportsBundlerEstimation() {
        return false;
    }
    isSponsorable() {
        return false;
    }
    getAvailableFeeOptions(estimation, feePaymentOptions) {
        return feePaymentOptions.filter((opt) => isNative(opt.token));
    }
    getGasUsed(estimation, options) {
        const isError = estimation instanceof Error;
        if (isError || !estimation.ambireEstimation)
            return 0n;
        const ambireBroaddcastGas = getBroadcastGas(this, options.op);
        const nonceGas = this.accountState.nonce === 0n ? this.NONCE_ZERO_GAS : this.NONCE_GAS;
        // each call to self results in a 0 estimate bcz of state overrides
        let callToSelfGas = 0n;
        for (let i = 0; i < options.op.calls.length; i++) {
            const call = options.op.calls[i];
            if (call.to && call.to.toLowerCase() === this.account.addr.toLowerCase()) {
                callToSelfGas += this.CALL_TO_SELF_GAS;
            }
        }
        return (ambireBroaddcastGas +
            estimation.ambireEstimation.gasUsed +
            callToSelfGas +
            this.EXTRA_ESTIMATION_GAS +
            nonceGas);
    }
    getBroadcastOption() {
        return BROADCAST_OPTIONS.byOtherEOA;
    }
    canUseReceivingNativeForFee() {
        return false; // because we're always paying with EOA atm
    }
    getBroadcastCalldata(accountOp) {
        const exec = new Interface(execTransactionAbi);
        const calls = getSignableCalls(accountOp);
        const coder = new AbiCoder();
        const multiSendCalls = calls.map((call) => {
            return coder.encode(['uint8', 'address', 'uint256', 'uint256', 'bytes'], [0, call[0], call[1], call[2].length, call[2]]);
        });
        // signature cost is equal to the threshold
        let signature = getSigForCalculations();
        for (let i = 1; i < this.accountState.threshold; i++) {
            signature = concat([signature, getSigForCalculations()]);
        }
        return exec.encodeFunctionData('execTransaction', [
            multiSendAddr,
            0n,
            concat(multiSendCalls),
            1n, // multiSend only works with delegate call
            0n, // safe, outer gas gets set
            0n, // safe, outer gas gets set
            0n, // safe, outer gas price gets set
            ZeroAddress, // gasToken
            ZeroAddress, // no refunder
            signature
        ]);
    }
    getBundlerStateOverride(userOp) {
        return undefined;
    }
    // should we authorize the entry point;
    // since we're not using 4337 for Safe accounts for now, we keep it false
    shouldSignDeployAuth(broadcastOption) {
        return false;
    }
    getAtomicStatus() {
        return 'supported';
    }
    getNonceId() {
        // the Safe will move only its own smart account nonce as we don't have 4337
        return `${this.accountState.nonce.toString()}`;
    }
    canBroadcastByItself() {
        // later, when we enable 4337:
        // check the account version and enable this for versions > 1.3
        return false;
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
     * We encapsulate the logic here
     */
    getTxnTypedData(safeTx) {
        const safeCreation = this.account.safeCreation;
        if (safeCreation.version.startsWith('1.1.') || safeCreation.version.startsWith('1.2'))
            return getSafeV1TypedData(this.account.addr, safeTx);
        return getSafeTypedData(this.network.chainId, this.account.addr, safeTx);
    }
    canSetCustomGasPrices() {
        return true;
    }
    canSetCustomGas() {
        return this.canSetCustomGasPrices();
    }
}
//# sourceMappingURL=Safe.js.map