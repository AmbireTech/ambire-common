"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertApiTokenDataToTokenDataCache = exports.getHardcodedCitreaPrices = exports.getHintsError = exports.isNative = exports.isPortfolioGasTankResult = exports.tokenFilter = exports.learnedErc721sToHints = exports.erc721CollectionToLearnedAssetKeys = exports.getSpecialHints = exports.formatExternalHintsAPIResponse = exports.getAccountPortfolioTotal = exports.addHiddenTokenValueToTotal = exports.getTotal = exports.getTokenBalanceInUSD = exports.getTokenAmount = exports.validateERC20Token = exports.mapToken = exports.isSuspectedToken = exports.isSuspectedRegardsKnownAddresses = void 0;
exports.overrideSymbol = overrideSymbol;
exports.getFlags = getFlags;
exports.mergeERC721s = mergeERC721s;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const viem_1 = require("viem");
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
const gasTankFeeTokens_1 = tslib_1.__importDefault(require("../../consts/gasTankFeeTokens"));
const humanizerInfo_json_1 = tslib_1.__importDefault(require("../../consts/humanizer/humanizerInfo.json"));
const pinnedTokens_1 = require("../../consts/pinnedTokens");
const types_1 = require("../defiPositions/types");
const portfolio_1 = require("./portfolio");
const knownAddresses = humanizerInfo_json_1.default.knownAddresses || {};
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
const removeNonLatinChars = (str) => str
    // normalize to NFC form to unify visually-similar composed characters
    .normalize('NFC')
    .split('')
    // keep only ASCII range (printable chars)
    .filter((ch) => {
    const code = ch.charCodeAt(0);
    return code >= 32 && code <= 126;
})
    .join('');
// safe address normalizer
const normalizeAddress = (addr) => {
    try {
        return (0, viem_1.getAddress)(addr);
    }
    catch {
        return addr;
    }
};
const isSuspectedRegardsKnownAddresses = (tokenAddr, tokenSymbol, chainId) => {
    if (!knownAddresses || !tokenAddr || !tokenSymbol)
        return false;
    const normalizedAddr = normalizeAddress(tokenAddr);
    const normalizedSymbol = removeNonLatinChars(tokenSymbol).toUpperCase();
    const numericChainId = Number(chainId);
    const knownTokens = Object.values(knownAddresses);
    // Only consider known tokens that have chainIds defined (skip those without chainIds)
    return knownTokens.some((known) => {
        const knownSymbolRaw = known?.token?.symbol;
        const knownChains = known?.chainIds;
        if (!knownSymbolRaw || !knownChains)
            return false; // skip unknowns or entries without chainIds
        const knownSymbol = removeNonLatinChars(knownSymbolRaw).toUpperCase();
        if (knownSymbol !== normalizedSymbol)
            return false;
        if (!knownChains.includes(numericChainId))
            return false;
        // same symbol + same chain but different address -> suspected spoof
        return normalizeAddress(known.address) !== normalizedAddr;
    });
};
exports.isSuspectedRegardsKnownAddresses = isSuspectedRegardsKnownAddresses;
const isSuspectedToken = (address, symbol, chainId) => {
    const normalizedAddr = normalizeAddress(address);
    const numericChainId = Number(chainId);
    // 1) lookup known token by address
    const knownToken = knownAddresses?.[normalizedAddr];
    // 2) Only auto-accept if known token exists AND chainIds is defined AND includes chainId
    if (knownToken?.chainIds?.includes(numericChainId)) {
        return null; // trusted
    }
    // 3) Same-symbol spoofing on same chain (different address)
    if ((0, exports.isSuspectedRegardsKnownAddresses)(address, symbol, chainId))
        return 'suspected';
    // 4) Not flagged
    return null;
};
exports.isSuspectedToken = isSuspectedToken;
function getFlags(networkData, chainId, tokenChainId, address, name, symbol, hasSimulationAmount) {
    const isRewardsOrGasTank = ['gasTank', 'rewards'].includes(chainId);
    const onGasTank = chainId === 'gasTank';
    let rewardsType = null;
    if (networkData?.stkWalletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
        rewardsType = 'wallet-rewards';
    if (networkData?.walletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
        rewardsType = 'wallet-vesting';
    const foundFeeToken = gasTankFeeTokens_1.default.find((t) => t.address.toLowerCase() === address.toLowerCase() &&
        (isRewardsOrGasTank ? t.chainId === tokenChainId : t.chainId.toString() === chainId));
    const canTopUpGasTank = !!foundFeeToken && !foundFeeToken?.disableGasTankDeposit && !rewardsType;
    const isFeeToken = address === ethers_1.ZeroAddress ||
        // disable if not in gas tank
        (foundFeeToken && !foundFeeToken.disableAsFeeToken) ||
        chainId === 'gasTank';
    let suspectedType = null;
    if (hasSimulationAmount && !isRewardsOrGasTank) {
        suspectedType = (0, exports.isSuspectedToken)(address, symbol, BigInt(chainId));
    }
    return {
        onGasTank,
        rewardsType,
        canTopUpGasTank,
        isFeeToken,
        isHidden: false,
        suspectedType
    };
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
const mapToken = (token, network, address, opts, hasSimulationAmount, latestAmount) => {
    const { specialErc20Hints, blockTag } = opts;
    let symbol = 'Unknown';
    try {
        symbol = overrideSymbol(address, network.chainId, token.symbol);
    }
    catch (e) {
        console.log(`no symbol was found for token with address ${address} on ${network.name}`);
    }
    let tokenName = symbol;
    try {
        tokenName = token.name;
    }
    catch (e) {
        console.log(`no name was found for a token with a symbol of: ${symbol}, address: ${address} on ${network.name}`);
    }
    const tokenFlags = getFlags({}, network.chainId.toString(), network.chainId, address, tokenName, symbol, hasSimulationAmount);
    if (specialErc20Hints) {
        if (specialErc20Hints.custom.includes(address)) {
            tokenFlags.isCustom = true;
        }
        if (specialErc20Hints.hidden.includes(address)) {
            tokenFlags.isHidden = true;
        }
    }
    const tokenResult = {
        amount: token.amount,
        chainId: network.chainId,
        decimals: Number(token.decimals),
        name: address === '0x0000000000000000000000000000000000000000'
            ? network.nativeAssetName
            : tokenName,
        symbol: address === '0x0000000000000000000000000000000000000000' ? network.nativeAssetSymbol : symbol,
        address,
        flags: tokenFlags
    };
    if (blockTag !== 'both')
        return tokenResult;
    return {
        ...tokenResult,
        // Fallback to the pending amount if latestAmount is not provided
        // Otherwise it will look like someone is receiving tokens and the current amount is 0
        // It's important that we are using ?? here instead of ||
        // because latestAmount can be 0
        latestAmount: latestAmount ?? token.amount,
        pendingAmount: tokenResult.amount
    };
};
exports.mapToken = mapToken;
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
// fetch the amountPostSimulation for the token if set
// otherwise, the token.amount
const getTokenAmount = (token, beforeSimulation) => {
    if (beforeSimulation)
        return token.amount;
    return typeof token.amountPostSimulation === 'bigint' ? token.amountPostSimulation : token.amount;
};
exports.getTokenAmount = getTokenAmount;
const getTokenBalanceInUSD = (token) => {
    const amount = (0, exports.getTokenAmount)(token);
    const { decimals, priceIn } = token;
    const balance = parseFloat((0, ethers_1.formatUnits)(amount, decimals));
    const price = priceIn.find(({ baseCurrency }) => baseCurrency === 'usd')?.price || 0;
    return balance * price;
};
exports.getTokenBalanceInUSD = getTokenBalanceInUSD;
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
    customTokens.forEach((token) => {
        if (token.chainId === chainId && token.standard === 'ERC20') {
            specialErc20Hints.custom.push(token.address);
        }
    });
    tokenPreferences.forEach((token) => {
        if (token.chainId === chainId && token.isHidden) {
            specialErc20Hints.hidden.push(token.address);
        }
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
    keys.forEach((key) => {
        const [collectionAddress, tokenId] = key.split(':');
        if (!collectionAddress)
            return;
        if (tokenId === 'enumerable') {
            hints[collectionAddress] = [];
            return;
        }
        // The key already exists as an enumerable hint. Example:
        // collectionA:enumerable exists and collectionB:id is attempted to be added
        // (it shouldn't be)
        if (keys.includes(`${collectionAddress}:enumerable`)) {
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
            name: portfolio_1.PORTFOLIO_LIB_ERROR_NAMES.NoApiHintsError,
            message: errorMessage,
            level: 'critical'
        };
    }
    const TEN_MINUTES = 10 * 60 * 1000;
    const lastUpdate = lastExternalApiHintsData.lastUpdate;
    const isLastUpdateTooOld = Date.now() - lastUpdate > TEN_MINUTES;
    return {
        name: isLastUpdateTooOld
            ? portfolio_1.PORTFOLIO_LIB_ERROR_NAMES.StaleApiHintsError
            : portfolio_1.PORTFOLIO_LIB_ERROR_NAMES.NonCriticalApiHintsError,
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
//# sourceMappingURL=helpers.js.map