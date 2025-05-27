"use strict";
/* eslint-disable import/no-cycle */
/* eslint-disable no-restricted-syntax */
/* eslint-disable guard-for-in */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Portfolio = exports.getEmptyHints = exports.PORTFOLIO_LIB_ERROR_NAMES = exports.LIMITS = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const BalanceGetter_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/BalanceGetter.json"));
const NFTGetter_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/NFTGetter.json"));
const gasTankFeeTokens_1 = tslib_1.__importDefault(require("../../consts/gasTankFeeTokens"));
const pinnedTokens_1 = require("../../consts/pinnedTokens");
const deployless_1 = require("../deployless/deployless");
const batcher_1 = tslib_1.__importDefault(require("./batcher"));
const gecko_1 = require("./gecko");
const getOnchainBalances_1 = require("./getOnchainBalances");
const helpers_1 = require("./helpers");
const pagination_1 = require("./pagination");
exports.LIMITS = {
    // we have to be conservative with erc721Tokens because if we pass 30x20 (worst case) tokenIds, that's 30x20 extra words which is 19kb
    // proxy mode input is limited to 24kb
    deploylessProxyMode: { erc20: 66, erc721: 30, erc721TokensInput: 20, erc721Tokens: 50 },
    // theoretical capacity is 1666/450
    deploylessStateOverrideMode: {
        erc20: 230,
        erc721: 70,
        erc721TokensInput: 70,
        erc721Tokens: 70
    }
};
exports.PORTFOLIO_LIB_ERROR_NAMES = {
    /** External hints API (Velcro) request failed but fallback is sufficient */
    NonCriticalApiHintsError: 'NonCriticalApiHintsError',
    /** External API (Velcro) hints are older than X minutes */
    StaleApiHintsError: 'StaleApiHintsError',
    /** No external API (Velcro) hints are available- the request failed without fallback */
    NoApiHintsError: 'NoApiHintsError',
    /** One or more cena request has failed */
    PriceFetchError: 'PriceFetchError'
};
const getEmptyHints = () => ({
    erc20s: [],
    erc721s: {}
});
exports.getEmptyHints = getEmptyHints;
const defaultOptions = {
    baseCurrency: 'usd',
    blockTag: 'latest',
    priceRecency: 0,
    previousHintsFromExternalAPI: null,
    fetchPinned: true
};
class Portfolio {
    network;
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
        this.network = network;
        this.deploylessTokens = (0, deployless_1.fromDescriptor)(provider, BalanceGetter_json_1.default, !network.rpcNoStateOverride);
        this.deploylessNfts = (0, deployless_1.fromDescriptor)(provider, NFTGetter_json_1.default, !network.rpcNoStateOverride);
    }
    async get(accountAddr, opts = {}) {
        const errors = [];
        const localOpts = { ...defaultOptions, ...opts };
        const disableAutoDiscovery = localOpts.disableAutoDiscovery || false;
        const { baseCurrency } = localOpts;
        if (localOpts.simulation && localOpts.simulation.account.addr !== accountAddr)
            throw new Error('wrong account passed');
        // Get hints (addresses to check on-chain) via Velcro
        const start = Date.now();
        const chainId = this.network.chainId;
        // Make sure portfolio lib still works, even in the case Velcro discovery fails.
        // Because of this, we fall back to Velcro default response.
        let hints = (0, exports.getEmptyHints)();
        let hintsFromExternalAPI = null;
        try {
            // if the network doesn't have a relayer, velcro will not work
            // but we should not record an error if such is the case
            if (!disableAutoDiscovery) {
                hintsFromExternalAPI = await this.batchedVelcroDiscovery({
                    chainId,
                    accountAddr,
                    baseCurrency
                });
                if (hintsFromExternalAPI) {
                    hintsFromExternalAPI.lastUpdate = Date.now();
                    hints = (0, helpers_1.stripExternalHintsAPIResponse)(hintsFromExternalAPI);
                }
            }
        }
        catch (error) {
            const errorMesssage = `Failed to fetch hints from Velcro for chainId (${chainId}): ${error.message}`;
            if (localOpts.previousHintsFromExternalAPI) {
                hints = { ...localOpts.previousHintsFromExternalAPI };
                const TEN_MINUTES = 10 * 60 * 1000;
                const lastUpdate = localOpts.previousHintsFromExternalAPI.lastUpdate;
                const isLastUpdateTooOld = Date.now() - lastUpdate > TEN_MINUTES;
                errors.push({
                    name: isLastUpdateTooOld
                        ? exports.PORTFOLIO_LIB_ERROR_NAMES.StaleApiHintsError
                        : exports.PORTFOLIO_LIB_ERROR_NAMES.NonCriticalApiHintsError,
                    message: errorMesssage,
                    level: isLastUpdateTooOld ? 'critical' : 'silent'
                });
            }
            else {
                errors.push({
                    name: exports.PORTFOLIO_LIB_ERROR_NAMES.NoApiHintsError,
                    message: errorMesssage,
                    level: 'critical'
                });
            }
            // It's important for DX to see this error
            // eslint-disable-next-line no-console
            console.error(errorMesssage);
        }
        // Please note 2 things:
        // 1. Velcro hints data takes advantage over previous hints because, in most cases, Velcro data is more up-to-date than the previously cached hints.
        // 2. There is only one use-case where the previous hints data is more recent, and that is when we find an NFT token via a pending simulation.
        // In order to support it, we have to apply a complex deep merging algorithm (which may become problematic if the Velcro API changes)
        // and also have to introduce an algorithm for self-cleaning outdated/previous NFT tokens.
        // However, we have chosen to keep it as simple as possible and disregard this rare case.
        if (localOpts.additionalErc721Hints) {
            hints.erc721s = { ...localOpts.additionalErc721Hints, ...hints.erc721s };
        }
        if (localOpts.additionalErc20Hints) {
            hints.erc20s = [...hints.erc20s, ...localOpts.additionalErc20Hints];
        }
        if (localOpts.fetchPinned) {
            hints.erc20s = [...hints.erc20s, ...pinnedTokens_1.PINNED_TOKENS.map((x) => x.address)];
        }
        // add the fee tokens
        hints.erc20s = [
            ...hints.erc20s,
            ...gasTankFeeTokens_1.default.filter((x) => x.chainId === this.network.chainId).map((x) => x.address)
        ];
        const checksummedErc20Hints = hints.erc20s
            .map((address) => {
            try {
                // getAddress may throw an error. This will break the portfolio
                // if the error isn't caught
                return (0, ethers_1.getAddress)(address);
            }
            catch {
                return null;
            }
        })
            .filter(Boolean);
        // Remove duplicates and always add ZeroAddress
        hints.erc20s = [...new Set(checksummedErc20Hints.concat(ethers_1.ZeroAddress))];
        // This also allows getting prices, this is used for more exotic tokens that cannot be retrieved via Coingecko
        const priceCache = localOpts.priceCache || new Map();
        for (const addr in hintsFromExternalAPI?.prices || {}) {
            const priceHint = hintsFromExternalAPI?.prices[addr];
            // eslint-disable-next-line no-continue
            if (!priceHint)
                continue;
            // @TODO consider validating the external response here, before doing the .set; or validating the whole velcro response
            priceCache.set(addr, [start, Array.isArray(priceHint) ? priceHint : [priceHint]]);
        }
        const discoveryDone = Date.now();
        // .isLimitedAt24kbData should be the same for both instances; @TODO more elegant check?
        const limits = this.deploylessTokens.isLimitedAt24kbData
            ? exports.LIMITS.deploylessProxyMode
            : exports.LIMITS.deploylessStateOverrideMode;
        const collectionsHints = Object.entries(hints.erc721s);
        const [tokensWithErr, collectionsWithErr] = await Promise.all([
            (0, pagination_1.flattenResults)((0, pagination_1.paginate)(hints.erc20s, limits.erc20).map((page) => (0, getOnchainBalances_1.getTokens)(this.network, this.deploylessTokens, localOpts, accountAddr, page))),
            (0, pagination_1.flattenResults)((0, pagination_1.paginate)(collectionsHints, limits.erc721).map((page) => (0, getOnchainBalances_1.getNFTs)(this.network, this.deploylessNfts, localOpts, accountAddr, page, limits)))
        ]);
        const [tokensWithErrResult, metaData] = tokensWithErr;
        const { blockNumber, beforeNonce, afterNonce } = metaData;
        const [collectionsWithErrResult] = collectionsWithErr;
        // Re-map/filter into our format
        const getPriceFromCache = (address) => {
            const cached = priceCache.get(address);
            if (!cached)
                return null;
            const [timestamp, entry] = cached;
            const eligible = entry.filter((x) => x.baseCurrency === baseCurrency);
            // by using `start` instead of `Date.now()`, we make sure that prices updated from Velcro will not be updated again
            // even if priceRecency is 0
            if (start - timestamp <= localOpts.priceRecency && eligible.length)
                return eligible;
            return null;
        };
        const tokenFilter = ([error, result]) => error === '0x' && !!result.symbol;
        const tokensWithoutPrices = tokensWithErrResult
            .filter((_tokensWithErrResult) => tokenFilter(_tokensWithErrResult))
            .map(([, result]) => result);
        const unfilteredCollections = collectionsWithErrResult.map(([error, x], i) => {
            const address = collectionsHints[i][0];
            return [
                error,
                {
                    ...x,
                    address,
                    priceIn: getPriceFromCache(address) || []
                }
            ];
        });
        const collections = unfilteredCollections
            .filter((preFilterCollection) => tokenFilter(preFilterCollection))
            .map(([, collection]) => collection);
        const oracleCallDone = Date.now();
        // Update prices and set the priceIn for each token by reference,
        // updating the final tokens array as a result
        const tokensWithPrices = await Promise.all(tokensWithoutPrices.map(async (token) => {
            let priceIn = [];
            const cachedPriceIn = getPriceFromCache(token.address);
            if (cachedPriceIn) {
                priceIn = cachedPriceIn;
                return {
                    ...token,
                    priceIn
                };
            }
            if (!this.network.platformId) {
                return {
                    ...token,
                    priceIn
                };
            }
            try {
                const priceData = await this.batchedGecko({
                    ...token,
                    network: this.network,
                    baseCurrency,
                    // this is what to look for in the coingecko response object
                    responseIdentifier: (0, gecko_1.geckoResponseIdentifier)(token.address, this.network)
                });
                priceIn = Object.entries(priceData || {}).map(([baseCurr, price]) => ({
                    baseCurrency: baseCurr,
                    price: price
                }));
                if (priceIn.length)
                    priceCache.set(token.address, [Date.now(), priceIn]);
            }
            catch (error) {
                const errorMessage = error?.message || 'Unknown error';
                priceIn = [];
                // Avoid duplicate errors, because this.bachedGecko is called for each token and if
                // there is an error it will most likely be the same for all tokens
                if (!errors.find((x) => x.name === exports.PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError && x.message === errorMessage)) {
                    errors.push({
                        name: exports.PORTFOLIO_LIB_ERROR_NAMES.PriceFetchError,
                        message: errorMessage,
                        level: 'warning'
                    });
                }
            }
            return {
                ...token,
                priceIn
            };
        }));
        const priceUpdateDone = Date.now();
        return {
            hintsFromExternalAPI: (0, helpers_1.stripExternalHintsAPIResponse)(hintsFromExternalAPI),
            errors,
            updateStarted: start,
            discoveryTime: discoveryDone - start,
            oracleCallTime: oracleCallDone - discoveryDone,
            priceUpdateTime: priceUpdateDone - oracleCallDone,
            priceCache,
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
                .filter(([error, result]) => error !== '0x' || result.symbol === '')
                .map(([error, result]) => ({ error, address: result.address })),
            collections
        };
    }
}
exports.Portfolio = Portfolio;
//# sourceMappingURL=portfolio.js.map