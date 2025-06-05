"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.V1 = void 0;
const tslib_1 = require("tslib");
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-unused-vars */
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const AmbireFactory_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireFactory.json"));
const networks_1 = require("../../consts/networks");
const accountOp_1 = require("../accountOp/accountOp");
const broadcast_1 = require("../broadcast/broadcast");
const gasPrice_1 = require("../gasPrice/gasPrice");
const helpers_1 = require("../portfolio/helpers");
const BaseAccount_1 = require("./BaseAccount");
const account_1 = require("./account");
// this class describes a plain EOA that cannot transition
// to 7702 either because the network or the hardware wallet doesnt' support it
class V1 extends BaseAccount_1.BaseAccount {
    getEstimationCriticalError(estimation) {
        if (estimation.ambire instanceof Error)
            return estimation.ambire;
        return null;
    }
    supportsBundlerEstimation() {
        return false;
    }
    getAvailableFeeOptions(estimation, feePaymentOptions) {
        return feePaymentOptions.filter((opt) => (0, helpers_1.isNative)(opt.token) || opt.availableAmount > 0n);
    }
    getGasUsed(estimation, options) {
        const isError = estimation instanceof Error;
        if (isError || !estimation.ambireEstimation)
            return 0n;
        const providerGasUsed = estimation.providerEstimation
            ? estimation.providerEstimation.gasUsed
            : 0n;
        const ambireBroaddcastGas = (0, gasPrice_1.getBroadcastGas)(this, options.op);
        const ambireGas = ambireBroaddcastGas + estimation.ambireEstimation.gasUsed;
        // use ambireEstimation.gasUsed in all cases except Arbitrum when
        // the provider gas is more than the ambire gas
        return this.network.chainId === networks_1.ARBITRUM_CHAIN_ID && providerGasUsed > ambireGas
            ? providerGasUsed
            : ambireGas;
    }
    getBroadcastOption(feeOption, options) {
        if (feeOption.paidBy !== this.getAccount().addr)
            return broadcast_1.BROADCAST_OPTIONS.byOtherEOA;
        return broadcast_1.BROADCAST_OPTIONS.byRelayer;
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
    getAtomicStatus() {
        return 'supported';
    }
}
exports.V1 = V1;
//# sourceMappingURL=V1.js.map