"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCoinGeckoTokenUrl = void 0;
exports.geckoIdMapper = geckoIdMapper;
exports.geckoTokenAddressMapper = geckoTokenAddressMapper;
exports.getCoinGeckoTokenApiUrl = getCoinGeckoTokenApiUrl;
const ethers_1 = require("ethers");
const addresses_1 = require("./addresses");
const COINGECKO_API_BASE_URL = 'https://api.coingecko.com/api/v3/coins/';
const COINGECKO_BASE_URL = 'https://www.coingecko.com/en/coins/';
// @TODO some form of a constants list
function geckoIdMapper(address, network) {
    if (address === ethers_1.ZeroAddress)
        return network.nativeAssetId;
    // citrea wrapepd cbtc
    if (network.chainId === 4114n && address === '0x3100000000000000000000000000000000000006')
        return network.nativeAssetId;
    // citrea wbtc
    if (network.chainId === 4114n && address === '0xDF240DC08B0FdaD1d93b74d5048871232f6BEA3d')
        return 'wrapped-bitcoin';
    // we currently can't map aave so we're leaving this
    if (address === '0x4da27a545c0c5B758a6BA100e3a049001de870f5')
        return 'aave';
    return null;
}
/**
 * Maps specific token addresses to alternative addresses if they are missing on
 * CoinGecko (so that they are aliased to existing tokens).
 */
function geckoTokenAddressMapper(address) {
    // stkWALLET and xWALLET are missing on CoinGecko, so alias to WALLET token (which exists)
    if ([addresses_1.STK_WALLET, addresses_1.WALLET_STAKING_ADDR].includes(address))
        return addresses_1.WALLET_TOKEN;
    return address;
}
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
/** Constructs the CoinGecko URL for a given token slug. */
const getCoinGeckoTokenUrl = (slug) => `${COINGECKO_BASE_URL}${slug}`;
exports.getCoinGeckoTokenUrl = getCoinGeckoTokenUrl;
//# sourceMappingURL=coingecko.js.map