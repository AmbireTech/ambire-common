"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseEthSimulateV1Result = parseEthSimulateV1Result;
exports.getEthSimulateV1Params = getEthSimulateV1Params;
exports.ethSimulateV1 = ethSimulateV1;
const ethers_1 = require("ethers");
const ProviderError_1 = require("../../classes/ProviderError");
const provider_1 = require("../../services/provider");
const accountOp_1 = require("../accountOp/accountOp");
const debugTraceCall_1 = require("./debugTraceCall");
const SIMULATION_BALANCE = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
function parseEthSimulateV1Result(result, callTo) {
    const callTargets = (Array.isArray(callTo) ? callTo : [callTo]).filter(Boolean);
    return (0, debugTraceCall_1.parseCallTracerResult)({
        calls: [
            ...callTargets.map((to) => ({ to })),
            ...(result?.flatMap((block) => block.calls?.map((call) => ({ logs: call.logs })) || []) || [])
        ]
    });
}
function getEthSimulateV1Params(op) {
    const calls = (0, accountOp_1.getSignableCalls)(op).map(([to, value, data]) => ({
        ...(to ? { to } : {}),
        value: (0, ethers_1.toQuantity)(value),
        data,
        from: op.accountAddr
    }));
    return {
        callTargets: (0, accountOp_1.getSignableCalls)(op)
            .map(([to]) => to)
            .filter(Boolean),
        params: [
            {
                blockStateCalls: [
                    {
                        stateOverrides: {
                            [op.accountAddr]: {
                                balance: SIMULATION_BALANCE
                            }
                        },
                        calls
                    }
                ],
                validation: false
            },
            'latest'
        ]
    };
}
async function ethSimulateV1(baseAcc, op, network, accountState) {
    const ethSimulateV1Params = getEthSimulateV1Params(op);
    if (!ethSimulateV1Params)
        return { tokens: [], nfts: [] };
    const provider = (0, provider_1.getRpcProvider)(network.rpcUrls, network.chainId, network.selectedRpcUrl);
    try {
        const response = await provider.send('eth_simulateV1', ethSimulateV1Params.params);
        const { tokens: foundTokens, nfts: foundNftTransfers } = parseEthSimulateV1Result(response, ethSimulateV1Params.callTargets);
        return await (0, debugTraceCall_1.getDiscoveredAssets)(provider, baseAcc, op, network, accountState, foundTokens, foundNftTransfers);
    }
    catch (e) {
        throw new ProviderError_1.ProviderError({ originalError: e, providerUrl: provider._getConnection()?.url });
    }
    finally {
        try {
            provider.destroy();
        }
        catch (e) {
            console.error(e);
        }
    }
}
//# sourceMappingURL=ethSimulatev1.js.map