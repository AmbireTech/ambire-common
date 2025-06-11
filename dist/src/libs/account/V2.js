"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.V2 = void 0;
const tslib_1 = require("tslib");
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-unused-vars */
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const AmbireFactory_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireFactory.json"));
const deploy_1 = require("../../consts/deploy");
const accountOp_1 = require("../accountOp/accountOp");
const broadcast_1 = require("../broadcast/broadcast");
const gasPrice_1 = require("../gasPrice/gasPrice");
const helpers_1 = require("../portfolio/helpers");
const deploy_2 = require("../proxyDeploy/deploy");
const BaseAccount_1 = require("./BaseAccount");
const account_1 = require("./account");
// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
class V2 extends BaseAccount_1.BaseAccount {
    // we're state overriding the estimation to make it think
    // the account is deployed and it has the entry point as a signer
    //
    // deployment costs are already added and calculated by the ambire estimation
    // we're adding 20k gas for SSTORE in the privilege for the entry point
    // and 15k gas entry point overhead to be on the safe side
    ENTRY_POINT_DEPLOYMENT_ADDITIONAL_GAS = 35000n;
    getEstimationCriticalError(estimation) {
        if (estimation.ambire instanceof Error)
            return estimation.ambire;
        return null;
    }
    supportsBundlerEstimation() {
        return this.network.erc4337.enabled;
    }
    getAvailableFeeOptions(estimation, feePaymentOptions) {
        const hasPaymaster = this.network.erc4337.enabled &&
            estimation.bundlerEstimation &&
            estimation.bundlerEstimation.paymaster.isUsable();
        // on a 4437 network where the account is not deployed,
        // we force the user to pay by ERC-4337 to enable the entry point
        if (this.network.erc4337.enabled && !this.accountState.isDeployed) {
            return feePaymentOptions.filter((opt) => opt.paidBy === this.account.addr &&
                ((0, helpers_1.isNative)(opt.token) || (opt.availableAmount > 0n && hasPaymaster)));
        }
        const hasRelayer = !this.network.erc4337.enabled && this.network.hasRelayer;
        return feePaymentOptions.filter((opt) => (0, helpers_1.isNative)(opt.token) || (opt.availableAmount > 0n && (hasPaymaster || hasRelayer)));
    }
    getGasUsed(estimation, options) {
        const isError = estimation instanceof Error;
        if (isError || !estimation.ambireEstimation)
            return 0n;
        const ambireBroaddcastGas = (0, gasPrice_1.getBroadcastGas)(this, options.op);
        const ambireGas = ambireBroaddcastGas + estimation.ambireEstimation.gasUsed;
        // no 4337 => use ambireEstimation
        if (!this.network.erc4337.enabled)
            return ambireGas;
        // has 4337 => use the bundler if it doesn't have an error
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
            return broadcast_1.BROADCAST_OPTIONS.byOtherEOA;
        if (this.network.erc4337.enabled)
            return broadcast_1.BROADCAST_OPTIONS.byBundler;
        return broadcast_1.BROADCAST_OPTIONS.byRelayer;
    }
    shouldIncludeActivatorCall(broadcastOption) {
        return (this.network.erc4337.enabled &&
            !this.accountState.isErc4337Enabled &&
            broadcastOption === broadcast_1.BROADCAST_OPTIONS.byOtherEOA);
    }
    canUseReceivingNativeForFee() {
        return true;
    }
    getBroadcastCalldata(accountOp) {
        if (this.accountState.isDeployed) {
            const ambireAccount = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
            return ambireAccount.encodeFunctionData('executeBySender', [
                (0, accountOp_1.getSignableCalls)(accountOp)
            ]);
        }
        // deployAndExecuteMultiple is the worst case
        const ambireFactory = new ethers_1.Interface(AmbireFactory_json_1.default.abi);
        return ambireFactory.encodeFunctionData('deployAndExecute', [
            this.account.creation.bytecode,
            this.account.creation.salt,
            (0, accountOp_1.getSignableCalls)(accountOp),
            (0, account_1.getSpoof)(this.account)
        ]);
    }
    getBundlerStateOverride(userOp) {
        if (this.accountState.isDeployed || !!userOp.factory)
            return undefined;
        return {
            [this.account.addr]: {
                code: AmbireAccount_json_1.default.binRuntime,
                stateDiff: {
                    [(0, deploy_2.privSlot)(0, 'uint256', deploy_1.ERC_4337_ENTRYPOINT, 'uint256')]: deploy_1.ENTRY_POINT_MARKER
                }
            }
        };
    }
    // we need to authorize the entry point as a signer if we're deploying
    // the account via 4337
    shouldSignDeployAuth(broadcastOption) {
        return broadcastOption === broadcast_1.BROADCAST_OPTIONS.byBundler && !this.accountState.isDeployed;
    }
    isSponsorable() {
        return this.network.chainId === 100n;
    }
    getAtomicStatus() {
        return 'supported';
    }
}
exports.V2 = V2;
//# sourceMappingURL=V2.js.map