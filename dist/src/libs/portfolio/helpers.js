"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOKEN_METADATA_MAX_AGE_MS = exports.convertApiTokenDataToTokenDataCache = exports.getTokenDataCacheKey = exports.getHardcodedCitreaPrices = exports.getHintsError = exports.isNative = exports.isPortfolioGasTankResult = exports.tokenFilter = exports.learnedErc721sToHints = exports.erc721CollectionToLearnedAssetKeys = exports.getSpecialHints = exports.formatExternalHintsAPIResponse = exports.getAccountPortfolioTotal = exports.addHiddenTokenValueToTotal = exports.getTotal = exports.sortTokensByBalanceInUSD = exports.getTokenBalanceInUSD = exports.getTokenUsdPrice = exports.getTokenAmount = exports.validateERC721Token = exports.validateCollectibleOwnership = exports.getErc721Validity = exports.getCollectibleCacheKey = exports.getAssetCacheKey = exports.normalizeAssetAddress = exports.getVisibleCollectibles = exports.mergeCollectionHints = exports.validateERC20Token = void 0;
exports.overrideSymbol = overrideSymbol;
exports.mergeERC721s = mergeERC721s;
exports.isAssetMetadataStale = isAssetMetadataStale;
exports.planAssetMetadata = planAssetMetadata;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const viem_1 = require("viem");
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
const IERC721_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC721.json"));
const pinnedTokens_1 = require("../../consts/pinnedTokens");
const types_1 = require("../defiPositions/types");
const errorNames_1 = require("./errorNames");
const usdcEMapping = {
    '43114': '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664',
    '1285': '0x748134b5f553f2bcbd78c6826de99a70274bdeb3',
    '42161': '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    '137': '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
    '10': '0x7f5c764cbc14f9669b88837ca1490cca17c31607'
};
function overrideSymbol(address, chainId, symbol) {
    // Since deployless lib calls contract and USDC.e is returned as USDC, we need to override the symbol
    if (usdcEMapping[chainId.toString()] &&
        usdcEMapping[chainId.toString()].toLowerCase() === address.toLowerCase()) {
        return 'USDC.E';
    }
    return symbol;
}
function mergeERC721s(sources) {
    const result = {};
    // Get all unique addresses
    const addresses = new Set(sources.flatMap((source) => Object.keys(source)));
    addresses.forEach((address) => {
        try {
            const checksummed = (0, viem_1.getAddress)(address);
            const hasEnumerableHint = sources.some((source) => source[address] && source[address].length === 0);
            if (hasEnumerableHint) {
                result[checksummed] = [];
                return;
            }
            // Merge arrays and remove duplicates
            const merged = Array.from(new Set(sources.flatMap((source) => source[checksummed] || [])));
            result[checksummed] = merged;
        }
        catch (e) {
            console.error('Error checksumming ERC-721 collection address', e);
        }
    });
    return result;
}
/**
 * Determines whether an error is related to network connectivity issues rather than validation failures.
 *
 * This function helps distinguish between temporary network problems (which should allow retries)
 * and actual token validation errors (which indicate the token is genuinely invalid).
 *
 */
const isNetworkError = (error) => {
    if (!error)
        return false;
    const message = error.message?.toLowerCase() || '';
    const errorCode = error.code;
    // Common network error patterns
    const networkErrorPatterns = [
        'network error',
        'network request failed',
        'fetch failed',
        'connection refused',
        'timeout',
        'econnrefused',
        'enotfound',
        'etimedout',
        'socket hang up',
        'request timeout',
        'failed to fetch',
        'networkerror'
    ];
    // Common network error codes
    const networkErrorCodes = ['NETWORK_ERROR', 'TIMEOUT', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT'];
    return (networkErrorPatterns.some((pattern) => message.includes(pattern)) ||
        networkErrorCodes.includes(errorCode));
};
/**
 * Executes async functions with limited concurrency to prevent overwhelming RPC providers
 */
const limitConcurrency = async (items, asyncFn, limit = 5) => {
    const results = [];
    for (let i = 0; i < items.length; i += limit) {
        const batch = items.slice(i, i + limit);
        const batchPromises = batch.map(asyncFn);
        const batchResults = await Promise.allSettled(batchPromises);
        results.push(...batchResults.map((result) => (result.status === 'fulfilled' ? result.value : null)));
    }
    return results;
};
/**
 * Validates whether a token address represents a valid ERC20 token on the specified network.
 * Optionally suggests alternative networks where the token is found if validation fails.
 *
 */
const validateERC20Token = async (token, accountId, provider, options) => {
    const { allNetworks, allProviders, enableNetworkDetection = false, maxNetworksToCheck = 10, concurrencyLimit = 3 } = options || {};
    const erc20 = new ethers_1.Contract(token?.address, IERC20_json_1.default.abi, provider);
    let isValid = true;
    let hasNetworkError = false;
    let message = '';
    let type = null;
    const handleERC20Error = (e, operation) => {
        console.error('Error during ERC20 validation operation:', operation, e);
        if (isNetworkError(e)) {
            hasNetworkError = true;
            isValid = false;
            type = 'network';
            message = `Network error validating token: ${e.message || `Network error while fetching token ${operation}`}`;
        }
        else {
            isValid = false;
            type = 'validation';
            message = 'This token type is not supported';
        }
    };
    let balance;
    let symbol;
    let decimals;
    try {
        ;
        [balance, symbol, decimals] = await Promise.all([
            erc20.balanceOf(accountId).catch((e) => handleERC20Error(e, 'balance')),
            erc20.symbol().catch((e) => handleERC20Error(e, 'symbol')),
            erc20.decimals().catch((e) => handleERC20Error(e, 'decimals'))
        ]);
    }
    catch (e) {
        handleERC20Error(e, 'token validation');
    }
    if (typeof balance === 'undefined' ||
        typeof symbol === 'undefined' ||
        typeof decimals === 'undefined') {
        // Only mark as invalid if it's not a network error
        if (!hasNetworkError) {
            isValid = false;
            if (!message) {
                message = 'Token validation failed: unable to fetch required token data';
                type = 'validation';
            }
        }
    }
    else if (!hasNetworkError) {
        // Reset error state only if validation succeeded AND there was no network error
        isValid = true;
        message = '';
        type = null;
    }
    // If validation failed and network detection is enabled, check other networks
    if (!isValid && !hasNetworkError && enableNetworkDetection && allNetworks && allProviders) {
        try {
            // Get candidate networks and limit the number to check
            const candidateNetworks = allNetworks
                .filter((network) => allProviders[network.chainId.toString()]?.isWorking !== false)
                .filter((network) => network.chainId !== token.chainId) // Skip the current network
                .slice(0, maxNetworksToCheck); // Limit the number of networks to check
            // Use concurrency-limited validation to prevent overwhelming RPC providers
            const validationFunction = async (network) => {
                try {
                    const networkProvider = allProviders[network.chainId.toString()];
                    if (!networkProvider)
                        return null;
                    // Use validateERC20Token without network detection to avoid circular dependency
                    const validation = await (0, exports.validateERC20Token)({ address: token.address, chainId: network.chainId }, accountId, networkProvider, { enableNetworkDetection: false });
                    return validation.isValid ? network : null;
                }
                catch (error) {
                    return null;
                }
            };
            const results = await limitConcurrency(candidateNetworks, validationFunction, concurrencyLimit);
            const validNetworks = results.filter((network) => network !== null);
            if (validNetworks.length > 0) {
                const networkNames = validNetworks.map((net) => net.name).join(', ');
                message = `This token is found on ${networkNames}. Is the correct network selected?`;
                type = 'validation';
            }
        }
        catch (networkDetectionError) {
            // Network detection failed, but don't override the original error
            console.warn('Network detection failed:', networkDetectionError);
        }
    }
    return {
        isValid,
        standard: 'erc20',
        error: {
            message: message || null,
            type
        }
    };
};
exports.validateERC20Token = validateERC20Token;
const ERC721_INTERFACE_ID = '0x80ac58cd';
const ERC1155_INTERFACE_ID = '0xd9b67a26';
// Not available in the compiled IERC721 ABI
const ERC721_METADATA_ABI = [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function supportsInterface(bytes4 interfaceId) view returns (bool)'
];
/**
 * Merges every source of ERC-721 hints for a network.
 *
 * The custom and the hidden collections are requested like any other, as the
 * account may hold a collectible no other source knows about, and a hidden
 * collection still has to be read to be listed as hidden. Their ids are added to
 * what the other sources found.
 *
 * An entry without ids asks for the whole collection, which would override the
 * exact ids of the other sources, so it is only used for a collection no other
 * source named ids for.
 */
const mergeCollectionHints = ({ additionalHints, apiHints, specialHints }) => {
    const merged = mergeERC721s([additionalHints || {}, apiHints, specialHints?.learn || {}]);
    const addCollections = (collections) => {
        Object.keys(collections).forEach((address) => {
            let checksummed = address;
            try {
                checksummed = (0, viem_1.getAddress)(address);
            }
            catch {
                // Not an address, so it can't be a collection
                return;
            }
            const ids = collections[address] || [];
            if (!ids.length) {
                // Asks for the whole collection, unless another source already named ids
                if (!merged[checksummed]?.length)
                    merged[checksummed] = [];
                return;
            }
            const knownIds = merged[checksummed];
            // The whole collection is already requested
            if (knownIds && !knownIds.length)
                return;
            merged[checksummed] = [...new Set([...(knownIds || []), ...ids])];
        });
    };
    addCollections(specialHints?.custom || {});
    addCollections(specialHints?.hidden || {});
    return merged;
};
exports.mergeCollectionHints = mergeCollectionHints;
/**
 * The collectibles of a collection that the account should see.
 *
 * A collection added by the user shows only the collectibles they added, so the
 * rest of it doesn't come along with them. Collections added before the ids
 * were recorded have none, which means the whole collection.
 *
 * `isDiscovered` marks a collection another source already found. Narrowing one
 * of those down to the added ids would hide collectibles the account was already
 * seeing, so only a collection that exists because it was added is narrowed.
 */
const getVisibleCollectibles = ({ collectibles, customIds, hiddenIds, isDiscovered }) => {
    // No hidden ids stands for the whole collection, the same way it does in the hints
    if (hiddenIds && !hiddenIds.length)
        return [];
    const added = customIds?.length && !isDiscovered
        ? collectibles.filter((id) => customIds.includes(id))
        : collectibles;
    if (!hiddenIds)
        return added;
    return added.filter((id) => !hiddenIds.includes(id));
};
exports.getVisibleCollectibles = getVisibleCollectibles;
/**
 * Addresses reach the validation caches from user input, from dApps and from the
 * portfolio, so they are normalized to always resolve to the same entry.
 */
const normalizeAssetAddress = (address) => {
    try {
        return (0, viem_1.getAddress)(address);
    }
    catch {
        // Not an address, so the raw value is the best key we have
        return address;
    }
};
exports.normalizeAssetAddress = normalizeAssetAddress;
/** Key of a token or a collection in the validation cache */
const getAssetCacheKey = (address, chainId) => `${(0, exports.normalizeAssetAddress)(address)}-${chainId}`;
exports.getAssetCacheKey = getAssetCacheKey;
/** Key of a single collectible in the validation cache */
const getCollectibleCacheKey = (address, chainId, tokenId) => `${(0, exports.getAssetCacheKey)(address, chainId)}-${tokenId}`;
exports.getCollectibleCacheKey = getCollectibleCacheKey;
/**
 * Decides whether a contract is a collection, based on what it exposes.
 * Extracted so the decision can be tested without a provider.
 */
const getErc721Validity = ({ supportsERC721, supportsERC1155, isContract, hasDecimals }) => {
    // Some collections (e.g. vote-escrow NFTs) expose decimals() too, so this has
    // to be trusted over the checks below
    if (supportsERC721 === true)
        return { isValid: true, reason: null };
    // Multi edition NFTs are a different standard, which the portfolio can't read.
    // Some of them expose ownerOf() too, so they would pass the checks below.
    if (supportsERC1155 === true)
        return { isValid: false, reason: 'erc1155-unsupported' };
    if (!isContract)
        return { isValid: false, reason: 'not-a-collection' };
    if (hasDecimals)
        return { isValid: false, reason: 'is-a-token' };
    // Whether the account owns collectibles of it doesn't matter, the same way a
    // custom token is added regardless of its balance
    return { isValid: true, reason: null };
};
exports.getErc721Validity = getErc721Validity;
/**
 * Checks whether the account owns the collectible. Used when a collection can't
 * be listed and the user names one of their collectibles explicitly.
 */
const validateCollectibleOwnership = async (collectible, accountId, provider) => {
    const erc721 = new ethers_1.Contract(collectible.address, IERC721_json_1.default.abi, provider);
    const invalid = (type, reason) => ({
        isValid: false,
        standard: 'erc721',
        error: { message: null, type, reason }
    });
    let owner;
    try {
        owner = await erc721.ownerOf(collectible.tokenId);
    }
    catch (e) {
        console.error('Error while checking the owner of a collectible', e);
        if (isNetworkError(e))
            return invalid('network', 'network-problem');
        return invalid('validation', 'collectible-not-found');
    }
    if (typeof owner !== 'string' || owner.toLowerCase() !== accountId.toLowerCase())
        return invalid('validation', 'collectible-not-owned');
    return { isValid: true, standard: 'erc721', error: { message: null, type: null } };
};
exports.validateCollectibleOwnership = validateCollectibleOwnership;
/** An ERC-20 token is rejected too, as it also exposes name() and balanceOf() */
const validateERC721Token = async (collection, provider) => {
    const metadata = new ethers_1.Contract(collection.address, ERC721_METADATA_ABI, provider);
    const erc20 = new ethers_1.Contract(collection.address, IERC20_json_1.default.abi, provider);
    let hasNetworkError = false;
    const handleError = (e, operation) => {
        console.error('Error during ERC721 validation operation:', operation, e);
        if (isNetworkError(e))
            hasNetworkError = true;
        return undefined;
    };
    const [code, supportsERC721, supportsERC1155, decimals, name, symbol] = await Promise.all([
        provider.getCode(collection.address).catch((e) => handleError(e, 'code')),
        metadata.supportsInterface(ERC721_INTERFACE_ID).catch((e) => handleError(e, 'supportsInterface')),
        metadata.supportsInterface(ERC1155_INTERFACE_ID).catch((e) => {
            if (isNetworkError(e))
                hasNetworkError = true;
            return undefined;
        }),
        // A revert is the expected outcome for a collection, but a network problem
        // must not read as one - it would leave a token looking like a collection
        erc20.decimals().catch((e) => {
            if (isNetworkError(e))
                hasNetworkError = true;
            return undefined;
        }),
        // Optional, used for the preview
        metadata.name().catch(() => undefined),
        metadata.symbol().catch(() => undefined)
    ]);
    if (hasNetworkError)
        return {
            isValid: false,
            standard: 'erc721',
            error: { message: null, type: 'network', reason: 'network-problem' }
        };
    const { isValid, reason } = (0, exports.getErc721Validity)({
        supportsERC721,
        supportsERC1155,
        isContract: typeof code === 'string' && code !== '0x',
        hasDecimals: typeof decimals !== 'undefined'
    });
    if (!isValid)
        return {
            isValid: false,
            standard: 'erc721',
            error: { message: null, type: 'validation', reason }
        };
    return {
        isValid: true,
        standard: 'erc721',
        error: { message: null, type: null },
        collection: {
            name: typeof name === 'string' ? name : null,
            symbol: typeof symbol === 'string' ? symbol : null
        }
    };
};
exports.validateERC721Token = validateERC721Token;
// fetch the amountPostSimulation for the token if set
// otherwise, the token.amount
const getTokenAmount = (token, beforeSimulation) => {
    if (beforeSimulation)
        return token.amount;
    return typeof token.amountPostSimulation === 'bigint' ? token.amountPostSimulation : token.amount;
};
exports.getTokenAmount = getTokenAmount;
const getTokenUsdPrice = (token) => token.priceIn.find(({ baseCurrency }) => baseCurrency === 'usd')?.price || 0;
exports.getTokenUsdPrice = getTokenUsdPrice;
/**
 * The token's balance in USD. Called once per token on every portfolio update and
 * once per token per comparison wherever a token list is sorted by it, so the
 * amount is converted with plain number math: `formatUnits` builds a decimal
 * string, which costs ~80us per call on a mid-range phone and dominated the
 * sorting of a large portfolio. A float carries the same precision the caller
 * ends up with either way, since the result is a float in both cases.
 */
const getTokenBalanceInUSD = (token) => {
    const price = (0, exports.getTokenUsdPrice)(token);
    if (!price)
        return 0;
    const balance = Number((0, exports.getTokenAmount)(token)) / 10 ** token.decimals;
    return balance * price;
};
exports.getTokenBalanceInUSD = getTokenBalanceInUSD;
/**
 * Tokens ordered by their USD balance, highest first. Each token's balance is
 * calculated once instead of on every comparison, which is what a comparator
 * that derives it would do (~20 times per token for a 1000-token portfolio).
 */
const sortTokensByBalanceInUSD = (tokens) => tokens
    .map((token) => ({ token, balanceInUSD: (0, exports.getTokenBalanceInUSD)(token) }))
    .sort((a, b) => b.balanceInUSD - a.balanceInUSD)
    .map(({ token }) => token);
exports.sortTokensByBalanceInUSD = sortTokensByBalanceInUSD;
const getTotal = (t, defiState, opts) => {
    const { includeHiddenTokens = false, beforeSimulation = false } = opts || {};
    const tokensTotal = t.reduce((cur, token) => {
        const localCur = cur; // Add index signature to the type of localCur
        if (token.flags.isHidden && !includeHiddenTokens)
            return localCur;
        for (const x of token.priceIn) {
            const currentAmount = localCur[x.baseCurrency] || 0;
            const tokenAmount = Number((0, exports.getTokenAmount)(token, beforeSimulation)) / 10 ** token.decimals;
            const total = tokenAmount * x.price;
            // Prevents the whole balance of the portfolio becoming NaN if one token has invalid total
            if (typeof total !== 'number' || Number.isNaN(total)) {
                console.error(`Invalid total for token ${token.symbol} (${token.address}) on chain ${token.chainId}`, 'Price:', x, 'Amount:', tokenAmount);
                continue;
            }
            localCur[x.baseCurrency] = currentAmount + total;
        }
        return localCur;
    }, {});
    let defiTotal = {
        usd: 0
    };
    if (defiState) {
        // The portfolio handles at least one collateral token,
        // thus we must exclude them from the defi total to avoid double counting
        const positionsToExclude = t
            .filter((token) => token.flags.defiPositionId &&
            token.flags.defiTokenType === types_1.AssetType.Collateral &&
            // If the token doesn't have a price we must add the value from the position to the total
            token.priceIn.length > 0)
            .map((token) => token.flags.defiPositionId);
        defiTotal = defiState.positionsByProvider.reduce((cur, position) => {
            const positionsFlat = position.positions.flat();
            positionsFlat.forEach((p) => {
                // stkWallet is an internal position, created from the stkWallet token
                if (positionsToExclude.includes(p.id) || p.id === 'stk-wallet')
                    return;
                cur.usd += p.additionalData.positionInUSD || 0;
            });
            return cur;
        }, { usd: 0 });
    }
    // In case the user doesn't have any tokens or the function is calculating for the custom
    // network `defiApps` that doesn't have any tokens
    if (!Object.keys(tokensTotal).length && Object.keys(defiTotal).length > 0) {
        return defiTotal;
    }
    return Object.keys(tokensTotal).reduce((cur, key) => {
        cur[key] = (tokensTotal[key] || 0) + (defiTotal[key] || 0);
        return cur;
    }, {});
};
exports.getTotal = getTotal;
const addHiddenTokenValueToTotal = (totalWithoutHiddenTokens, tokens) => {
    return tokens.reduce((cur, token) => {
        if (!token.flags.isHidden)
            return cur;
        return cur + (0, exports.getTokenBalanceInUSD)(token);
    }, totalWithoutHiddenTokens);
};
exports.addHiddenTokenValueToTotal = addHiddenTokenValueToTotal;
const getAccountPortfolioTotal = (accountPortfolio, excludeNetworks = [], excludeHiddenTokens = true) => {
    if (!accountPortfolio)
        return 0;
    return Object.keys(accountPortfolio).reduce((acc, chainId) => {
        if (excludeNetworks.includes(chainId))
            return acc;
        const networkData = accountPortfolio[chainId];
        const tokenList = networkData?.result?.tokens || [];
        let networkTotalAmountUSD = networkData?.result?.total.usd || 0;
        if (!excludeHiddenTokens) {
            networkTotalAmountUSD = (0, exports.addHiddenTokenValueToTotal)(networkTotalAmountUSD, tokenList);
        }
        return acc + networkTotalAmountUSD;
    }, 0);
};
exports.getAccountPortfolioTotal = getAccountPortfolioTotal;
/**
 * Formats and strips the original velcro response
 */
const formatExternalHintsAPIResponse = (response) => {
    if (!response)
        return null;
    const { erc20s, erc721s, lastUpdate, hasHints } = response;
    // For customAppChain
    if (!erc20s || !erc721s) {
        return null;
    }
    const formattedErc721s = {};
    Object.entries(erc721s).forEach(([collectionAddress, value]) => {
        if (!('tokens' in value)) {
            formattedErc721s[collectionAddress] = [];
            return;
        }
        formattedErc721s[collectionAddress] = value.tokens.map((id) => BigInt(id));
    });
    return {
        erc20s,
        erc721s: formattedErc721s,
        lastUpdate,
        hasHints
    };
};
exports.formatExternalHintsAPIResponse = formatExternalHintsAPIResponse;
const getSpecialHints = (chainId, customTokens, tokenPreferences, toBeLearnedAssets) => {
    const specialErc20Hints = {
        custom: [],
        hidden: [],
        learn: []
    };
    const specialErc721Hints = {
        custom: {},
        hidden: {},
        learn: {}
    };
    const networkToBeLearnedTokens = toBeLearnedAssets.erc20s?.[chainId.toString()] || [];
    const networkToBeLearnedNfts = toBeLearnedAssets.erc721s?.[chainId.toString()] || {};
    // A collectible is requested by its id, while an entry without one requests
    // every collectible of the collection (an empty array of ids)
    const addCollectionHint = (hints, { address, tokenId }) => {
        if (typeof tokenId !== 'bigint') {
            hints[address] = [];
            return;
        }
        if (hints[address]?.length === 0)
            return;
        hints[address] = [...(hints[address] || []), tokenId];
    };
    customTokens.forEach((token) => {
        if (token.chainId !== chainId)
            return;
        if (token.standard === 'ERC20') {
            specialErc20Hints.custom.push(token.address);
            return;
        }
        if (token.standard === 'ERC721')
            addCollectionHint(specialErc721Hints.custom, token);
    });
    tokenPreferences.forEach((token) => {
        if (token.chainId !== chainId || !token.isHidden)
            return;
        if (token.standard === 'ERC721') {
            addCollectionHint(specialErc721Hints.hidden, token);
            return;
        }
        specialErc20Hints.hidden.push(token.address);
    });
    if (networkToBeLearnedTokens) {
        networkToBeLearnedTokens.forEach((token) => {
            specialErc20Hints.learn.push(token);
        });
    }
    if (networkToBeLearnedNfts) {
        specialErc721Hints.learn = networkToBeLearnedNfts;
    }
    return {
        specialErc20Hints,
        specialErc721Hints
    };
};
exports.getSpecialHints = getSpecialHints;
/**
 * Converts ERC721 hints to keys that can be used for:
 * - comparison of NFTs
 * - storage
 */
const erc721CollectionToLearnedAssetKeys = (collection) => {
    const [collectionAddress, tokenIds] = collection;
    if (!tokenIds.length)
        return [`${collectionAddress}:enumerable`];
    return tokenIds.map((id) => `${collectionAddress}:${id}`);
};
exports.erc721CollectionToLearnedAssetKeys = erc721CollectionToLearnedAssetKeys;
/**
 * Converts `LearnedAssets` ERC721 hint keys to
 * `ERC721` hints. For more info, see `LearnedAssets`
 */
const learnedErc721sToHints = (keys) => {
    const hints = {};
    // Split once and collect the enumerable collections up front. Checking for an
    // enumerable key while building the hints would mean scanning every key for
    // every key, and an account with many collections brings thousands of them.
    const parsedKeys = [];
    const enumerableCollections = new Set();
    keys.forEach((key) => {
        const [collectionAddress, tokenId] = key.split(':');
        if (!collectionAddress)
            return;
        parsedKeys.push([collectionAddress, tokenId]);
        if (tokenId === 'enumerable')
            enumerableCollections.add(collectionAddress);
    });
    parsedKeys.forEach(([collectionAddress, tokenId]) => {
        if (tokenId === 'enumerable') {
            hints[collectionAddress] = [];
            return;
        }
        // The key already exists as an enumerable hint. Example:
        // collectionA:enumerable exists and collectionB:id is attempted to be added
        // (it shouldn't be)
        if (enumerableCollections.has(collectionAddress)) {
            return;
        }
        if (typeof tokenId !== 'string')
            return;
        if (!hints[collectionAddress]) {
            hints[collectionAddress] = [];
        }
        hints[collectionAddress].push(BigInt(tokenId));
    });
    return hints;
};
exports.learnedErc721sToHints = learnedErc721sToHints;
const tokenFilter = (token, network, isToBeLearned, shouldIncludePinned, nativeToken) => {
    // Never add ERC20 tokens that represent the network's native token.
    // For instance, on Polygon, we have this token: `0x0000000000000000000000000000000000001010`.
    // It mimics the native POL token (same symbol, same amount) and is shown twice in the Dashboard.
    // From a user's perspective, the token is duplicated and counted twice in the balance.
    const isERC20NativeRepresentation = !!nativeToken &&
        (token.symbol === nativeToken.symbol ||
            network.oldNativeAssetSymbols?.includes(token.symbol)) &&
        token.amount === nativeToken.amount &&
        token.address !== ethers_1.ZeroAddress;
    if (isERC20NativeRepresentation)
        return false;
    // always include tokens added as a preference
    if (token.flags.isHidden || token.flags.isCustom || isToBeLearned)
        return true;
    // always include > 0 amount and native token
    if (token.amount > 0 || token.address === ethers_1.ZeroAddress)
        return true;
    const isPinned = !!pinnedTokens_1.PINNED_TOKENS.find((pinnedToken) => {
        return pinnedToken.chainId === network.chainId && pinnedToken.address === token.address;
    });
    // if the amount is 0
    // return the token if it's pinned and requested
    const pinnedRequested = isPinned && !!shouldIncludePinned;
    return pinnedRequested;
};
exports.tokenFilter = tokenFilter;
const isPortfolioGasTankResult = (result) => {
    return !!result && 'gasTankTokens' in result && Array.isArray(result.gasTankTokens);
};
exports.isPortfolioGasTankResult = isPortfolioGasTankResult;
const isNative = (token) => token.address === ethers_1.ZeroAddress && !token.flags.onGasTank;
exports.isNative = isNative;
const getHintsError = (errorMessage, lastExternalApiHintsData) => {
    if (!lastExternalApiHintsData) {
        return {
            name: errorNames_1.PORTFOLIO_LIB_ERROR_NAMES.NoApiHintsError,
            message: errorMessage,
            level: 'critical'
        };
    }
    const TEN_MINUTES = 10 * 60 * 1000;
    const lastUpdate = lastExternalApiHintsData.lastUpdate;
    const isLastUpdateTooOld = Date.now() - lastUpdate > TEN_MINUTES;
    return {
        name: isLastUpdateTooOld
            ? errorNames_1.PORTFOLIO_LIB_ERROR_NAMES.StaleApiHintsError
            : errorNames_1.PORTFOLIO_LIB_ERROR_NAMES.NonCriticalApiHintsError,
        message: errorMessage,
        level: isLastUpdateTooOld ? 'critical' : 'silent'
    };
};
exports.getHintsError = getHintsError;
const getHardcodedCitreaPrices = (address) => {
    const stables = [
        '0x8D82c4E3c936C7B5724A382a9c5a4E6Eb7aB6d5D',
        '0xE045e6c36cF77FAA2CfB54466D71A3aEF7bbE839',
        '0x9f3096Bac87e7F03DC09b0B416eB0DF837304dc4'
    ];
    if (stables.indexOf(address) !== -1) {
        return {
            baseCurrency: 'usd',
            price: 1
        };
    }
    return null;
};
exports.getHardcodedCitreaPrices = getHardcodedCitreaPrices;
/**
 * The API may return the token checksummed or lowercase so we normalize it to lowercase to avoid cache misses.
 */
const getTokenDataCacheKey = (address) => address.toLowerCase();
exports.getTokenDataCacheKey = getTokenDataCacheKey;
const convertApiTokenDataToTokenDataCache = (tokenData) => {
    if (!tokenData) {
        return {
            priceIn: [],
            marketDataIn: []
        };
    }
    const baseCurrency = (tokenData.baseCurrency || 'usd'); // stop ts from complaining, we only support usd as base currency for now
    const price = (tokenData.price || tokenData.usd);
    const baseCurrency24hChange = tokenData[`${baseCurrency}_24h_change`];
    const baseCurrency24hVolume = tokenData[`${baseCurrency}_24h_vol`];
    const baseCurrencyMarketCap = tokenData[`${baseCurrency}_market_cap`];
    const fullyDilutedValuation = tokenData[`${baseCurrency}_fully_diluted_valuation`];
    const website = tokenData.homepage ? tokenData.homepage[0] : undefined;
    return {
        priceIn: typeof price === 'number' ? [{ baseCurrency, price }] : [],
        marketDataIn: [
            {
                baseCurrency,
                change24h: baseCurrency24hChange,
                volume24h: baseCurrency24hVolume,
                marketCap: baseCurrencyMarketCap,
                fullyDilutedValuation: fullyDilutedValuation,
                totalSupply: tokenData.total_supply
            }
        ],
        meta: {
            exchanges: tokenData.exchanges || [],
            website: website
        }
    };
};
exports.convertApiTokenDataToTokenDataCache = convertApiTokenDataToTokenDataCache;
/**
 * How long stored token metadata is trusted before it is read from the chain again.
 * Symbols and names do change on rare occasions, such as a token rebrand behind an
 * upgradeable proxy.
 */
exports.TOKEN_METADATA_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * Whether the chain has to be asked for an asset's metadata (a token's symbol, name
 * and decimals, or a collection's name and symbol). True when nothing is stored for
 * it, or when what is stored has aged out.
 */
function isAssetMetadataStale(entry, now) {
    if (!entry)
        return true;
    return now - entry.fetchedAt > exports.TOKEN_METADATA_MAX_AGE_MS;
}
/**
 * Splits the passed addresses into the metadata already held for them and the ones
 * whose metadata has to be read on this update. The map is copied, so that an update in
 * flight keeps the metadata it started with even if the caller's store drops entries in
 * the meantime.
 */
function planAssetMetadata(addresses, known, now) {
    const plan = { known: new Map(), needsMetadata: new Set() };
    addresses.forEach((address) => {
        const entry = known?.get(address);
        if (!entry || isAssetMetadataStale(entry, now)) {
            plan.needsMetadata.add(address);
            return;
        }
        plan.known.set(address, entry);
    });
    return plan;
}
//# sourceMappingURL=helpers.js.map