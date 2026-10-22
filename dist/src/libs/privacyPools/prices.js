"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchPrivacyPoolsPrices = exports.getPrivacyPoolsValuePerChain = exports.getPrivacyPoolsPriceKey = void 0;
const ethers_1 = require("ethers");
const privacyPools_1 = require("../../consts/privacyPools");
const PRICES_API_URL = 'https://cena.ambire.com/api/v3/simple';
const NO_PRICES = {};
/** How a price is keyed: `${chainId}:${tokenAddress}`, the address lowercase, native as zero. */
const getPrivacyPoolsPriceKey = (chainId, tokenAddress) => `${chainId.toString()}:${tokenAddress.toLowerCase()}`;
exports.getPrivacyPoolsPriceKey = getPrivacyPoolsPriceKey;
/**
 * USD value per chain of the balances, the pending part included, as the account holds it. An
 * unpriced token adds nothing rather than making the chain's value unknown.
 */
const getPrivacyPoolsValuePerChain = (balances, prices) => Object.fromEntries(Object.entries(balances).map(([chainId, chainBalances]) => [
    chainId,
    chainBalances.reduce((total, balance) => {
        const price = prices[(0, exports.getPrivacyPoolsPriceKey)(chainId, balance.tokenAddress)];
        if (price === undefined)
            return total;
        return total + Number((0, ethers_1.formatUnits)(balance.totalAmount, balance.decimals)) * price;
    }, 0)
]));
exports.getPrivacyPoolsValuePerChain = getPrivacyPoolsValuePerChain;
/**
 * USD prices of every asset the pools accept on the given networks. Asks for all of them, not only
 * the held ones, so the request reveals nothing about the account. Unpriced assets are left out.
 */
const fetchPrivacyPoolsPrices = async ({ fetch, networks }) => {
    const prices = {};
    await Promise.all(networks.map(async (network) => {
        const config = (0, privacyPools_1.getPrivacyPoolsChainConfig)(network.chainId);
        if (!config)
            return;
        const nativeAsset = config.assets.find(({ isNative }) => isNative);
        const tokens = config.assets.filter(({ isNative }) => !isNative);
        const [nativePrices, tokenPrices] = await Promise.all([
            nativeAsset && network.nativeAssetId
                ? fetchJson(fetch, `${PRICES_API_URL}/price?ids=${network.nativeAssetId}&vs_currencies=usd`)
                : NO_PRICES,
            tokens.length && network.platformId
                ? fetchJson(fetch, `${PRICES_API_URL}/token_price/${network.platformId}?contract_addresses=${tokens
                    .map(({ address }) => address.toLowerCase())
                    .join(',')}&vs_currencies=usd`)
                : NO_PRICES
        ]);
        const nativePrice = nativePrices[network.nativeAssetId]?.usd;
        if (nativeAsset && typeof nativePrice === 'number')
            prices[(0, exports.getPrivacyPoolsPriceKey)(network.chainId, nativeAsset.address)] = nativePrice;
        tokens.forEach(({ address }) => {
            const price = tokenPrices[address.toLowerCase()]?.usd;
            if (typeof price === 'number')
                prices[(0, exports.getPrivacyPoolsPriceKey)(network.chainId, address)] = price;
        });
    }));
    return prices;
};
exports.fetchPrivacyPoolsPrices = fetchPrivacyPoolsPrices;
const fetchJson = async (fetch, url) => {
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`privacyPools: price request failed with ${response.status}`);
    return response.json();
};
//# sourceMappingURL=prices.js.map