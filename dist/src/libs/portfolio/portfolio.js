"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Portfolio = exports.getEmptyHints = exports.PORTFOLIO_LIB_ERROR_NAMES = exports.LIMITS = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const viem_1 = require("viem");
const tokenProcessing_1 = require("./tokenProcessing");
const BalanceGetter_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/BalanceGetter.json"));
const NFTGetter_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/NFTGetter.json"));
const gasTankFeeTokens_1 = tslib_1.__importDefault(require("../../consts/gasTankFeeTokens"));
const pinnedTokens_1 = require("../../consts/pinnedTokens");
const portfolio_1 = require("../../consts/portfolio");
const batcher_1 = tslib_1.__importDefault(require("../../utils/batcher"));
const paginate_1 = require("../../utils/paginate");
const deployless_1 = require("../deployless/deployless");
const blacklist_1 = require("./blacklist");
const debug_1 = require("./debug");
const errorNames_1 = require("./errorNames");
Object.defineProperty(exports, "PORTFOLIO_LIB_ERROR_NAMES", { enumerable: true, get: function () { return errorNames_1.PORTFOLIO_LIB_ERROR_NAMES; } });
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
    isTokenPricesEnabled;
    deploylessTokens;
    deploylessNfts;
    constructor(fetch, provider, network, velcroUrl, customBatcher, isTokenPricesEnabled = () => true) {
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
                timeoutAfter: portfolio_1.AMBIRE_API_TIMEOUT,
                timeoutErrorMessage: `Cena request timed out on ${network.name}`
            }
        });
        this.provider = provider;
        this.network = network;
        this.isTokenPricesEnabled = isTokenPricesEnabled;
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
                    name: errorNames_1.PORTFOLIO_LIB_ERROR_NAMES.NoApiHintsError,
                    message: error?.message || 'Unknown error',
                    level: 'warning'
                }
            };
        }
    }
    async get(accountAddr, opts = {}) {
        const errors = [];
        const { simulation, disableAutoDiscovery = false, baseCurrency, fetchPinned, additionalErc20Hints, additionalErc721Hints, specialErc20Hints, specialErc721Hints, blockTag, tokenDataRecencyOnFailure, tokenDataCache: paramsTokenDataCache, tokenDataRecency, blacklist, preventTokenBlacklisting, deployless, knownTokenMetadata, knownCollectionMetadata } = { ...defaultOptions, ...opts };
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
        // Taken before the merge, which folds the custom ids in. The learned assets
        // are left out on purpose: adding a collectible also asks for it to be
        // learned, so they would report every custom collection as discovered.
        const discoveredCollections = new Set([...Object.keys(hints.erc721s), ...Object.keys(additionalErc721Hints || {})].map((address) => address.toLowerCase()));
        hints.erc721s = (0, helpers_1.mergeCollectionHints)({
            additionalHints: additionalErc721Hints,
            apiHints: hints.erc721s,
            specialHints: specialErc721Hints
        });
        // Deduped before checksumming for performance
        const seenErc20Hints = new Set();
        const checksummedErc20Hints = [];
        hints.erc20s.forEach((address) => {
            try {
                const lowercasedAddress = address.toLowerCase();
                if (seenErc20Hints.has(lowercasedAddress))
                    return;
                // getAddress may throw an error. This will break the portfolio
                // if the error isn't caught
                const checksummedAddress = (0, viem_1.getAddress)(address);
                seenErc20Hints.add(lowercasedAddress);
                checksummedErc20Hints.push(checksummedAddress);
            }
            catch {
                // Not an address, so it can't be a token
            }
        });
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
            tokenDataCache.set((0, helpers_1.getTokenDataCacheKey)(addr), [start, tokenDataHint]);
        }
        const collectionsHints = Object.entries(hints.erc721s);
        // Decided once for the whole update so that every page agrees on which assets
        // must be read in full, and so the freshly read ones can be reported back. With
        // nothing held, everything is read from the chain and nothing is reported back.
        const metadataPlan = (0, helpers_1.planAssetMetadata)(hints.erc20s, knownTokenMetadata, start);
        const collectionMetadataPlan = (0, helpers_1.planAssetMetadata)(Object.keys(hints.erc721s), knownCollectionMetadata, start);
        const discoveryDone = Date.now();
        // .isLimitedAt24kbData should be the same for both instances; @TODO more elegant check?
        const limits = this.deploylessTokens.isLimitedAt24kbData
            ? exports.LIMITS.deploylessProxyMode
            : exports.LIMITS.deploylessStateOverrideMode;
        const [tokensWithErr, collectionsWithErr] = await Promise.all([
            (0, pagination_1.flattenResults)((0, paginate_1.paginate)(hints.erc20s, opts.simulation ? limits.erc20Simulation : limits.erc20).map((page) => (0, getOnchainBalances_1.getTokens)(this.network, this.deploylessTokens, { simulation, blockTag, specialErc20Hints, deployless, metadataPlan }, accountAddr, page))),
            (0, pagination_1.flattenResults)((0, paginate_1.paginate)(collectionsHints, limits.erc721).map((page) => (0, getOnchainBalances_1.getNFTs)(this.network, this.deploylessNfts, { simulation, blockTag, deployless, metadataPlan: collectionMetadataPlan }, accountAddr, page, limits)))
        ]);
        const [tokensWithErrResult, metaData] = tokensWithErr;
        const { blockNumber, beforeNonce, afterNonce } = metaData;
        const [collectionsWithErrResult] = collectionsWithErr;
        const fetchedTokenMetadata = [];
        const fetchedCollectionMetadata = [];
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
            const cached = tokenDataCache.get((0, helpers_1.getTokenDataCacheKey)(address));
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
        // name() and symbol() belong to the optional ERC721Metadata extension, so a
        // collection without them is still a collection - the ENS registrar is one.
        // Only the getter erroring says an address holds no collection, and it does
        // error for one that doesn't.
        const isValidCollection = (error) => error === '0x';
        const blacklistPatterns = (0, blacklist_1.prepareBlacklistPatterns)([
            ...blacklist_1.STATIC_BLACKLIST.blacklistBySymbols,
            ...(blacklist?.blacklistBySymbols || [])
        ]);
        const tokensWithoutPrices = tokensWithErrResult
            .filter((_tokensWithErrResult) => {
            if (!isValidToken(_tokensWithErrResult[0], _tokensWithErrResult[1]))
                return false;
            const token = _tokensWithErrResult[1];
            // Kept before any of the filtering below, so metadata read for a token the
            // user never sees is not read again on the next update.
            if (knownTokenMetadata && metadataPlan.needsMetadata.has(token.address)) {
                fetchedTokenMetadata.push([
                    token.address,
                    {
                        symbol: token.symbol,
                        name: token.name,
                        decimals: token.decimals,
                        fetchedAt: start
                    }
                ]);
            }
            // Spam filter: hide tokens whose symbol/name matches a blacklisted
            // pattern. Custom (user-added) tokens are never hidden. We don't run the
            // embedded-domain check here because token names/symbols legitimately contain domains.
            if ((0, blacklist_1.isBlacklistedAsset)({
                symbol: token.symbol,
                name: token.name,
                isCustom: token.flags?.isCustom,
                patterns: blacklistPatterns
            })) {
                (0, debug_1.portfolioDebugLog)('blacklist', `${this.network.chainId.toString()}: Filtered token ${token.symbol}`, {
                    address: token.address,
                    symbol: token.symbol,
                    name: token.name
                });
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
        // Unlike the deployless ones, preference addresses aren't always checksummed.
        // An empty array of ids means the collection was added before they were
        // recorded, otherwise the listed collectibles are the added ones
        const customCollectibles = {};
        Object.entries(specialErc721Hints?.custom || {}).forEach(([address, ids]) => {
            customCollectibles[address.toLowerCase()] = ids;
        });
        // An empty array of ids hides the whole collection, otherwise the listed
        // collectibles are the hidden ones
        const hiddenCollectibles = {};
        Object.entries(specialErc721Hints?.hidden || {}).forEach(([address, ids]) => {
            hiddenCollectibles[address.toLowerCase()] = ids;
        });
        const collections = collectionsWithErrResult.reduce((acc, [error, collection]) => {
            // The same check the collection errors are built from, so a collection is
            // either displayed or reported, never both
            if (!isValidCollection(error))
                return acc;
            const lowercasedAddress = collection.address.toLowerCase();
            const customIds = customCollectibles[lowercasedAddress];
            const isCustom = !!customIds;
            const hiddenIds = hiddenCollectibles[lowercasedAddress];
            const isHidden = !!hiddenIds && !hiddenIds.length;
            const visibleCollectibles = (0, helpers_1.getVisibleCollectibles)({
                collectibles: collection.collectibles,
                customIds,
                hiddenIds,
                isDiscovered: discoveredCollections.has(lowercasedAddress)
            });
            // Kept before the filtering below, for the same reason as the token metadata
            if (knownCollectionMetadata &&
                collectionMetadataPlan.needsMetadata.has(collection.address)) {
                fetchedCollectionMetadata.push([
                    collection.address,
                    {
                        symbol: collection.symbol,
                        name: collection.name,
                        fetchedAt: start
                    }
                ]);
            }
            // Spam filter: hide collections whose symbol/name matches a blacklisted
            // pattern or embeds a phishing domain. Custom (user-added) collections
            // are never hidden.
            if ((0, blacklist_1.isBlacklistedAsset)({
                symbol: collection.symbol,
                name: collection.name,
                isCustom,
                patterns: blacklistPatterns,
                checkForEmbeddedDomain: true
            })) {
                (0, debug_1.portfolioDebugLog)('blacklist', `${this.network.chainId.toString()}: Filtered collection ${collection.name}`, {
                    address: collection.address,
                    symbol: collection.symbol,
                    name: collection.name
                });
                return acc;
            }
            // Important note: Collections with 0 collectibles are allowed to pass through the filter.
            // A hidden collection is requested by its own hint, so it doesn't have to
            // be learned. A custom one is learned like any other, and removing it
            // forgets that too, see `#forgetCollectible` in the hints controller.
            if (!isHidden &&
                !toBeLearned.erc721s[collection.address] &&
                collection.collectibles.length > 0) {
                toBeLearned.erc721s[collection.address] = collection.collectibles;
            }
            acc.push({
                ...collection,
                collectibles: visibleCollectibles,
                // Collections have no flags until this point
                flags: { isCustom, isHidden },
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
            if (!this.network.platformId || !this.isTokenPricesEnabled()) {
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
                tokenDataCache.set((0, helpers_1.getTokenDataCacheKey)(token.address), [
                    Date.now(),
                    formattedTokenData
                ]);
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
                !errors.find((x) => x.name === errorNames_1.PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError && x.message === errorMessage) &&
                    // Don't display an error if there is a cached price
                    !hasPrice) {
                    errors.push({
                        name: errorNames_1.PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError,
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
            fetchedTokenMetadata,
            fetchedCollectionMetadata,
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
                return (0, tokenProcessing_1.getFeeToken)(t.address, t.chainId);
            }),
            beforeNonce,
            afterNonce,
            blockNumber,
            tokenErrors: tokensWithErrResult
                .filter(([error, result]) => !isValidToken(error, result))
                .map(([error, result]) => ({ error, address: result.address })),
            collectionErrors: collectionsWithErrResult
                .filter(([error]) => !isValidCollection(error))
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
        // Nothing is remembered across these one-off reads, so every token is read in full
        const metadataPlan = {
            known: new Map(),
            needsMetadata: new Set(uniqueTokenAddrs)
        };
        const [tokensWithErrResult] = await (0, pagination_1.flattenResults)((0, paginate_1.paginate)(uniqueTokenAddrs, limits.erc20).map((page) => (0, getOnchainBalances_1.getTokens)(this.network, this.deploylessTokens, { ...opts, metadataPlan }, accountAddr, page)));
        return tokensWithErrResult.map(([error, token]) => [
            error,
            {
                ...token,
                priceIn: token.priceIn || [],
                marketDataIn: token.marketDataIn || []
            }
        ]);
    }
    async getTokenPrice(address, { baseCurrency = 'usd', tokenDataCache = new Map(), tokenDataRecency = 0 } = {}) {
        const cachedTokenData = tokenDataCache.get((0, helpers_1.getTokenDataCacheKey)(address));
        if (cachedTokenData && Date.now() - cachedTokenData[0] <= tokenDataRecency) {
            return cachedTokenData[1].priceIn.find((price) => price.baseCurrency === baseCurrency)?.price;
        }
        if (!this.network.platformId || !this.isTokenPricesEnabled())
            return undefined;
        const tokenData = await this.batchedGecko({
            address,
            network: this.network,
            baseCurrency,
            responseIdentifier: (0, gecko_1.geckoResponseIdentifier)(address, this.network)
        });
        const formattedTokenData = (0, helpers_1.convertApiTokenDataToTokenDataCache)(tokenData);
        tokenDataCache.set((0, helpers_1.getTokenDataCacheKey)(address), [Date.now(), formattedTokenData]);
        return formattedTokenData.priceIn.find((price) => price.baseCurrency === baseCurrency)?.price;
    }
}
exports.Portfolio = Portfolio;
//# sourceMappingURL=portfolio.js.map