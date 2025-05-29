"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeBatchedFetch = executeBatchedFetch;
exports.resolveAssetInfo = resolveAssetInfo;
const portfolio_1 = require("../../libs/portfolio");
const provider_1 = require("../provider");
const RANDOM_ADDRESS = '0x0000000000000000000000000000000000000001';
const scheduledActions = {};
async function executeBatchedFetch(network) {
    const rpcUrl = network.selectedRpcUrl || network.rpcUrls[0];
    const provider = (0, provider_1.getRpcProvider)([rpcUrl], network.chainId);
    const allAddresses = Array.from(new Set(scheduledActions[network.chainId.toString()]?.data.map((i) => i.address))) ||
        [];
    const portfolio = new portfolio_1.Portfolio(fetch, provider, network);
    const options = {
        disableAutoDiscovery: true,
        additionalErc20Hints: allAddresses,
        additionalErc721Hints: Object.fromEntries(allAddresses.map((i) => [
            i,
            {
                tokens: ['1'],
                isKnown: false
            }
        ]))
    };
    const portfolioResponse = await portfolio.get(RANDOM_ADDRESS, options);
    scheduledActions[network.chainId.toString()]?.data.forEach((i) => {
        const tokenInfo = (i.address,
            portfolioResponse.tokens.find((t) => t.address.toLocaleLowerCase() === i.address.toLowerCase()));
        const nftInfo = (i.address,
            portfolioResponse.collections.find((t) => t.address.toLocaleLowerCase() === i.address.toLowerCase()));
        i.callback({ tokenInfo, nftInfo });
    });
}
/**
 * Resolves symbol and decimals for tokens or name for nfts.
 */
async function resolveAssetInfo(address, network, callback) {
    if (!scheduledActions[network.chainId.toString()]?.data?.length) {
        scheduledActions[network.chainId.toString()] = {
            promise: new Promise((resolve, reject) => {
                setTimeout(async () => {
                    await executeBatchedFetch(network).catch(reject);
                    scheduledActions[network.chainId.toString()] = undefined;
                    resolve(0);
                }, 500);
            }),
            data: [{ address, callback }]
        };
    }
    else {
        scheduledActions[network.chainId.toString()]?.data.push({ address, callback });
    }
    // we are returning a promise so we can await the full execution
    return scheduledActions[network.chainId.toString()]?.promise;
}
//# sourceMappingURL=assetInfo.js.map