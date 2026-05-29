"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Portfolio = exports.getEmptyHints = exports.PORTFOLIO_LIB_ERROR_NAMES = exports.LIMITS = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const viem_1 = require("viem");
const BalanceGetter_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/BalanceGetter.json"));
const NFTGetter_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/NFTGetter.json"));
const gasTankFeeTokens_1 = tslib_1.__importDefault(require("../../consts/gasTankFeeTokens"));
const pinnedTokens_1 = require("../../consts/pinnedTokens");
const deployless_1 = require("../deployless/deployless");
const batcher_1 = tslib_1.__importDefault(require("./batcher"));
const blacklist_1 = require("./blacklist");
const gecko_1 = require("./gecko");
const getOnchainBalances_1 = require("./getOnchainBalances");
const helpers_1 = require("./helpers");
const pagination_1 = require("./pagination");
exports.LIMITS = {
    // we have to be conservative with erc721Tokens because if we pass 30x20 (worst case) tokenIds, that's 30x20 extra words which is 19kb
    // proxy mode input is limited to 24kb
    deploylessProxyMode: {
        erc20: 66,
        erc20Simulation: 50,
        erc721: 30,
        erc721TokensInput: 20,
        erc721Tokens: 50
    },
    // theoretical capacity is 1666/450
    deploylessStateOverrideMode: {
        erc20: 230,
        erc20Simulation: 50,
        erc721: 70,
        erc721TokensInput: 70,
        erc721Tokens: 70
    }
};
// @TODO: Move this somewhere else
exports.PORTFOLIO_LIB_ERROR_NAMES = {
    /** External hints API (Velcro) request failed but fallback is sufficient */
    NonCriticalApiHintsError: 'NonCriticalApiHintsError',
    /** External API (Velcro) hints are older than X minutes */
    StaleApiHintsError: 'StaleApiHintsError',
    /** No external API (Velcro) hints are available- the request failed without fallback */
    NoApiHintsError: 'NoApiHintsError',
    /** One or more cena request has failed */
    PriceFetchError: 'PriceFetchError',
    /** Defi discovery failed */
    DefiDiscoveryError: 'DefiDiscoveryError'
};
const getEmptyHints = () => ({
    erc20s: [],
    erc721s: {},
    externalApi: undefined
});
exports.getEmptyHints = getEmptyHints;
const defaultOptions = {
    baseCurrency: 'usd',
    blockTag: 'latest',
    tokenDataRecency: 0,
    fetchPinned: true,
    tokenDataRecencyOnFailure: 1 * 60 * 60 * 1000 // 1 hour
};
class Portfolio {
    network;
    provider;
    batchedVelcroDiscovery;
    batchedGecko;
    deploylessTokens;
    deploylessNfts;
    constructor(fetch, provider, network, velcroUrl, customBatcher) {
        if (customBatcher) {
            this.batchedVelcroDiscovery = customBatcher;
        }
        else {
            this.batchedVelcroDiscovery = (0, batcher_1.default)(fetch, (queue) => {
                const baseCurrencies = [...new Set(queue.map((x) => x.data.baseCurrency))];
                return baseCurrencies.map((baseCurrency) => {
                    const queueSegment = queue.filter((x) => x.data.baseCurrency === baseCurrency);
                    const url = `${velcroUrl}/multi-hints?networks=${queueSegment
                        .map((x) => x.data.chainId)
                        .join(',')}&accounts=${queueSegment
                        .map((x) => x.data.accountAddr)
                        .join(',')}&baseCurrency=${baseCurrency}`;
                    return { queueSegment, url };
                });
            }, {
                timeoutSettings: {
                    timeoutAfter: 3000,
                    timeoutErrorMessage: `Velcro discovery timed out on ${network.name}`
                },
                dedupeByKeys: ['chainId', 'accountAddr']
            });
        }
        this.batchedGecko = (0, batcher_1.default)(fetch, gecko_1.geckoRequestBatcher, {
            timeoutSettings: {
                timeoutAfter: 3000,
                timeoutErrorMessage: `Cena request timed out on ${network.name}`
            }
        });
        this.provider = provider;
        this.network = network;
        this.deploylessTokens = (0, deployless_1.fromDescriptor)(provider, BalanceGetter_json_1.default, !network.rpcNoStateOverride);
        this.deploylessNfts = (0, deployless_1.fromDescriptor)(provider, NFTGetter_json_1.default, !network.rpcNoStateOverride);
    }
    /**
     * Fetch the hints from the external API (Velcro).
     * Main return cases:
     * - hints with `externalApi` property set if the hints are coming from the external API (and not from storage)
     * - empty hints if the hints are static and were learned less than X minutes ago. The goal is to reduce
     * unnecessary requests to deployless. Once every X minutes we make a call to Velcro, get the static hints and
     * learn the tokens with amount. In subsequent calls, we return empty hints and the portfolio lib uses the previously learned tokens.
     */
    async externalHintsAPIDiscovery(options) {
        const { disableAutoDiscovery = false, chainId, accountAddr, baseCurrency } = options || {};
        let hints = (0, exports.getEmptyHints)();
        try {
            // Fetch the latest hints from the external API (Velcro)
            if (!disableAutoDiscovery) {
                const hintsFromExternalAPI = await this.batchedVelcroDiscovery({
                    chainId,
                    accountAddr,
                    baseCurrency
                });
                if (hintsFromExternalAPI) {
                    const formatted = (0, helpers_1.formatExternalHintsAPIResponse)(hintsFromExternalAPI);
                    if (formatted) {
                        hints = formatted;
                        // Attach the property as the hints are coming from the external API
                        hints.externalApi = {
                            lastUpdate: Date.now(),
                            prices: hintsFromExternalAPI.prices,
                            hasHints: !!hintsFromExternalAPI.hasHints
                        };
                    }
                }
            }
            return {
                hints
            };
        }
        catch (error) {
            console.error('Portfolio.externalHintsAPIDiscovery error:', error);
            return {
                hints,
                error: {
                    name: exports.PORTFOLIO_LIB_ERROR_NAMES.NoApiHintsError,
                    message: error?.message || 'Unknown error',
                    level: 'warning'
                }
            };
        }
    }
    async get(accountAddr, opts = {}) {
        const errors = [];
        const { simulation, disableAutoDiscovery = false, baseCurrency, fetchPinned, additionalErc20Hints, additionalErc721Hints, specialErc20Hints, specialErc721Hints, blockTag, tokenDataRecencyOnFailure, tokenDataCache: paramsTokenDataCache, tokenDataRecency, blacklist, preventTokenBlacklisting } = { ...defaultOptions, ...opts };
        const toBeLearned = {
            erc20s: [],
            erc721s: {}
        };
        if (simulation && simulation.baseAccount.getAccount().addr !== accountAddr)
            throw new Error('wrong account passed');
        const start = Date.now();
        const chainId = this.network.chainId;
        const { hints, error: hintsError } = await this.externalHintsAPIDiscovery({
            disableAutoDiscovery,
            chainId,
            accountAddr,
            baseCurrency
        });
        if (hintsError)
            errors.push(hintsError);
        hints.erc20s = [
            ...hints.erc20s,
            ...Object.values(specialErc20Hints || {}).flat(),
            ...(additionalErc20Hints || []),
            ...(fetchPinned ? pinnedTokens_1.PINNED_TOKENS.map((x) => x.address) : []),
            // add the fee tokens
            ...gasTankFeeTokens_1.default.filter((x) => x.chainId === this.network.chainId).map((x) => x.address)
        ];
        hints.erc721s = (0, helpers_1.mergeERC721s)([
            additionalErc721Hints || {},
            hints.erc721s,
            ...Object.values(specialErc721Hints || {})
        ]);
        const checksummedErc20Hints = hints.erc20s
            .map((address) => {
            try {
                // getAddress may throw an error. This will break the portfolio
                // if the error isn't caught
                return (0, viem_1.getAddress)(address);
            }
            catch {
                return null;
            }
        })
            .filter(Boolean);
        // Merge static and dynamic blacklisted addresses for this chain
        const chainIdStr = this.network.chainId.toString();
        const staticBlacklistedAddrs = blacklist_1.STATIC_BLACKLIST.blacklistAddrs[chainIdStr] || [];
        const dynamicBlacklistedAddrs = blacklist?.blacklistAddrs[chainIdStr] || [];
        const allBlacklistedAddrs = new Set([...staticBlacklistedAddrs, ...dynamicBlacklistedAddrs]);
        const filteredChecksummedHints = preventTokenBlacklisting
            ? checksummedErc20Hints
            : checksummedErc20Hints.filter((addr) => !allBlacklistedAddrs.has(addr));
        // Remove duplicates and always add ZeroAddress
        hints.erc20s = [...new Set(filteredChecksummedHints.concat(ethers_1.ZeroAddress))];
        const tokenDataCache = paramsTokenDataCache || new Map();
        for (const addr in hints.externalApi?.prices || {}) {
            const tokenDataHint = (0, helpers_1.convertApiTokenDataToTokenDataCache)(hints.externalApi?.prices[addr] || null);
            if (!tokenDataHint)
                continue;
            tokenDataCache.set(addr, [start, tokenDataHint]);
        }
        const discoveryDone = Date.now();
        // .isLimitedAt24kbData should be the same for both instances; @TODO more elegant check?
        const limits = this.deploylessTokens.isLimitedAt24kbData
            ? exports.LIMITS.deploylessProxyMode
            : exports.LIMITS.deploylessStateOverrideMode;
        const collectionsHints = Object.entries(hints.erc721s);
        const [tokensWithErr, collectionsWithErr] = await Promise.all([
            (0, pagination_1.flattenResults)((0, pagination_1.paginate)(hints.erc20s, opts.simulation ? limits.erc20Simulation : limits.erc20).map((page, index) => (0, getOnchainBalances_1.getTokens)(this.network, this.deploylessTokens, { simulation, blockTag, specialErc20Hints }, accountAddr, page, index))),
            (0, pagination_1.flattenResults)((0, pagination_1.paginate)(collectionsHints, limits.erc721).map((page) => (0, getOnchainBalances_1.getNFTs)(this.network, this.deploylessNfts, { simulation, blockTag }, accountAddr, page, limits)))
        ]);
        const [tokensWithErrResult, metaData] = tokensWithErr;
        const { blockNumber, beforeNonce, afterNonce } = metaData;
        const [collectionsWithErrResult] = collectionsWithErr;
        // Re-map/filter into our format
        const getTokenDataFromCache = (address, _tokenDataRecency = tokenDataRecency) => {
            // hardcode citrea prices
            if (this.network.chainId === 4114n) {
                const citreaTokenPrice = (0, helpers_1.getHardcodedCitreaPrices)(address);
                if (citreaTokenPrice)
                    return {
                        marketDataIn: [],
                        priceIn: [citreaTokenPrice]
                    };
            }
            const cached = tokenDataCache.get(address);
            if (!cached)
                return null;
            const [timestamp, entry] = cached;
            const eligible = entry.priceIn.find((p) => p.baseCurrency === baseCurrency);
            if (!eligible)
                return null;
            // by using `start` instead of `Date.now()`, we make sure that prices updated from Velcro will not be updated again
            // even if priceRecency is 0
            const isStale = start - timestamp > _tokenDataRecency;
            return isStale ? null : entry;
        };
        const nativeToken = tokensWithErrResult.find(([, result]) => result.address === ethers_1.ZeroAddress)?.[1];
        const isValidToken = (error, token) => error === '0x' && !!token.symbol;
        const allBlacklistedSymbols = [
            ...blacklist_1.STATIC_BLACKLIST.blacklistBySymbols,
            ...(blacklist?.blacklistBySymbols || [])
        ].map((p) => p.toLowerCase());
        const tokensWithoutPrices = tokensWithErrResult
            .filter((_tokensWithErrResult) => {
            if (!isValidToken(_tokensWithErrResult[0], _tokensWithErrResult[1]))
                return false;
            // Symbol-based blacklist: skip custom tokens so user-added assets are never hidden
            if (allBlacklistedSymbols.length > 0 && !_tokensWithErrResult[1]?.flags?.isCustom) {
                const symbolLower = _tokensWithErrResult[1].symbol.toLowerCase();
                if (allBlacklistedSymbols.some((pattern) => symbolLower.includes(pattern)))
                    return false;
            }
            // Don't filter by balance/custom/hidden etc. if this param isn't passed
            // The portfolio lib is used outside the controller, in which case we want to
            // fetch all tokens regardless of their balance or type
            if (!specialErc20Hints)
                return true;
            // To be learned tokens are never filtered out to ensure that
            // the humanizer, simulation and etc. work even if the account doesn't have amount
            // on either block (latest/pending)
            const isToBeLearned = specialErc20Hints.learn.includes(_tokensWithErrResult[1].address);
            return (0, helpers_1.tokenFilter)(_tokensWithErrResult[1], this.network, isToBeLearned, !!fetchPinned, nativeToken);
        })
            .map(([, result]) => {
            if (result.amount &&
                !result.flags.isCustom &&
                !result.flags.isHidden &&
                !toBeLearned.erc20s.includes(result.address)) {
                // Add all non-zero tokens to toBeLearned
                toBeLearned.erc20s.push(result.address);
            }
            return result;
        });
        const collections = collectionsWithErrResult.reduce((acc, [error, collection]) => {
            if (!isValidToken(error, collection))
                return acc;
            // Never filter custom collections, even tho we don't support them atm
            if (allBlacklistedSymbols.length > 0 && !collection?.flags?.isCustom) {
                const symbolLower = collection.symbol.toLowerCase();
                if (allBlacklistedSymbols.some((pattern) => symbolLower.includes(pattern)))
                    return acc;
            }
            // Important note: Collections with 0 collectibles are allow to pass through the filter.
            if (!toBeLearned.erc721s[collection.address] && collection.collectibles.length > 0) {
                toBeLearned.erc721s[collection.address] = collection.collectibles;
            }
            acc.push({
                ...collection,
                priceIn: getTokenDataFromCache(collection.address)?.priceIn || []
            });
            return acc;
        }, []);
        const oracleCallDone = Date.now();
        // Update prices and set the priceIn for each token by reference,
        // updating the final tokens array as a result
        const tokensWithPrices = await Promise.all(tokensWithoutPrices.map(async (token) => {
            let hasPrice = false;
            const cachedTokenData = getTokenDataFromCache(token.address, tokenDataRecencyOnFailure);
            if (cachedTokenData && cachedTokenData.priceIn && cachedTokenData.priceIn.length > 0) {
                hasPrice = true;
                return {
                    ...token,
                    ...cachedTokenData
                };
            }
            if (!this.network.platformId) {
                return {
                    ...token,
                    priceIn: [],
                    marketDataIn: []
                };
            }
            try {
                const tokenData = await this.batchedGecko({
                    ...token,
                    network: this.network,
                    baseCurrency,
                    // this is what to look for in the coingecko response object
                    responseIdentifier: (0, gecko_1.geckoResponseIdentifier)(token.address, this.network)
                });
                const formattedTokenData = (0, helpers_1.convertApiTokenDataToTokenDataCache)(tokenData);
                if (formattedTokenData &&
                    formattedTokenData.priceIn &&
                    formattedTokenData.priceIn.length > 0) {
                    hasPrice = true;
                }
                tokenDataCache.set(token.address, [Date.now(), formattedTokenData]);
                return {
                    ...token,
                    ...formattedTokenData
                };
            }
            catch (error) {
                const errorMessage = error?.message || 'Unknown error';
                const olderCachedTokenData = getTokenDataFromCache(token.address, tokenDataRecencyOnFailure);
                if (olderCachedTokenData &&
                    olderCachedTokenData.priceIn &&
                    olderCachedTokenData.priceIn.length > 0) {
                    hasPrice = true;
                }
                if (
                // Avoid duplicate errors, because this.bachedGecko is called for each token and if
                // there is an error it will most likely be the same for all tokens
                !errors.find((x) => x.name === exports.PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError && x.message === errorMessage) &&
                    // Don't display an error if there is a cached price
                    !hasPrice) {
                    errors.push({
                        name: exports.PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError,
                        message: errorMessage,
                        level: 'warning'
                    });
                }
                return {
                    ...token,
                    priceIn: olderCachedTokenData?.priceIn || [],
                    marketDataIn: olderCachedTokenData?.marketDataIn || []
                };
            }
        }));
        const priceUpdateDone = Date.now();
        return {
            toBeLearned,
            errors,
            updateStarted: start,
            discoveryTime: discoveryDone - start,
            oracleCallTime: oracleCallDone - discoveryDone,
            priceUpdateTime: priceUpdateDone - oracleCallDone,
            tokenDataCache,
            tokens: tokensWithPrices,
            feeTokens: tokensWithPrices.filter((t) => {
                // return the native token
                if (t.address === ethers_1.ZeroAddress && t.chainId === this.network.chainId)
                    return true;
                return gasTankFeeTokens_1.default.find((gasTankT) => gasTankT.address.toLowerCase() === t.address.toLowerCase() &&
                    gasTankT.chainId === t.chainId);
            }),
            beforeNonce,
            afterNonce,
            blockNumber,
            tokenErrors: tokensWithErrResult
                .filter(([error, result]) => !isValidToken(error, result))
                .map(([error, result]) => ({ error, address: result.address })),
            collectionErrors: collectionsWithErrResult
                .filter(([error, result]) => !isValidToken(error, result))
                .map(([error, result]) => ({ error, address: result.address })),
            collections
        };
    }
    async getTokensByAddresses(accountAddr, tokenAddrs, opts) {
        const uniqueTokenAddrs = [...new Set(tokenAddrs)];
        if (!uniqueTokenAddrs.length)
            return [];
        const limits = this.deploylessTokens.isLimitedAt24kbData
            ? exports.LIMITS.deploylessProxyMode
            : exports.LIMITS.deploylessStateOverrideMode;
        const [tokensWithErrResult] = await (0, pagination_1.flattenResults)((0, pagination_1.paginate)(uniqueTokenAddrs, limits.erc20).map((page, index) => (0, getOnchainBalances_1.getTokens)(this.network, this.deploylessTokens, opts, accountAddr, page, index)));
        return tokensWithErrResult.map(([error, token]) => [
            error,
            {
                ...token,
                priceIn: token.priceIn || [],
                marketDataIn: token.marketDataIn || []
            }
        ]);
    }
}
exports.Portfolio = Portfolio;
//# sourceMappingURL=portfolio.js.map