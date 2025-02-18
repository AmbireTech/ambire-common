"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCurrentCashbackZero = exports.isPortfolioGasTankResult = exports.processTokens = exports.tokenFilter = exports.getTokensReadyToLearn = exports.getUpdatedHints = exports.stripExternalHintsAPIResponse = exports.getPinnedGasTankTokens = exports.getAccountPortfolioTotal = exports.addHiddenTokenValueToTotal = exports.getTotal = exports.getTokenBalanceInUSD = exports.getTokenAmount = exports.shouldGetAdditionalPortfolio = exports.validateERC20Token = exports.getFlags = exports.overrideSymbol = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
const gasTankFeeTokens_1 = tslib_1.__importDefault(require("../../consts/gasTankFeeTokens"));
const pinnedTokens_1 = require("../../consts/pinnedTokens");
const account_1 = require("../account/account");
const usdcEMapping = {
    avalanche: '0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664',
    moonriver: '0x748134b5f553f2bcbd78c6826de99a70274bdeb3',
    arbitrum: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    polygon: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
    optimism: '0x7f5c764cbc14f9669b88837ca1490cca17c31607'
};
function overrideSymbol(address, networkId, symbol) {
    // Since deployless lib calls contract and USDC.e is returned as USDC, we need to override the symbol
    if (usdcEMapping[networkId] && usdcEMapping[networkId].toLowerCase() === address.toLowerCase()) {
        return 'USDC.E';
    }
    return symbol;
}
exports.overrideSymbol = overrideSymbol;
function getFlags(networkData, networkId, tokenNetwork, address) {
    const isRewardsOrGasTank = ['gasTank', 'rewards'].includes(networkId);
    const onGasTank = networkId === 'gasTank';
    let rewardsType = null;
    if (networkData?.xWalletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
        rewardsType = 'wallet-rewards';
    if (networkData?.walletClaimableBalance?.address.toLowerCase() === address.toLowerCase())
        rewardsType = 'wallet-vesting';
    const foundFeeToken = gasTankFeeTokens_1.default.find((t) => t.address.toLowerCase() === address.toLowerCase() &&
        (isRewardsOrGasTank ? t.networkId === tokenNetwork : t.networkId === networkId));
    const canTopUpGasTank = foundFeeToken && !foundFeeToken?.disableGasTankDeposit && !rewardsType;
    const isFeeToken = address === ethers_1.ZeroAddress ||
        // disable if not in gas tank
        (foundFeeToken && !foundFeeToken.disableAsFeeToken) ||
        networkId === 'gasTank';
    return {
        onGasTank,
        rewardsType,
        canTopUpGasTank,
        isFeeToken
    };
}
exports.getFlags = getFlags;
const validateERC20Token = async (token, accountId, provider) => {
    const erc20 = new ethers_1.Contract(token?.address, IERC20_json_1.default.abi, provider);
    const type = 'erc20';
    let isValid = true;
    let hasError = false;
    const [balance, symbol, decimals] = (await Promise.all([
        erc20.balanceOf(accountId).catch(() => {
            hasError = true;
        }),
        erc20.symbol().catch(() => {
            hasError = true;
        }),
        erc20.decimals().catch(() => {
            hasError = true;
        })
    ]).catch(() => {
        hasError = true;
        isValid = false;
    })) || [undefined, undefined, undefined];
    if (typeof balance === 'undefined' ||
        typeof symbol === 'undefined' ||
        typeof decimals === 'undefined') {
        isValid = false;
    }
    isValid = isValid && !hasError;
    return [isValid, type];
};
exports.validateERC20Token = validateERC20Token;
const shouldGetAdditionalPortfolio = (account) => {
    return (0, account_1.isSmartAccount)(account);
};
exports.shouldGetAdditionalPortfolio = shouldGetAdditionalPortfolio;
// fetch the amountPostSimulation for the token if set
// otherwise, the token.amount
const getTokenAmount = (token) => {
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
const getTotal = (t, excludeHiddenTokens = true) => t.reduce((cur, token) => {
    const localCur = cur; // Add index signature to the type of localCur
    if (token.flags.isHidden && excludeHiddenTokens)
        return localCur;
    // eslint-disable-next-line no-restricted-syntax
    for (const x of token.priceIn) {
        const currentAmount = localCur[x.baseCurrency] || 0;
        const tokenAmount = Number((0, exports.getTokenAmount)(token)) / 10 ** token.decimals;
        localCur[x.baseCurrency] = currentAmount + tokenAmount * x.price;
    }
    return localCur;
}, {});
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
    return Object.keys(accountPortfolio).reduce((acc, key) => {
        if (excludeNetworks.includes(key))
            return acc;
        const networkData = accountPortfolio[key];
        const tokenList = networkData?.result?.tokens || [];
        let networkTotalAmountUSD = networkData?.result?.total.usd || 0;
        if (!excludeHiddenTokens) {
            networkTotalAmountUSD = (0, exports.addHiddenTokenValueToTotal)(networkTotalAmountUSD, tokenList);
        }
        return acc + networkTotalAmountUSD;
    }, 0);
};
exports.getAccountPortfolioTotal = getAccountPortfolioTotal;
const getPinnedGasTankTokens = (availableGasTankAssets, hasNonZeroTokens, accountId, gasTankTokens) => {
    if (!availableGasTankAssets)
        return [];
    // Don't set pinnedGasTankTokens if the user has > 1 non-zero tokens
    if (hasNonZeroTokens)
        return [];
    return availableGasTankAssets.reduce((acc, token) => {
        const isGasTankToken = !!gasTankTokens.find((gasTankToken) => gasTankToken.symbol.toLowerCase() === token.symbol.toLowerCase());
        const isAlreadyPinned = !!acc.find((accToken) => accToken.symbol.toLowerCase() === token.symbol.toLowerCase());
        if (isGasTankToken || isAlreadyPinned)
            return acc;
        const correspondingPinnedToken = pinnedTokens_1.PINNED_TOKENS.find((pinnedToken) => (!('accountId' in pinnedToken) || pinnedToken.accountId === accountId) &&
            pinnedToken.address === token.address &&
            pinnedToken.networkId === token.network);
        if (correspondingPinnedToken && correspondingPinnedToken.onGasTank) {
            acc.push({
                address: token.address,
                symbol: token.symbol.toUpperCase(),
                amount: 0n,
                networkId: correspondingPinnedToken.networkId,
                decimals: token.decimals,
                priceIn: [
                    {
                        baseCurrency: 'usd',
                        price: token.price
                    }
                ],
                flags: {
                    rewardsType: null,
                    canTopUpGasTank: true,
                    isFeeToken: true,
                    onGasTank: true
                }
            });
        }
        return acc;
    }, []);
};
exports.getPinnedGasTankTokens = getPinnedGasTankTokens;
const stripExternalHintsAPIResponse = (response) => {
    if (!response)
        return null;
    const { erc20s, erc721s, lastUpdate } = response;
    return {
        erc20s,
        erc721s,
        lastUpdate
    };
};
exports.stripExternalHintsAPIResponse = stripExternalHintsAPIResponse;
const getLowercaseAddressArrayForNetwork = (array, networkId) => array
    .filter((item) => !networkId || item.networkId === networkId)
    .map((item) => item.address.toLowerCase());
/**
 * Tasks:
 * - updates the external hints for [network:account] with the latest from the external API
 * - cleans the learned tokens by removing non-ERC20 items
 * - updates the timestamp of learned tokens
 * - returns the updated hints
 */
function getUpdatedHints(
// Can only be null in case of no external api hints
latestHintsFromExternalAPI, tokens, tokenErrors, networkId, storagePreviousHints, key, customTokens, tokenPreferences) {
    const previousHints = { ...storagePreviousHints };
    if (!previousHints.fromExternalAPI)
        previousHints.fromExternalAPI = {};
    if (!previousHints.learnedTokens)
        previousHints.learnedTokens = {};
    const { learnedTokens, learnedNfts } = previousHints;
    const latestERC20HintsFromExternalAPI = latestHintsFromExternalAPI?.erc20s || [];
    const networkLearnedTokens = learnedTokens[networkId] || {};
    // The keys in learnedTokens are addresses of tokens
    const networkLearnedTokenAddresses = Object.keys(networkLearnedTokens);
    // Self-cleaning mechanism for removing non-ERC20 items from the learned tokens.
    // There's a possibility that the discovered tokens (from debug_traceCall or mostly Humanizer) include items that are not ERC20 tokens.
    // For instance, a SmartContract address can be passed as a learned token.
    // Thanks to BalanceGetter, we know which tokens encounter an error when we try to update the portfolio.
    // All the errors are collected in `tokenErrors`, and if we cannot retrieve its balance,
    // the contract returns `bytes('unkn')`, which is equal to `0x756e6b6e`.
    // Note:
    // When we extract tokens from `debug_traceCall`, we are already filtering the tokens the same way as here (relying on BalanceGetter).
    // However, for the Humanizer tokens, we skipped that check because the Humanizer is invoked more frequently on the Sign screen,
    // and this validation may slow down the performance of the page. Because of this, we perform the check here, where we are calling BalanceGetter anyway.
    const unknownBalanceError = '0x756e6b6e';
    const networkLearnedTokenAddressesHavingError = networkLearnedTokenAddresses.filter((tokenAddress) => {
        const hasError = !!tokenErrors?.find((errorToken) => errorToken.address.toLowerCase() === tokenAddress.toLowerCase() &&
            errorToken.error === unknownBalanceError);
        return hasError;
    });
    if (networkLearnedTokenAddresses.length) {
        // Lowercase all addresses outside of the loop for better performance
        const lowercaseNetworkPinnedTokenAddresses = getLowercaseAddressArrayForNetwork(pinnedTokens_1.PINNED_TOKENS, networkId);
        const lowercaseCustomTokens = getLowercaseAddressArrayForNetwork(customTokens, networkId);
        const lowercaseTokenPreferences = getLowercaseAddressArrayForNetwork(tokenPreferences, networkId);
        const networkTokensWithBalance = tokens.filter((token) => token.amount > 0n);
        const lowercaseNetworkTokenAddressesWithBalance = getLowercaseAddressArrayForNetwork(networkTokensWithBalance, networkId);
        const lowercaseERC20HintsFromExternalAPI = latestERC20HintsFromExternalAPI.map((hint) => hint.toLowerCase());
        // Update the timestamp of learned tokens
        // and self-clean non-ERC20 items.
        // eslint-disable-next-line no-restricted-syntax
        for (const address of networkLearnedTokenAddresses) {
            const lowercaseAddress = address.toLowerCase();
            // Delete non-ERC20 items from the learned tokens
            if (networkLearnedTokenAddressesHavingError.find((errorToken) => errorToken.toLowerCase() === lowercaseAddress)) {
                delete learnedTokens[networkId][lowercaseAddress];
                // eslint-disable-next-line no-continue
                continue;
            }
            const isPinned = lowercaseNetworkPinnedTokenAddresses.includes(lowercaseAddress);
            const isCustomToken = lowercaseCustomTokens.includes(lowercaseAddress);
            const isTokenPreference = lowercaseTokenPreferences.includes(lowercaseAddress);
            const isTokenInExternalAPIHints = lowercaseERC20HintsFromExternalAPI.includes(lowercaseAddress);
            const hasBalance = lowercaseNetworkTokenAddressesWithBalance.includes(lowercaseAddress);
            if (!isTokenInExternalAPIHints &&
                !isPinned &&
                !isCustomToken &&
                !isTokenPreference &&
                hasBalance) {
                // Don't set the timestamp back to null if the account doesn't have balance for the token
                // as learnedTokens aren't account specific and one account can have balance for the token
                // while other don't
                learnedTokens[networkId][address] = Date.now().toString();
            }
        }
    }
    // Update the external hints for [network:account] with the latest from the external API
    previousHints.fromExternalAPI[key] = latestHintsFromExternalAPI;
    return {
        fromExternalAPI: previousHints.fromExternalAPI,
        learnedTokens,
        learnedNfts
    };
}
exports.getUpdatedHints = getUpdatedHints;
const getTokensReadyToLearn = (toBeLearnedTokens, resultTokens) => {
    if (!toBeLearnedTokens || !resultTokens || !toBeLearnedTokens.length || !resultTokens.length)
        return [];
    return toBeLearnedTokens.filter((address) => resultTokens.find((resultToken) => resultToken.address === address && resultToken.amount > 0n));
};
exports.getTokensReadyToLearn = getTokensReadyToLearn;
const tokenFilter = (token, nativeToken, network, hasNonZeroTokens, additionalHints, isTokenPreference) => {
    // Never add ERC20 tokens that represent the network's native token.
    // For instance, on Polygon, we have this token: `0x0000000000000000000000000000000000001010`.
    // It mimics the native POL token (same symbol, same amount) and is shown twice in the Dashboard.
    // From a user's perspective, the token is duplicated and counted twice in the balance.
    const isERC20NativeRepresentation = (token.symbol === nativeToken?.symbol ||
        network.oldNativeAssetSymbols?.includes(token.symbol)) &&
        token.amount === nativeToken.amount &&
        token.address !== ethers_1.ZeroAddress;
    if (isERC20NativeRepresentation)
        return false;
    // always include tokens added as a preference
    if (isTokenPreference)
        return true;
    // always include > 0 amount and native token
    if (token.amount > 0 || token.address === ethers_1.ZeroAddress)
        return true;
    const isPinned = !!pinnedTokens_1.PINNED_TOKENS.find((pinnedToken) => {
        return pinnedToken.networkId === network.id && pinnedToken.address === token.address;
    });
    // make the comparison to lowercase as otherwise, it doesn't work
    const hintsLowerCase = additionalHints
        ? additionalHints.map((hint) => hint.toLowerCase())
        : undefined;
    const isInAdditionalHints = hintsLowerCase?.includes(token.address.toLowerCase());
    // if the amount is 0
    // return the token if it's pinned and requested
    const pinnedRequested = isPinned && !hasNonZeroTokens;
    return isInAdditionalHints || pinnedRequested;
};
exports.tokenFilter = tokenFilter;
/**
 * Filter the TokenResult[] by certain criteria (please refer to `tokenFilter` for more details)
 * and set the token.flags.isHidden flag.
 */
const processTokens = (tokenResults, network, hasNonZeroTokens, additionalHints, tokenPreferences, customTokens) => {
    // We need to know the native token in order to execute our filtration logic in tokenFilter.
    // For performance reasons, we define it here once, instead of during every single iteration in the reduce method.
    const nativeToken = tokenResults.find((token) => token.address === ethers_1.ZeroAddress);
    return tokenResults.reduce((tokens, tokenResult) => {
        const token = { ...tokenResult };
        const isGasTankOrRewards = token.flags.onGasTank || token.flags.rewardsType;
        const preference = tokenPreferences?.find((tokenPreference) => {
            return tokenPreference.address === token.address && tokenPreference.networkId === network.id;
        });
        if (preference) {
            token.flags.isHidden = preference.isHidden;
        }
        token.flags.isCustom =
            !isGasTankOrRewards &&
                !!customTokens.find((customToken) => customToken.address === token.address && customToken.networkId === network.id);
        if ((0, exports.tokenFilter)(token, nativeToken, network, hasNonZeroTokens, additionalHints, !!preference))
            tokens.push(token);
        return tokens;
    }, []);
};
exports.processTokens = processTokens;
const isPortfolioGasTankResult = (result) => {
    return !!result && 'gasTankTokens' in result && Array.isArray(result.gasTankTokens);
};
exports.isPortfolioGasTankResult = isPortfolioGasTankResult;
const isCurrentCashbackZero = (resBalance) => {
    const currentCashback = resBalance?.[0]?.cashback;
    if (currentCashback === undefined)
        return false;
    try {
        return BigInt(currentCashback) === 0n;
    }
    catch {
        return false;
    }
};
exports.isCurrentCashbackZero = isCurrentCashbackZero;
//# sourceMappingURL=helpers.js.map