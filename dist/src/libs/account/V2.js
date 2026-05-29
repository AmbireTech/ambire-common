/* eslint-disable @typescript-eslint/no-unused-vars */
import { Interface, ZeroAddress } from 'ethers';
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json';
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json';
import { ENTRY_POINT_MARKER, ERC_4337_ENTRYPOINT } from '../../consts/deploy';
import { getSignableCalls } from '../accountOp/accountOp';
import { BROADCAST_OPTIONS } from '../broadcast/broadcast';
import { getBroadcastGas } from '../gasPrice/gasPrice';
import { isNative } from '../portfolio/helpers';
import { privSlot } from '../proxyDeploy/deploy';
import { getSpoof } from './account';
import { BaseAccount } from './BaseAccount';
import { isTransferredTokenFeeOption } from './feeOptions';
// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
export class V2 extends BaseAccount {
    // we're state overriding the estimation to make it think
    // the account is deployed and it has the entry point as a signer
    //
    // deployment costs are already added and calculated by the ambire estimation
    // we're adding 20k gas for SSTORE in the privilege for the entry point
    // and 15k gas entry point overhead to be on the safe side
    ENTRY_POINT_DEPLOYMENT_ADDITIONAL_GAS = 35000n;
    #isTransitioningTo4337() {
        return this.accountState.isDeployed && !this.accountState.isErc4337Enabled;
    }
    getEstimationCriticalError(estimation) {
        if (estimation.ambire instanceof Error)
            return estimation.ambire;
        return null;
    }
    supportsBundlerEstimation() {
        return !this.#isTransitioningTo4337();
    }
    getAvailableFeeOptions(estimation, feePaymentOptions, op) {
        const hasPaymaster = estimation.bundlerEstimation && estimation.bundlerEstimation.paymaster.isUsable();
        return feePaymentOptions.filter((opt) => 
        // always show account native, even if not enough
        (isNative(opt.token) && opt.paidBy === this.account.addr) ||
            // show EOA native only if it has amount to pay the fee
            (isNative(opt.token) && opt.availableAmount > 0n) ||
            ((opt.availableAmount > 0n || isTransferredTokenFeeOption(opt, op)) &&
                (this.network.hasRelayer || hasPaymaster)));
    }
    getGasUsed(estimation, options) {
        const isError = estimation instanceof Error;
        if (isError || !estimation.ambireEstimation)
            return 0n;
        const ambireBroaddcastGas = getBroadcastGas(this, options.op);
        const ambireGas = ambireBroaddcastGas + estimation.ambireEstimation.gasUsed;
        // are we transitioning to 4337?
        if (this.#isTransitioningTo4337())
            return ambireGas;
        // use the bundler if it doesn't have an error
        if (!estimation.bundlerEstimation)
            return ambireGas;
        let bundlerGasUsed = BigInt(estimation.bundlerEstimation.callGasLimit);
        // if the account is not deployed, add the ambire estimation deployment calc
        // to the bundler total as we're state overriding the bundler to think
        // the account is already deployed during estimation
        if (!this.accountState.isDeployed)
            bundlerGasUsed +=
                estimation.ambireEstimation.deploymentGas + this.ENTRY_POINT_DEPLOYMENT_ADDITIONAL_GAS;
        return bundlerGasUsed > ambireGas ? bundlerGasUsed : ambireGas;
    }
    getBroadcastOption(feeOption, options) {
        if (feeOption.paidBy !== this.getAccount().addr)
            return BROADCAST_OPTIONS.byOtherEOA;
        // keep the relayer only for the transition transaction
        // when the account is deployed but it doesn't have the entry point
        // as a signer
        if (this.#isTransitioningTo4337())
            return BROADCAST_OPTIONS.byRelayer;
        return BROADCAST_OPTIONS.byBundler;
    }
    shouldIncludeActivatorCall(paidBy) {
        // if the account is not deployed and we're paying with an EOA,
        // include the 4337 priv
        if (!this.accountState.isDeployed &&
            paidBy &&
            paidBy.toLowerCase() !== this.account.addr.toLowerCase())
            return true;
        return this.#isTransitioningTo4337();
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
        const ambireFactory = new Interface(AmbireFactory.abi);
        return ambireFactory.encodeFunctionData('deployAndExecute', [
            this.account.creation.bytecode,
            this.account.creation.salt,
            getSignableCalls(accountOp),
            getSpoof(this.account)
        ]);
    }
    getBundlerStateOverride(userOp) {
        if (this.accountState.isDeployed || !!userOp.factory)
            return undefined;
        return {
            [this.account.addr]: {
                code: AmbireAccount.binRuntime,
                stateDiff: {
                    [privSlot(0, 'uint256', ERC_4337_ENTRYPOINT, 'uint256')]: ENTRY_POINT_MARKER
                }
            }
        };
    }
    // we need to authorize the entry point as a signer if we're deploying
    // the account via 4337
    shouldSignDeployAuth(broadcastOption) {
        return broadcastOption === BROADCAST_OPTIONS.byBundler && !this.accountState.isDeployed;
    }
    isSponsorable() {
        return this.network.chainId === 100n;
    }
    getAtomicStatus() {
        return 'supported';
    }
    getNonceId() {
        // v2 accounts have two nonces: ambire smart account & entry point nonce
        return `${this.accountState.nonce.toString()}-${this.accountState.erc4337Nonce.toString()}`;
    }
    async getBroadcastNonce(activity, op, provider) {
        return op.nonce;
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
    canSetCustomGasPrices(feeOption) {
        return (feeOption.token.address === ZeroAddress &&
            feeOption.paidBy.toLowerCase() !== this.account.addr.toLowerCase());
    }
    canSetCustomGas(feeOption) {
        return this.canSetCustomGasPrices(feeOption);
    }
}
//# sourceMappingURL=V2.js.map