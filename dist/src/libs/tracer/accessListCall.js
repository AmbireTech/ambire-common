"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSimulateTxnAccessor = getSimulateTxnAccessor;
exports.getShouldUseAccessListCall = getShouldUseAccessListCall;
exports.getSafeAccessListCallParams = getSafeAccessListCallParams;
exports.parseAccessList = parseAccessList;
exports.sendCreateAccessList = sendCreateAccessList;
exports.createAccessListCall = createAccessListCall;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const deploy_1 = require("../../consts/deploy");
const debugTraceCall_1 = require("./debugTraceCall");
const Safe_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/Safe.json"));
const ProviderError_1 = require("../../classes/ProviderError");
const safe_1 = require("../../consts/safe");
const provider_1 = require("../../services/provider");
const safe_2 = require("../safe/safe");
const safeSimulateTxAccessorAbi = [
    'function simulate(address to, uint256 value, bytes data, uint8 operation)'
];
const safeIface = new ethers_1.Interface(Safe_json_1.default);
const simulateAccessorIface = new ethers_1.Interface(safeSimulateTxAccessorAbi);
function getSimulateTxnAccessor(version) {
    if (!version)
        return null;
    if (version.startsWith('1.3'))
        return safe_1.safeSimulateTxAccessor['v1.3.0'];
    if (version.startsWith('1.4'))
        return safe_1.safeSimulateTxAccessor['v1.4.1'];
    if (version.startsWith('1.5'))
        return safe_1.safeSimulateTxAccessor['v1.5.0'];
    return null;
}
function getShouldUseAccessListCall(account, needsStateOverride) {
    // Use eth_createAccessList for Safe only if we know the
    // simulateTxAccessor for the Safe version (see getSafeAccessListCallParams)
    if (account.safeCreation) {
        return !!getSimulateTxnAccessor(account.safeCreation.version);
    }
    return !needsStateOverride;
}
/**
 * We cannot use execTransaction for the access list call as it would require signatures for the transaction
 * (which we don't have at the point of simulation). Instead, we can use the simulate function of the SimulateTxAccessor contract,
 * which executes the transaction but reverts at the end, allowing us to trace it without needing signatures.
 *
 * The only downside is that there are multiple deployments of the contract, which is not that bad as we
 * can easily select the right one based on the Safe version and fall back to debug_traceCall if the version is not supported
 * All deployments: https://github.com/safe-global/safe-deployments/blob/main/src/deployments.ts
 */
function getSafeAccessListCallParams(baseAcc, op, accountState) {
    const account = baseAcc.getAccount();
    if (!account.safeCreation || !accountState.isDeployed)
        return null;
    if (!op.calls.length)
        return null;
    const { to, value, data, operation } = (0, safe_2.encodeCalls)(op);
    const simulateTxAccessor = getSimulateTxnAccessor(account.safeCreation.version);
    if (!simulateTxAccessor)
        return null;
    const simulatePayload = simulateAccessorIface.encodeFunctionData('simulate', [
        to,
        value,
        data,
        operation
    ]);
    const outerCalldata = safeIface.encodeFunctionData('simulateAndRevert', [
        simulateTxAccessor,
        simulatePayload
    ]);
    return {
        to: account.addr,
        value: 0,
        data: outerCalldata,
        from: deploy_1.DEPLOYLESS_SIMULATION_FROM
    };
}
/**
 * Parses an access list and extracts unique contract addresses
 */
function parseAccessList(accessList) {
    if (!accessList || accessList.length === 0) {
        return [];
    }
    // Extract and deduplicate addresses
    const uniqueAddresses = new Set();
    accessList.forEach(({ address }) => {
        try {
            // Normalize the address using getAddress (checksum)
            const normalized = (0, ethers_1.getAddress)(address);
            uniqueAddresses.add(normalized);
        }
        catch (e) {
            // Skip invalid addresses
        }
    });
    return Array.from(uniqueAddresses);
}
async function sendCreateAccessList(provider, params, network, 
/**
 * State override was added in 2025 but is not yet widely supported, so it shouldn't be used
 * https://github.com/ethereum/go-ethereum/issues/27630
 */
stateOverride) {
    if (stateOverride) {
        console.error('Debug: Attempting to use state override with eth_createAccessList, which may not be supported by all RPC providers');
    }
    const requestParams = [
        {
            to: params.to,
            value: (0, ethers_1.toQuantity)(params.value.toString()),
            data: params.data,
            from: params.from
        },
        'latest'
    ];
    if (!network.rpcNoStateOverride && stateOverride) {
        try {
            return await provider.send('eth_createAccessList', [
                ...requestParams,
                {
                    ...stateOverride,
                    [params.from]: {
                        balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
                        ...(stateOverride[params.from] || {})
                    }
                }
            ]);
        }
        catch (e) {
            // Fall back to standard two-param call for RPCs that reject state override on eth_createAccessList.
        }
    }
    return provider.send('eth_createAccessList', requestParams);
}
/**
 * Uses eth_createAccessList to discover contract addresses accessed during transaction execution.
 * Traces all calls in the AccountOp and merges the discovered addresses.
 */
async function createAccessListCall(baseAcc, op, network, accountState) {
    const account = baseAcc.getAccount();
    const params = account.safeCreation && accountState.isDeployed
        ? getSafeAccessListCallParams(baseAcc, op, accountState)
        : (0, debugTraceCall_1.getFunctionParams)(account, op, accountState);
    if (!params || !params.to || typeof params.to !== 'string')
        return [];
    // Initialize a new provider for eth_createAccessList
    // Using separate provider to avoid batching issues that can impact performance
    const provider = (0, provider_1.getRpcProvider)(network.rpcUrls, network.chainId, network.selectedRpcUrl);
    try {
        const response = await sendCreateAccessList(provider, {
            ...params,
            // There is an `if` above
            to: params.to
        }, network);
        const returned = parseAccessList(response.accessList);
        return returned;
    }
    catch (e) {
        console.error('Debug: eth_createAccessList error', e);
        throw new ProviderError_1.ProviderError({ originalError: e, providerUrl: provider._getConnection()?.url });
    }
    finally {
        // Clean up the provider after usage
        try {
            provider.destroy();
        }
        catch (e) {
            console.error(e);
        }
    }
}
//# sourceMappingURL=accessListCall.js.map