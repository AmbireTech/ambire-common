import { Interface } from 'ethers';
import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json';
import AmbireFactory from '../../../contracts/compiled/AmbireFactory.json';
import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy';
import { getRpcProvider } from '../../services/provider';
import { getSpoof } from '../account/account';
import { getSignableCalls } from '../accountOp/accountOp';
// Use this estimateGas only for SA estimations
export async function estimateGas(account, op, provider, accountState, network) {
    if (network.disableEstimateGas)
        return 0n;
    if (!account.creation)
        throw new Error('Use this estimation only for smart accounts');
    const saAbi = new Interface(AmbireAccount.abi);
    const factoryAbi = new Interface(AmbireFactory.abi);
    const callData = accountState.isDeployed
        ? saAbi.encodeFunctionData('execute', [getSignableCalls(op), getSpoof(account)])
        : factoryAbi.encodeFunctionData('deployAndExecute', [
            account.creation.bytecode,
            account.creation.salt,
            getSignableCalls(op),
            getSpoof(account)
        ]);
    // try estimating the gas without state override. If an error of type
    // insufficient funds is encountered, try re-estimating with state override
    return provider
        .estimateGas({
        from: DEPLOYLESS_SIMULATION_FROM,
        to: accountState.isDeployed ? account.addr : account.creation.factoryAddr,
        value: 0,
        data: callData,
        nonce: 0
    })
        .catch(async (e) => {
        if (!e.message.includes('insufficient funds'))
            return 0n;
        const isolatedProvider = getRpcProvider(network.rpcUrls, network.chainId, network.selectedRpcUrl, { batchMaxCount: 1 });
        const withOverrides = await isolatedProvider
            .send('eth_estimateGas', [
            {
                to: accountState.isDeployed ? account.addr : account.creation.factoryAddr,
                value: '0x0',
                data: callData,
                from: DEPLOYLESS_SIMULATION_FROM,
                nonce: '0x0'
            },
            'latest',
            {
                [DEPLOYLESS_SIMULATION_FROM]: {
                    balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
                }
            }
        ])
            .catch(() => '0x0');
        isolatedProvider.destroy();
        return BigInt(withOverrides);
    });
}
//# sourceMappingURL=estimateGas.js.map