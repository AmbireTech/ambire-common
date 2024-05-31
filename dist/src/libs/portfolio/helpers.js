"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenFilter = exports.getUpdatedHints = exports.getPinnedGasTankTokens = exports.getTotal = exports.getTokenAmount = exports.shouldGetAdditionalPortfolio = exports.validateERC20Token = exports.getFlags = exports.overrideSymbol = void 0;
const ethers_1 = require("ethers");
const IERC20_json_1 = __importDefault(require("../../../contracts/compiled/IERC20.json"));
const gasTankFeeTokens_1 = __importDefault(require("../../consts/gasTankFeeTokens"));
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
    const canTopUpGasTank = foundFeeToken && !foundFeeToken?.disableGasTankDeposit;
    const isFeeToken = address === ethers_1.ZeroAddress || !!foundFeeToken;
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
const getTotal = (t) => t.reduce((cur, token) => {
    const localCur = cur; // Add index signature to the type of localCur
    if (token.isHidden)
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
// Updates the previous hints storage with the latest portfolio get result.
function getUpdatedHints(result, networkId, storagePreviousHints, key, tokenPreferences) {
    const hints = { ...storagePreviousHints };
    if (!hints.fromExternalAPI)
        hints.fromExternalAPI = {};
    if (!hints.learnedTokens)
        hints.learnedTokens = {};
    const erc20s = result.tokens.filter((token) => token.amount > 0n).map((token) => token.address);
    const erc721s = Object.fromEntries(result.collections.map((collection) => [
        collection.address,
        result.hints.erc721s[collection.address]
    ]));
    const previousHintsFromExternalAPI = (hints.fromExternalAPI && hints.fromExternalAPI[key] && hints.fromExternalAPI[key]?.erc20s) ||
        [];
    hints.fromExternalAPI[key] = { erc20s, erc721s };
    if (Object.keys(previousHintsFromExternalAPI).length > 0) {
        // eslint-disable-next-line no-restricted-syntax
        for (const address of erc20s) {
            const isPinned = pinnedTokens_1.PINNED_TOKENS.some((pinned) => pinned.address.toLowerCase() === address.toLowerCase() && pinned.networkId === networkId);
            const isTokenPreference = tokenPreferences.some((preference) => preference.address.toLowerCase() === address.toLowerCase() &&
                preference.networkId === networkId);
            if (!previousHintsFromExternalAPI.includes(address) && !isPinned && !isTokenPreference) {
                if (!hints.learnedTokens[networkId])
                    hints.learnedTokens[networkId] = {};
                hints.learnedTokens[networkId][address] = Date.now().toString();
            }
        }
    }
    return hints;
}
exports.getUpdatedHints = getUpdatedHints;
const tokenFilter = (token, network, hasNonZeroTokens, additionalHints, tokenPreferences) => {
    const isTokenPreference = tokenPreferences?.find((tokenPreference) => {
        return tokenPreference.address === token.address && tokenPreference.networkId === network.id;
    });
    if (isTokenPreference) {
        token.isHidden = isTokenPreference.isHidden;
    }
    // always include > 0 amount and native token
    if (token.amount > 0 || token.address === ethers_1.ZeroAddress)
        return true;
    const isPinned = !!pinnedTokens_1.PINNED_TOKENS.find((pinnedToken) => {
        return pinnedToken.networkId === network.id && pinnedToken.address === token.address;
    });
    const isInAdditionalHints = additionalHints?.includes(token.address);
    // if the amount is 0
    // return the token if it's pinned and requested
    const pinnedRequested = isPinned && !hasNonZeroTokens;
    return !!isTokenPreference || isInAdditionalHints || pinnedRequested;
};
exports.tokenFilter = tokenFilter;
//# sourceMappingURL=helpers.js.map