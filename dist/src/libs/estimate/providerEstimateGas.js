"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getEstimateGasProps = getEstimateGasProps;
exports.providerEstimateGas = providerEstimateGas;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const deploy_1 = require("../../consts/deploy");
const account_1 = require("../account/account");
const accountOp_1 = require("../accountOp/accountOp");
const errorHumanizer_1 = require("../errorHumanizer");
function getEstimateGasProps(op, account, accountState) {
    if (accountState.isSmarterEoa) {
        const saAbi = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
        return {
            from: account.addr,
            to: account.addr,
            value: '0x00',
            data: saAbi.encodeFunctionData('executeBySender', [(0, accountOp_1.getSignableCalls)(op)]),
            useStateOverride: false
        };
    }
    // normal EOA: a single call
    const call = op.calls[0];
    return {
        from: account.addr,
        to: call.to,
        value: (0, ethers_1.toBeHex)(call.value),
        data: call.data,
        useStateOverride: false
    };
}
async function providerEstimateGas(account, op, provider, accountState, network, feeTokens) {
    // we don't do estimateGas() for smart accounts
    if ((0, account_1.isSmartAccount)(account))
        return null;
    const feePaymentOptions = [
        {
            paidBy: account.addr,
            availableAmount: accountState.balance,
            addedNative: 0n,
            token: feeTokens.find((token) => token.address === ethers_1.ZeroAddress && !token.flags.onGasTank),
            gasUsed: 0n
        }
    ];
    const properties = getEstimateGasProps(op, account, accountState);
    const txnParams = {
        from: properties.from,
        to: properties.to,
        value: (0, ethers_1.toQuantity)(properties.value),
        data: properties.data,
        nonce: (0, ethers_1.toQuantity)(accountState.eoaNonce)
    };
    const blockTag = 'pending';
    const stateOverride = {
        [deploy_1.DEPLOYLESS_SIMULATION_FROM]: {
            balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
        }
    };
    const params = properties.useStateOverride && !network.rpcNoStateOverride
        ? [txnParams, blockTag, stateOverride]
        : [txnParams, blockTag];
    const gasUsed = await provider
        .send('eth_estimateGas', params)
        .catch(errorHumanizer_1.getHumanReadableEstimationError);
    if (gasUsed instanceof Error)
        return gasUsed;
    return {
        gasUsed: BigInt(gasUsed),
        feePaymentOptions
    };
}
//# sourceMappingURL=providerEstimateGas.js.map