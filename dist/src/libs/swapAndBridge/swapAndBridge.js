"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapBannedToValidAddr = exports.lifiMapNativeToAddr = exports.isTxnBridge = exports.isNoFeeToken = exports.getSwapSponsorship = exports.getSwapAndBridgeRequestParams = exports.getSwapAndBridgeCalls = exports.getSlippage = exports.getSentPartOfSwap = exports.getRouteOutputValuesForSorting = exports.getLink = exports.getFeeTokenForSponsorship = exports.getBannedToTokenList = exports.getActiveRoutesUpdateInterval = exports.getActiveRoutesLowestServiceTime = exports.getActiveRoutesForAccount = exports.enrichRouteWithOutputTokenPrice = exports.convertNullAddressToZeroAddressIfNeeded = exports.addCustomTokensIfNeeded = exports.calculateAmountWarnings = exports.getIsNetworkSupported = exports.getIsIntentRoute = exports.getIsBridgeRoute = exports.convertPortfolioTokenToSwapAndBridgeToToken = exports.getIsTokenEligibleForSwapAndBridge = exports.sortPortfolioTokenList = exports.sortTokenListResponse = exports.sortNativeTokenFirst = exports.attemptToSortTokensByMarketCap = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const viem_1 = require("viem");
const constants_1 = require("../../services/socketv3/constants");
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
const deploy_1 = require("../../consts/deploy");
const intervals_1 = require("../../consts/intervals");
const extremeSwapLoss_1 = require("../../consts/safeguards/extremeSwapLoss");
const helper_1 = require("../../controllers/signAccountOp/helper");
const constants_2 = require("../../services/cowswap/constants");
const consts_1 = require("../../services/lifi/consts");
const formatters_1 = require("../../utils/numbers/formatters");
const account_1 = require("../account/account");
const submittedAccountOp_1 = require("../accountOp/submittedAccountOp");
const types_1 = require("../defiPositions/types");
const helpers_1 = require("../portfolio/helpers");
const extremeSwapLoss_2 = require("../safeguards/extremeSwapLoss");
const amount_1 = require("../transfer/amount");
/**
 * Maps banned (or outdated) token addresses to their "valid" replacements,
 * "valid" meaning Swap & Bridge gives more relevant results with these replacements.
 * There are two use cases:
 *
 * 1. Token replacement (e.g., EURe, GBP.e, CELO): Maps banned (or outdated) addresses
 *    to the "valid" ones. When these banned addresses are used - we automatically
 *    map them to the "valid" address (when selected) to ensure routes can be found.
 *
 * 2. Token filtering (e.g., JPYC variants): Uses identity mapping (same address on both sides).
 *    These addresses are only used to filter them out from the "to" token list display.
 *    The valid token is added separately via addCustomTokensIfNeeded(), so these banned
 *    variants ensure duplication is avoided in the UI.
 */
const getBannedToValidAddresses = () => {
    /** ****************************************************
     *        MAKE SURE ADDRESSES ARE CHECKSUMMED
     ****************************************************** */
    const bannedEurePolygon = '0xE0aEa583266584DafBB3f9C3211d5588c73fEa8d';
    const validEurePolygon = '0x18ec0A6E18E5bc3784fDd3a3634b31245ab704F6';
    /** ****************************************************
     *        MAKE SURE ADDRESSES ARE CHECKSUMMED
     ****************************************************** */
    const bannedEureGnosis = '0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430';
    const validEureGnosis = '0xcB444e90D8198415266c6a2724b7900fb12FC56E';
    /** ****************************************************
     *        MAKE SURE ADDRESSES ARE CHECKSUMMED
     ****************************************************** */
    const bannedCelo = '0x471EcE3750Da237f93B8E339c536989b8978a438';
    const validCelo = ethers_1.ZeroAddress;
    /** ****************************************************
     *        MAKE SURE ADDRESSES ARE CHECKSUMMED
     ****************************************************** */
    const bannedGbpeGnosis = '0x8E34bfEC4f6Eb781f9743D9b4af99CD23F9b7053';
    const validGbpeGnosis = '0x5Cb9073902F2035222B9749F8fB0c9BFe5527108';
    /** ****************************************************
     *        MAKE SURE ADDRESSES ARE CHECKSUMMED
     ****************************************************** */
    const bannedJPYC = '0x431D5dfF03120AFA4bDf332c61A6e1766eF37BDB';
    const bannedJPYCPos = '0x6AE7Dfc73E0dDE2aa99ac063DcF7e8A63265108c';
    const bannedJPYCv1 = '0x2370f9d504c7a6E775bf6E14B3F12846b594cD53';
    const bannedJPYsuper = '0xFBb291570DE4B87353B1e0f586Df97A1eD856470';
    return {
        '1': {
            [bannedJPYC]: bannedJPYC,
            [bannedJPYCv1]: bannedJPYCv1
        },
        '137': {
            [bannedEurePolygon]: validEurePolygon,
            [bannedJPYC]: bannedJPYC,
            [bannedJPYCPos]: bannedJPYCPos,
            [bannedJPYsuper]: bannedJPYsuper
        },
        '100': {
            [bannedEureGnosis]: validEureGnosis,
            [bannedGbpeGnosis]: validGbpeGnosis
        },
        '42220': {
            [bannedCelo]: validCelo
        },
        '43114': {
            [bannedJPYC]: bannedJPYC
        }
    };
};
const getBannedToTokenList = (chainId) => {
    const list = getBannedToValidAddresses();
    if (!list[chainId])
        return [];
    return Object.keys(list[chainId]);
};
exports.getBannedToTokenList = getBannedToTokenList;
/**
 * Everything the order of a token depends on, read once per token instead of on
 * every comparison - which for a large portfolio is around twenty times each.
 */
const getTokenSortKey = (token) => ({
    isPending: typeof token.amountPostSimulation === 'bigint' &&
        token.amountPostSimulation !== BigInt(token.amount),
    balanceInUSD: (0, helpers_1.getTokenBalanceInUSD)(token)
});
const compareTokenSortKeys = (a, b) => {
    // Pending tokens go on top
    if (a.isPending !== b.isPending)
        return a.isPending ? -1 : 1;
    // Otherwise, higher balance comes first
    if (a.balanceInUSD !== b.balanceInUSD)
        return b.balanceInUSD - a.balanceInUSD;
    return 0;
};
const attemptToSortTokensByMarketCap = async ({ fetch, chainId, tokens, featureFlags }) => {
    if (!featureFlags.isFeatureEnabled('tokenPrices') ||
        !featureFlags.isFeatureEnabled('tokenAndDefiAutoDiscovery'))
        return tokens;
    try {
        const tokenAddressesByMarketCapRes = await fetch(`https://cena.ambire.com/api/v3/lists/byMarketCap/${chainId}`);
        if (tokenAddressesByMarketCapRes.status !== 200)
            throw new Error(`Got status ${tokenAddressesByMarketCapRes.status} from the API.`);
        const tokenAddressesByMarketCap = await tokenAddressesByMarketCapRes.json();
        // Highest market cap comes first from the response
        const addressPriority = new Map(tokenAddressesByMarketCap.data.map((addr, index) => [addr, index]));
        // Sort the result by the market cap response order position (highest first)
        return tokens.sort((a, b) => {
            const aPriority = addressPriority.get(a.address);
            const bPriority = addressPriority.get(b.address);
            if (aPriority !== undefined && bPriority !== undefined)
                return aPriority - bPriority;
            if (aPriority !== undefined)
                return -1;
            if (bPriority !== undefined)
                return 1;
            return 0;
        });
    }
    catch (e) {
        // Fail silently, no biggie
        console.error(`Sorting Swap & Bridge tokens by market for network with id ${chainId} failed`, e);
        return tokens;
    }
};
exports.attemptToSortTokensByMarketCap = attemptToSortTokensByMarketCap;
const sortNativeTokenFirst = (tokens) => {
    return tokens.sort((a, b) => {
        if (a.address === ethers_1.ZeroAddress)
            return -1;
        if (b.address === ethers_1.ZeroAddress)
            return 1;
        return 0;
    });
};
exports.sortNativeTokenFirst = sortNativeTokenFirst;
const sortTokenListResponse = (tokenListResponse, accountPortfolioTokenList) => {
    const sortKeyByAddress = new Map(accountPortfolioTokenList.map((t) => [t.address.toLowerCase(), getTokenSortKey(t)]));
    // The portfolio lookup is done once per token rather than on every comparison. The
    // service provider's list runs to thousands of tokens, so the sort makes tens of
    // thousands of comparisons, and lowercasing both addresses in each one is what made
    // deriving this list block the JS thread for hundreds of milliseconds.
    return tokenListResponse
        .map((token) => ({ token, sortKey: sortKeyByAddress.get(token.address.toLowerCase()) }))
        .sort((a, b) => {
        // Tokens in portfolio should come first
        if (a.sortKey && !b.sortKey)
            return -1;
        if (!a.sortKey && b.sortKey)
            return 1;
        if (a.sortKey && b.sortKey)
            return compareTokenSortKeys(a.sortKey, b.sortKey);
        // Otherwise, don't change, persist the order from the service provider
        return 0;
    })
        .map(({ token }) => token);
};
exports.sortTokenListResponse = sortTokenListResponse;
const sortPortfolioTokenList = (accountPortfolioTokenList) => {
    return accountPortfolioTokenList
        .map((token) => ({ token, sortKey: getTokenSortKey(token), symbol: token.symbol || '' }))
        .sort((a, b) => {
        const comparisonResult = compareTokenSortKeys(a.sortKey, b.sortKey);
        if (comparisonResult !== 0)
            return comparisonResult;
        // Otherwise, just alphabetical
        return a.symbol.localeCompare(b.symbol);
    })
        .map(({ token }) => token);
};
exports.sortPortfolioTokenList = sortPortfolioTokenList;
/**
 * Determines if a token is eligible for swapping and bridging.
 * Not all tokens in the portfolio are eligible.
 */
const getIsTokenEligibleForSwapAndBridge = (token, requirePositiveBalance = true, requirePrice = false) => {
    const flagsRequirement = 
    // The same token can be in the Gas Tank (or as a Reward) and in the portfolio.
    // Exclude the one in the Gas Tank (swapping Gas Tank tokens is not supported).
    !token.flags.onGasTank &&
        // And exclude the rewards ones (swapping rewards is not supported).
        !token.flags.rewardsType &&
        // Borrow tokens (e.g. variableDebt tokens) are protocol accounting assets
        // and are not transferable/swappable by design.
        token.flags.defiTokenType !== types_1.AssetType.Borrow;
    // Tokens without a known USD price most prob can't be quoted reliably, so exclude them
    // from the list when the caller opts in (e.g. the Swap & Bridge "form" tokens).
    // Custom tokens are exempt - the user explicitly imported them and likely wants
    // to use them for something (maybe swap or bridge).
    if (requirePrice && !token.flags.isCustom && (0, helpers_1.getTokenUsdPrice)(token) <= 0) {
        return false;
    }
    if (!requirePositiveBalance) {
        return flagsRequirement;
    }
    // Prevent filtering out tokens with amountPostSimulation = 0 if the actual amount is positive.
    // This ensures the token remains in the list when sending the full amount of it
    const amount = token.amountPostSimulation === 0n && token.amount > 0n
        ? token.amount
        : (token.amountPostSimulation ?? token.amount);
    const hasPositiveBalance = Number(amount) > 0;
    return flagsRequirement && hasPositiveBalance;
};
exports.getIsTokenEligibleForSwapAndBridge = getIsTokenEligibleForSwapAndBridge;
const convertPortfolioTokenToSwapAndBridgeToToken = (portfolioToken, chainId) => {
    const { address, decimals, symbol } = portfolioToken;
    // Although name and symbol will be the same, it's better than having "No name" in the UI (valid use-case)
    const name = symbol;
    // Fine for not having both icon props, because this would fallback to the
    // icon discovery method used for the portfolio tokens
    const icon = '';
    return { address, chainId, decimals, symbol, name, icon };
};
exports.convertPortfolioTokenToSwapAndBridgeToToken = convertPortfolioTokenToSwapAndBridgeToToken;
/**
 * Return the lowest active route service time in MILLISECONDS
 */
const getActiveRoutesLowestServiceTime = (activeRoutes) => {
    const serviceTimes = [];
    activeRoutes.forEach((r) => {
        r.route?.userTxs.forEach((tx) => {
            if (tx.serviceTime) {
                serviceTimes.push(tx.serviceTime);
            }
        });
    });
    const time = serviceTimes.sort((a, b) => a - b)[0];
    if (!time)
        return intervals_1.UPDATE_SWAP_AND_BRIDGE_QUOTE_INTERVAL;
    return time * 1000;
};
exports.getActiveRoutesLowestServiceTime = getActiveRoutesLowestServiceTime;
const getActiveRoutesUpdateInterval = (minServiceTime) => {
    if (!minServiceTime)
        return 30000;
    // the absolute minimum needs to be 30s, it's not a game changer
    // if the user waits an additional 15s to get a status check
    // but it's a game changer if we brick the API with a 429
    if (minServiceTime <= 300)
        return 30000;
    if (minServiceTime <= 600)
        return 60000;
    return 30000;
};
exports.getActiveRoutesUpdateInterval = getActiveRoutesUpdateInterval;
// If you have approval that has not been spent (in some smart contracts), the transaction may revert
const buildRevokeApprovalIfNeeded = async (userTx, account, state, provider) => {
    if (!userTx.approvalData)
        return;
    const erc20Contract = new ethers_1.Contract(userTx.approvalData.approvalTokenAddress, IERC20_json_1.default.abi, provider);
    const requiredAmount = !(0, account_1.isBasicAccount)(account, state)
        ? BigInt(userTx.approvalData.minimumApprovalAmount)
        : ethers_1.MaxUint256;
    const approveCallData = erc20Contract.interface.encodeFunctionData('approve', [
        userTx.approvalData.allowanceTarget,
        requiredAmount
    ]);
    let fails = false;
    try {
        await provider.call({
            from: account.addr,
            to: userTx.approvalData.approvalTokenAddress,
            data: approveCallData
        });
    }
    catch {
        fails = true;
    }
    if (!fails)
        return;
    return {
        id: `${userTx.activeRouteId}-revoke-approval`,
        to: userTx.approvalData.approvalTokenAddress,
        value: BigInt('0'),
        data: erc20Contract.interface.encodeFunctionData('approve', [
            userTx.approvalData.allowanceTarget,
            BigInt(0)
        ]),
        activeRouteId: userTx.activeRouteId
    };
};
// check if the user the needed amount already approved and if
// he does, do not build a new approval
const shouldBuildApproval = async (userTx, account, provider) => {
    if (!userTx.approvalData)
        return {
            shouldBuild: false,
            allowance: 0n
        };
    const erc20Contract = new ethers_1.Contract(userTx.approvalData.approvalTokenAddress, IERC20_json_1.default.abi, provider);
    const allowanceCallData = erc20Contract.interface.encodeFunctionData('allowance', [
        account.addr,
        userTx.approvalData.allowanceTarget
    ]);
    let allowance = 0n;
    try {
        allowance = BigInt(await provider.call({
            from: account.addr,
            to: userTx.approvalData.approvalTokenAddress,
            data: allowanceCallData
        }));
    }
    catch (e) {
        console.log(`Checking allowance to ${userTx.approvalData.approvalTokenAddress} failed`, e);
        // if the provider fails for whatever reason, keep it safe
        // and make an approval
        return {
            shouldBuild: true
        };
    }
    return {
        shouldBuild: allowance < BigInt(userTx.approvalData.minimumApprovalAmount),
        allowance
    };
};
const getSwapAndBridgeCalls = async (userTx, account, provider, state) => {
    const calls = [];
    const allowanceData = await shouldBuildApproval(userTx, account, provider);
    if (userTx.approvalData && allowanceData.shouldBuild) {
        const erc20Interface = new ethers_1.Interface(IERC20_json_1.default.abi);
        // if the allowance is not 0 and not MAX but anything between,
        // check if we need to do a revoke first
        // USDT on Ethereum being one example for this
        if (allowanceData.allowance !== undefined &&
            allowanceData.allowance > 0n &&
            allowanceData.allowance < deploy_1.MAX_UINT256) {
            const revokeApproval = await buildRevokeApprovalIfNeeded(userTx, account, state, provider);
            if (revokeApproval)
                calls.push(revokeApproval);
        }
        calls.push({
            id: `${userTx.activeRouteId}-approval`,
            to: userTx.approvalData.approvalTokenAddress,
            value: BigInt('0'),
            data: erc20Interface.encodeFunctionData('approve', [
                userTx.approvalData.allowanceTarget,
                BigInt(userTx.approvalData.minimumApprovalAmount)
            ]),
            activeRouteId: userTx.activeRouteId
        });
    }
    calls.push({
        id: userTx.activeRouteId,
        to: userTx.txTarget,
        value: BigInt(userTx.value),
        data: userTx.txData,
        activeRouteId: userTx.activeRouteId,
        ...(userTx.cowSwapOrder ? { cowSwapOrder: userTx.cowSwapOrder } : {})
    });
    return calls;
};
exports.getSwapAndBridgeCalls = getSwapAndBridgeCalls;
const getSwapAndBridgeRequestParams = async (userTx, chainId, account, provider, state, paymasterService, quote) => {
    return {
        calls: await getSwapAndBridgeCalls(userTx, account, provider, state),
        meta: {
            chainId,
            accountAddr: account.addr,
            activeRouteId: userTx.activeRouteId,
            isSwapAndBridgeCall: true,
            paymasterService,
            swapTxn: userTx,
            quote
        }
    };
};
exports.getSwapAndBridgeRequestParams = getSwapAndBridgeRequestParams;
const getIsBridgeRoute = (route) => {
    return route.fromChainId !== route.toChainId;
};
exports.getIsBridgeRoute = getIsBridgeRoute;
/** Returns whether the route completes asynchronously after the user's transaction. */
const getIsIntentRoute = (route) => {
    return (0, exports.getIsBridgeRoute)(route) || route.providerId === 'cowswap' || route.isIntent === true;
};
exports.getIsIntentRoute = getIsIntentRoute;
/**
 * Checks if a network is supported by our Swap & Bridge service provider. As of v4.43.0
 * there are 16 networks supported, so user could have (many) custom networks that are not.
 */
const getIsNetworkSupported = (supportedChainIds, network) => {
    // Assume supported if missing (and receive no results when attempting to use
    // a not-supported network) than the alternative - blocking the UI.
    if (!supportedChainIds.length || !network)
        return true;
    return supportedChainIds.includes(network.chainId);
};
exports.getIsNetworkSupported = getIsNetworkSupported;
const getActiveRoutesForAccount = (accountAddress, activeRoutes) => {
    return activeRoutes.filter((r) => (0, ethers_1.getAddress)(r.route?.sender || r.route?.userAddress || '') === accountAddress);
};
exports.getActiveRoutesForAccount = getActiveRoutesForAccount;
/**
 * Since v4.41.0 we request the shortlist from our service provider, which might
 * not include the Ambire $WALLET token. So adding it manually on the supported chains.
 */
const addCustomTokensIfNeeded = ({ tokens, chainId }) => {
    const newTokens = [...tokens];
    if (chainId === 1) {
        const shouldAddAmbireWalletToken = newTokens.every((t) => t.address !== constants_1.AMBIRE_WALLET_TOKEN_ON_ETHEREUM.address);
        if (shouldAddAmbireWalletToken)
            newTokens.unshift(constants_1.AMBIRE_WALLET_TOKEN_ON_ETHEREUM);
        const shouldAddJPYCToken = newTokens.every((t) => t.address !== constants_1.JPYC_TOKEN.address);
        if (shouldAddJPYCToken)
            newTokens.unshift({ ...constants_1.JPYC_TOKEN, chainId: 1 });
    }
    if (chainId === 137) {
        const shouldAddJPYCToken = newTokens.every((t) => t.address !== constants_1.JPYC_TOKEN.address);
        if (shouldAddJPYCToken)
            newTokens.unshift({ ...constants_1.JPYC_TOKEN, chainId: 137 });
    }
    if (chainId === 43114) {
        const shouldAddJPYCToken = newTokens.every((t) => t.address !== constants_1.JPYC_TOKEN.address);
        if (shouldAddJPYCToken)
            newTokens.unshift({ ...constants_1.JPYC_TOKEN, chainId: 43114 });
    }
    if (chainId === 8453) {
        // Disabled (maybe temporarily) as of v2.94.0, because of the decision to remove
        // $WALLET liquidity on Base and consolidate it into the Ethereum liquidity.
        //   const shouldAddAmbireWalletToken = newTokens.every(
        //     (t) => t.address !== AMBIRE_WALLET_TOKEN_ON_BASE.address
        //   )
        //   if (shouldAddAmbireWalletToken) newTokens.unshift(AMBIRE_WALLET_TOKEN_ON_BASE)
    }
    return newTokens;
};
exports.addCustomTokensIfNeeded = addCustomTokensIfNeeded;
// the celo native token is at an address 0x471EcE3750Da237f93B8E339c536989b8978a438
// and LiFi doesn't work if we pass address 0 for this. We map it only for
// lifi to make the swap work in this case
const lifiMapNativeToAddr = (chainId, tokenAddr) => {
    if (tokenAddr !== ethers_1.ZeroAddress)
        return tokenAddr;
    // celo chain
    if (chainId !== 42220)
        return tokenAddr;
    return '0x471EcE3750Da237f93B8E339c536989b8978a438';
};
exports.lifiMapNativeToAddr = lifiMapNativeToAddr;
/**
 * Map the token address back to native when needed
 */
const mapBannedToValidAddr = (chainId, tokenAddr) => {
    const list = getBannedToValidAddresses()[chainId];
    if (!list || !list[tokenAddr])
        return tokenAddr;
    return list[tokenAddr];
};
exports.mapBannedToValidAddr = mapBannedToValidAddr;
const isNoFeeToken = (chainId, tokenAddr) => {
    /** ****************************************************
     *        MAKE SURE ADDRESSES ARE CHECKSUMMED
     ****************************************************** */
    if (chainId === 1) {
        // stETH
        return tokenAddr === '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84';
    }
    return false;
};
exports.isNoFeeToken = isNoFeeToken;
const getSlippage = (fromAsset, fromAmount, upperBoundary, delimeter) => {
    // make sure the slippage doesn't exceed 100$
    // we do so by having a base of 0.005
    // to have a slippage of 100$, we need a fromAmountInUsd of at least 20000$,
    // so each time the from amount makes a jump of 20000$, we lower
    // the slippage by half
    const fromAmountInUsd = (0, helper_1.getTokenUsdAmount)(fromAsset, fromAmount);
    return Number(fromAmountInUsd) < 400
        ? upperBoundary
        : (delimeter / Math.ceil(Number(fromAmountInUsd) / 20000)).toPrecision(2);
};
exports.getSlippage = getSlippage;
const calculateAmountWarnings = (selectedRoute, fromAmountInFiat, fromAmount, fromSelectedTokenDecimals) => {
    if (!selectedRoute)
        return null;
    let inputValueInUsd = 0;
    const outputValueInUsd = selectedRoute.outputValueInUsd;
    try {
        inputValueInUsd = Number(fromAmountInFiat);
    }
    catch {
        // silent fail
    }
    if (!inputValueInUsd)
        return null;
    try {
        const sanitizedFromAmount = (0, amount_1.getSanitizedAmount)(fromAmount, fromSelectedTokenDecimals);
        const bigintFromAmount = (0, ethers_1.parseUnits)(sanitizedFromAmount, fromSelectedTokenDecimals);
        if (bigintFromAmount !== BigInt(selectedRoute.fromAmount))
            return null;
        // Can be negative if the output is higher
        // (possible during arbitrage swaps). We must NOT bail out here: even when
        // the quote difference is favorable, a very low minAmountOut can still
        // expose the user to dangerous slippage, which is checked further below.
        const difference = inputValueInUsd - outputValueInUsd;
        const percentageDiff = (difference / inputValueInUsd) * 100;
        // try to calculate the slippage
        const txn = selectedRoute.userTxs[selectedRoute.userTxs.length - 1];
        if (!txn)
            throw new Error('no userTxs in selectedRoute');
        const minAmountOutInWei = BigInt(txn.minAmountOut);
        const minInUsd = (0, formatters_1.safeTokenAmountAndNumberMultiplication)(minAmountOutInWei, selectedRoute.toToken.decimals, Number(selectedRoute.toToken.priceUSD));
        const minInUsdNumber = Number(minInUsd);
        const allowedSlippage = Number(inputValueInUsd) < 400
            ? 1.05
            : Number((0.005 / Math.ceil(Number(inputValueInUsd) / 20000)).toPrecision(2)) * 100 + 0.01;
        // Percentage of the loss relative to the amount the user is putting in (not the quote),
        // so it stays consistent with `estimatedLossUsd` below, which is also input-based. Using
        // the quote as the denominator would understate this when the quote itself is already
        // far below the input (large price impact already baked into the quote).
        const possibleSlippage = (1 - minInUsdNumber / inputValueInUsd) * 100;
        const quoteLossUsd = (0, extremeSwapLoss_2.getSwapQuoteLossUsd)(inputValueInUsd, outputValueInUsd);
        const slippageLossUsd = (0, extremeSwapLoss_2.getSwapSlippageLossUsd)(inputValueInUsd, minInUsdNumber);
        const estimatedLossUsd = (0, extremeSwapLoss_2.getSwapEstimatedLossUsd)(inputValueInUsd, outputValueInUsd, minInUsdNumber);
        const isExtreme = (0, extremeSwapLoss_2.isExtremeSwapLoss)(estimatedLossUsd);
        const isElevatedPriceImpact = percentageDiff >= extremeSwapLoss_1.HIGH_PRICE_IMPACT_PERCENT_THRESHOLD;
        // It seems a bit odd to display a slippage warning only if the difference
        // is > $50?
        const isElevatedSlippage = possibleSlippage > allowedSlippage && slippageLossUsd > extremeSwapLoss_1.SLIPPAGE_MIN_QUOTE_DIFF_USD;
        if (isExtreme && slippageLossUsd > quoteLossUsd) {
            return {
                type: 'slippageImpact',
                possibleSlippage,
                minInUsd: minInUsdNumber,
                minInToken: (0, ethers_1.formatUnits)(minAmountOutInWei, selectedRoute.toToken.decimals),
                symbol: selectedRoute.toToken.symbol,
                estimatedLossUsd: slippageLossUsd,
                severity: 'extreme'
            };
        }
        if (isExtreme || isElevatedPriceImpact) {
            return {
                type: 'highPriceImpact',
                percentageDiff,
                estimatedLossUsd: quoteLossUsd,
                severity: isExtreme ? 'extreme' : 'elevated'
            };
        }
        if (isElevatedSlippage) {
            return {
                type: 'slippageImpact',
                possibleSlippage,
                minInUsd: minInUsdNumber,
                minInToken: (0, ethers_1.formatUnits)(minAmountOutInWei, selectedRoute.toToken.decimals),
                symbol: selectedRoute.toToken.symbol,
                estimatedLossUsd: slippageLossUsd,
                severity: 'elevated'
            };
        }
        return null;
    }
    catch {
        return null;
    }
};
exports.calculateAmountWarnings = calculateAmountWarnings;
const getLink = (route) => {
    const providerId = route.route ? route.route.providerId : route.serviceProviderId;
    if (providerId === 'cowswap') {
        return `${constants_2.COWSWAP_EXPLORER_URL}/orders/${route.activeRouteId}`;
    }
    if (providerId === 'socket' || providerId === 'socketv3')
        return `${constants_1.SOCKET_EXPLORER_URL}/tx/${route.userTxHash}`;
    return `${consts_1.LIFI_EXPLORER_URL}/tx/${route.userTxHash}`;
};
exports.getLink = getLink;
const isTxnBridge = (txn) => {
    return txn.fromAsset.chainId !== txn.toAsset.chainId;
};
exports.isTxnBridge = isTxnBridge;
const convertNullAddressToZeroAddressIfNeeded = (addr) => addr === viem_1.ethAddress ? viem_1.zeroAddress : addr;
exports.convertNullAddressToZeroAddressIfNeeded = convertNullAddressToZeroAddressIfNeeded;
/**
 * Get the swap sponsorship details.
 * We need the native price so we can later understand if the cost
 * of the txn in USD is less than the swap fee to sponsor it.
 * No sponsorships in og mode.
 * Also, to calculate the fee in USD, we multiply the full from
 * amount in USD to the fee percent
 */
const getSwapSponsorship = ({ 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
isErc4337Enabled, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
hasConvinienceFee, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
nativePrice, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
fromAmountInUsd, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
feeTokenPriceInUsd, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
feeTokenDecimals, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
providerId, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
isIntent, 
// eslint-disable-next-line @typescript-eslint/no-unused-vars
feePercent }) => {
    // disable sponsorship for now as it's too buggy and inconsistent
    return undefined;
    // if (
    //   !isErc4337Enabled ||
    //   !hasConvinienceFee ||
    //   !nativePrice ||
    //   !fromAmountInUsd ||
    //   !feeTokenPriceInUsd ||
    //   !feeTokenDecimals ||
    //   (providerId === 'uniswap' && isIntent) ||
    //   feePercent === 0
    // )
    //   return undefined
    // return {
    //   nativePrice,
    //   swapFeeInUsd: (fromAmountInUsd * FEE_PERCENT) / 100,
    //   feeTokenPriceInUsd,
    //   feeTokenDecimals
    // }
};
exports.getSwapSponsorship = getSwapSponsorship;
const getFeeTokenForSponsorship = (fromSelectedToken, quote, fromAmount) => {
    // if the provider is uniswap, we're getting the fee from the output token
    if (quote?.selectedRoute?.providerId === 'uniswap') {
        const outputAmount = Number((0, ethers_1.formatUnits)(quote.selectedRoute.toAmount, quote.toAsset.decimals));
        return {
            feeTokenPriceInUsd: outputAmount
                ? quote.selectedRoute.outputValueInUsd / outputAmount
                : undefined,
            decimals: quote.toAsset.decimals
        };
    }
    // try to get from portfolio, if exists
    // else take from quote
    let feeTokenPriceInUsd = fromSelectedToken.priceIn.find((p) => p.baseCurrency === 'usd')?.price;
    const normalizedFromAmount = Number(fromAmount);
    if (!feeTokenPriceInUsd &&
        quote?.selectedRoute?.inputValueInUsd &&
        Number.isFinite(normalizedFromAmount) &&
        normalizedFromAmount > 0) {
        feeTokenPriceInUsd = quote.selectedRoute.inputValueInUsd / normalizedFromAmount;
    }
    return {
        feeTokenPriceInUsd,
        decimals: quote?.fromAsset.decimals
    };
};
exports.getFeeTokenForSponsorship = getFeeTokenForSponsorship;
/**
 * Calculates route output values for sorting with a shared output-token price,
 * without changing the provider values displayed in the UI.
 */
const getRouteOutputValuesForSorting = (route, outputTokenPriceUSD) => {
    if (!outputTokenPriceUSD) {
        return {
            outputValueInUsd: route.outputValueInUsd,
            outputValueAfterGasInUsd: route.outputValueAfterGasInUsd
        };
    }
    const outputValueInUsd = Number((0, formatters_1.safeTokenAmountAndNumberMultiplication)(BigInt(route.toAmount), route.toToken.decimals, outputTokenPriceUSD));
    const gasCostInUsd = route.outputValueAfterGasInUsd === undefined
        ? undefined
        : route.outputValueInUsd - route.outputValueAfterGasInUsd;
    return {
        outputValueInUsd,
        outputValueAfterGasInUsd: gasCostInUsd === undefined ? undefined : outputValueInUsd - gasCostInUsd
    };
};
exports.getRouteOutputValuesForSorting = getRouteOutputValuesForSorting;
/**
 * Adds the Cena output-token price required by the warning calculations when the provider
 * doesn't supply one, without changing the provider USD values displayed in the UI.
 */
const enrichRouteWithOutputTokenPrice = (route, outputTokenPriceUSD) => {
    const providerOutputTokenPriceUSD = Number(route.toToken.priceUSD);
    const cenaOutputTokenPriceUSD = Number(outputTokenPriceUSD);
    const hasProviderOutputTokenPrice = Number.isFinite(providerOutputTokenPriceUSD) && providerOutputTokenPriceUSD > 0;
    const hasCenaOutputTokenPrice = Number.isFinite(cenaOutputTokenPriceUSD) && cenaOutputTokenPriceUSD > 0;
    if (hasProviderOutputTokenPrice || !hasCenaOutputTokenPrice)
        return route;
    return {
        ...route,
        toToken: {
            ...route.toToken,
            priceUSD: cenaOutputTokenPriceUSD.toString()
        }
    };
};
exports.enrichRouteWithOutputTokenPrice = enrichRouteWithOutputTokenPrice;
/**
 * Turns the txns of a swap that went out before the rest of it failed (e.g. the approval
 * was sent but the swap was rejected on the hardware wallet) into an activity record.
 * - Only the sent calls are kept, so e.g. speeding it up doesn't include the unsent swap.
 * - It's detached from the swap route, as the user can retry the same route while it's
 *   still pending. The route is matched to account ops by their call ids and
 *   `meta.swapTxn.activeRouteId`, so e.g. the approval failing later would fail the retry.
 */
const getSentPartOfSwap = (sentAccountOp) => {
    const sentTxnsCount = sentAccountOp.identifiedBy.identifier.split('-').length;
    const calls = (0, submittedAccountOp_1.getCallsWithTxnIds)({
        ...sentAccountOp,
        calls: sentAccountOp.calls.slice(0, sentTxnsCount)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
    }).map(({ activeRouteId, ...call }) => ({
        ...call,
        id: call.id ? `${call.id}-sent-before-retry` : call.id
    }));
    const swapTxn = sentAccountOp.meta?.swapTxn;
    if (!swapTxn)
        return { ...sentAccountOp, calls };
    return {
        ...sentAccountOp,
        calls,
        meta: {
            ...sentAccountOp.meta,
            swapTxn: { ...swapTxn, activeRouteId: `${swapTxn.activeRouteId}-sent-before-retry` }
        }
    };
};
exports.getSentPartOfSwap = getSentPartOfSwap;
//# sourceMappingURL=swapAndBridge.js.map