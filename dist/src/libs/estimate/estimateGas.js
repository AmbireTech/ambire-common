"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateGas = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const AmbireFactory_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireFactory.json"));
const deploy_1 = require("../../consts/deploy");
const provider_1 = require("../../services/provider");
const account_1 = require("../account/account");
const accountOp_1 = require("../accountOp/accountOp");
// Use this estimateGas only for SA estimations
async function estimateGas(account, op, provider, accountState, network) {
    if (network.disableEstimateGas)
        return 0n;
    if (!account.creation)
        throw new Error('Use this estimation only for smart accounts');
    const saAbi = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
    const factoryAbi = new ethers_1.Interface(AmbireFactory_json_1.default.abi);
    const callData = accountState.isDeployed
        ? saAbi.encodeFunctionData('execute', [(0, accountOp_1.getSignableCalls)(op), (0, account_1.getSpoof)(account)])
        : factoryAbi.encodeFunctionData('deployAndExecute', [
            account.creation.bytecode,
            account.creation.salt,
            (0, accountOp_1.getSignableCalls)(op),
            (0, account_1.getSpoof)(account)
        ]);
    // try estimating the gas without state override. If an error of type
    // insufficient funds is encountered, try re-estimating with state override
    return provider
        .estimateGas({
        from: deploy_1.DEPLOYLESS_SIMULATION_FROM,
        to: accountState.isDeployed ? account.addr : account.creation.factoryAddr,
        value: 0,
        data: callData,
        nonce: 0
    })
        .catch(async (e) => {
        if (!e.message.includes('insufficient funds'))
            return 0n;
        const isolatedProvider = (0, provider_1.getRpcProvider)(network.rpcUrls, network.chainId, network.selectedRpcUrl, { batchMaxCount: 1 });
        const withOverrides = await isolatedProvider
            .send('eth_estimateGas', [
            {
                to: accountState.isDeployed ? account.addr : account.creation.factoryAddr,
                value: '0x0',
                data: callData,
                from: deploy_1.DEPLOYLESS_SIMULATION_FROM,
                nonce: '0x0'
            },
            'latest',
            {
                [deploy_1.DEPLOYLESS_SIMULATION_FROM]: {
                    balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
                }
            }
        ])
            .catch(() => '0x0');
        isolatedProvider.destroy();
        return BigInt(withOverrides);
    });
}
exports.estimateGas = estimateGas;
//# sourceMappingURL=estimateGas.js.map