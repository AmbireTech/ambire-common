"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCoinGeckoTokenUrl = exports.getCoinGeckoTokenApiUrl = exports.geckoTokenAddressMapper = exports.geckoIdMapper = void 0;
const ethers_1 = require("ethers");
const addresses_1 = require("./addresses");
const COINGECKO_API_BASE_URL = 'https://api.coingecko.com/api/v3/coins/';
const COINGECKO_BASE_URL = 'https://www.coingecko.com/en/coins/';
// @TODO some form of a constants list
function geckoIdMapper(address, network) {
    if (address === ethers_1.ZeroAddress)
        return network.nativeAssetId;
    // we currently can't map aave so we're leaving this
    if (address === '0x4da27a545c0c5B758a6BA100e3a049001de870f5')
        return 'aave';
    return null;
}
exports.geckoIdMapper = geckoIdMapper;
/**
 * Maps specific token addresses to alternative addresses if they are missing on
 * CoinGecko (so that they are aliased to existing tokens).
 */
function geckoTokenAddressMapper(address) {
    // xWALLET is missing on CoinGecko, so alias it to WALLET token (that exists on CoinGecko)
    if (address === addresses_1.WALLET_STAKING_ADDR)
        return addresses_1.WALLET_TOKEN;
    return address;
}
exports.geckoTokenAddressMapper = geckoTokenAddressMapper;
/**
 * Constructs the CoinGecko API URL for a given token address and network ID.
 * Handles special cases where the CoinGecko API handles differently certain
 * tokens like the native tokens.
 */
function getCoinGeckoTokenApiUrl({ tokenAddr, geckoChainId, geckoNativeCoinId }) {
    // CoinGecko does not handle native assets (ETH, MATIC, BNB...) via the /contract endpoint.
    // Instead, native assets are identified by URL with the `nativeAssetId` directly.
    if (tokenAddr === ethers_1.ZeroAddress)
        return `${COINGECKO_API_BASE_URL}${geckoNativeCoinId}`;
    const geckoTokenAddress = geckoTokenAddressMapper(tokenAddr);
    return `${COINGECKO_API_BASE_URL}${geckoChainId}/contract/${geckoTokenAddress}`;
}
exports.getCoinGeckoTokenApiUrl = getCoinGeckoTokenApiUrl;
/** Constructs the CoinGecko URL for a given token slug. */
const getCoinGeckoTokenUrl = (slug) => `${COINGECKO_BASE_URL}${slug}`;
exports.getCoinGeckoTokenUrl = getCoinGeckoTokenUrl;
//# sourceMappingURL=coingecko.js.map