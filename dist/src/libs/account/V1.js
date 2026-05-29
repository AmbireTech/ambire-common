/* eslint-disable @typescript-eslint/no-unused-vars */
import { Interface, ZeroAddress } from 'ethers';
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json';
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json';
import { ARBITRUM_CHAIN_ID } from '../../consts/networks';
import { getRelayerNonce } from '../../utils/nonce';
import { getSignableCalls } from '../accountOp/accountOp';
import { BROADCAST_OPTIONS } from '../broadcast/broadcast';
import { getBroadcastGas } from '../gasPrice/gasPrice';
import { getSpoof } from './account';
import { BaseAccount } from './BaseAccount';
// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
export class V1 extends BaseAccount {
    getEstimationCriticalError(estimation) {
        if (estimation.ambire instanceof Error)
            return estimation.ambire;
        return null;
    }
    supportsBundlerEstimation() {
        return false;
    }
    getAvailableFeeOptions(estimation, feePaymentOptions) {
        const options = feePaymentOptions.filter((opt) => opt.paidBy !== this.account.addr && opt.availableAmount > 0n);
        if (options.length)
            return options;
        // return the native only to display errors
        const native = feePaymentOptions.find((opt) => opt.paidBy === this.account.addr &&
            opt.token.address === ZeroAddress &&
            !opt.token.flags.onGasTank);
        if (!native)
            throw new Error('no native fee payment option, it should not happen');
        native.availableAmount = 0n;
        return [native];
    }
    getGasUsed(estimation, options) {
        const isError = estimation instanceof Error;
        if (isError || !estimation.ambireEstimation)
            return 0n;
        const providerGasUsed = estimation.providerEstimation
            ? estimation.providerEstimation.gasUsed
            : 0n;
        const ambireBroaddcastGas = getBroadcastGas(this, options.op);
        const ambireGas = ambireBroaddcastGas + estimation.ambireEstimation.gasUsed;
        // use ambireEstimation.gasUsed in all cases except Arbitrum when
        // the provider gas is more than the ambire gas
        return this.network.chainId === ARBITRUM_CHAIN_ID && providerGasUsed > ambireGas
            ? providerGasUsed
            : ambireGas;
    }
    getBroadcastOption(feeOption, options) {
        if (feeOption.paidBy !== this.getAccount().addr)
            return BROADCAST_OPTIONS.byOtherEOA;
        return BROADCAST_OPTIONS.byRelayer;
    }
    canUseReceivingNativeForFee() {
        return true;
    }
    getBroadcastCalldata(accountOp) {
        if (this.accountState.isDeployed) {
            const ambireAccount = new Interface(AmbireAccount.abi);
            return ambireAccount.encodeFunctionData('executeBySender', [
                getSignableCalls(accountOp)
            ]);
        }
        // deployAndExecuteMultiple is the worst case
        const ambireFactory = new Interface(AmbireFactory.abi);
        return ambireFactory.encodeFunctionData('deployAndExecute', [
            this.account.creation.bytecode,
            this.account.creation.salt,
            getSignableCalls(accountOp),
            getSpoof(this.account)
        ]);
    }
    getAtomicStatus() {
        return 'supported';
    }
    getNonceId() {
        // v1 accounts can only have an ambire smart contract nonce
        return this.accountState.nonce.toString();
    }
    async getBroadcastNonce(activity, op, provider) {
        return getRelayerNonce(activity, op, provider);
    }
    /**
     * The Ambire estimation is made to work perfectly with Ambire SA
     */
    shouldStateOverrideDuringSimulations() {
        return false;
    }
    canBroadcastByOtherEOA() {
        return true;
    }
    canSetCustomGasPrices() {
        return true;
    }
    canSetCustomGas() {
        return this.canSetCustomGasPrices();
    }
}
//# sourceMappingURL=V1.js.map