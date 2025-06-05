"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSwapAndBridgeCalls = exports.getActiveRoutesUpdateInterval = exports.getActiveRoutesLowestServiceTime = exports.getActiveRoutesForAccount = exports.buildSwapAndBridgeUserRequests = exports.addCustomTokensIfNeeded = exports.getIsNetworkSupported = exports.getIsBridgeRoute = exports.getIsBridgeTxn = exports.convertPortfolioTokenToSwapAndBridgeToToken = exports.getIsTokenEligibleForSwapAndBridge = exports.sortPortfolioTokenList = exports.sortTokenListResponse = exports.sortNativeTokenFirst = exports.attemptToSortTokensByMarketCap = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
const constants_1 = require("../../services/socket/constants");
const account_1 = require("../account/account");
const helpers_1 = require("../portfolio/helpers");
const sortTokensByPendingAndBalance = (a, b) => {
    // Pending tokens go on top
    const isAPending = typeof a.amountPostSimulation === 'bigint' && a.amountPostSimulation !== BigInt(a.amount);
    const isBPending = typeof b.amountPostSimulation === 'bigint' && b.amountPostSimulation !== BigInt(b.amount);
    if (isAPending && !isBPending)
        return -1;
    if (!isAPending && isBPending)
        return 1;
    // Otherwise, higher balance comes first
    const aBalanceUSD = (0, helpers_1.getTokenBalanceInUSD)(a);
    const bBalanceUSD = (0, helpers_1.getTokenBalanceInUSD)(b);
    if (aBalanceUSD !== bBalanceUSD)
        return bBalanceUSD - aBalanceUSD;
    return 0;
};
const attemptToSortTokensByMarketCap = async ({ fetch, chainId, tokens }) => {
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
    return tokenListResponse.sort((a, b) => {
        const aInPortfolio = accountPortfolioTokenList.find((t) => t.address === a.address);
        const bInPortfolio = accountPortfolioTokenList.find((t) => t.address === b.address);
        // Tokens in portfolio should come first
        if (aInPortfolio && !bInPortfolio)
            return -1;
        if (!aInPortfolio && bInPortfolio)
            return 1;
        if (aInPortfolio && bInPortfolio) {
            const comparisonResult = sortTokensByPendingAndBalance(aInPortfolio, bInPortfolio);
            if (comparisonResult !== 0)
                return comparisonResult;
        }
        // Otherwise, don't change, persist the order from the service provider
        return 0;
    });
};
exports.sortTokenListResponse = sortTokenListResponse;
const sortPortfolioTokenList = (accountPortfolioTokenList) => {
    return accountPortfolioTokenList.sort((a, b) => {
        const comparisonResult = sortTokensByPendingAndBalance(a, b);
        if (comparisonResult !== 0)
            return comparisonResult;
        // Otherwise, just alphabetical
        return (a.symbol || '').localeCompare(b.symbol || '');
    });
};
exports.sortPortfolioTokenList = sortPortfolioTokenList;
/**
 * Determines if a token is eligible for swapping and bridging.
 * Not all tokens in the portfolio are eligible.
 */
const getIsTokenEligibleForSwapAndBridge = (token) => {
    // Prevent filtering out tokens with amountPostSimulation = 0 if the actual amount is positive.
    // This ensures the token remains in the list when sending the full amount of it
    const amount = token.amountPostSimulation === 0n && token.amount > 0n
        ? token.amount
        : token.amountPostSimulation ?? token.amount;
    const hasPositiveBalance = Number(amount) > 0;
    return (
    // The same token can be in the Gas Tank (or as a Reward) and in the portfolio.
    // Exclude the one in the Gas Tank (swapping Gas Tank tokens is not supported).
    !token.flags.onGasTank &&
        // And exclude the rewards ones (swapping rewards is not supported).
        !token.flags.rewardsType &&
        hasPositiveBalance);
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
const getActiveRoutesLowestServiceTime = (activeRoutes) => {
    const serviceTimes = [];
    activeRoutes.forEach((r) => r.route?.userTxs.forEach((tx) => {
        if (tx.serviceTime) {
            serviceTimes.push(tx.serviceTime);
        }
    }));
    return serviceTimes.sort((a, b) => a - b)[0];
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
    catch (e) {
        fails = true;
    }
    if (!fails)
        return;
    return {
        to: userTx.approvalData.approvalTokenAddress,
        value: BigInt('0'),
        data: erc20Contract.interface.encodeFunctionData('approve', [
            userTx.approvalData.allowanceTarget,
            BigInt(0)
        ])
    };
};
const getSwapAndBridgeCalls = async (userTx, account, provider, state) => {
    const calls = [];
    if (userTx.approvalData) {
        const erc20Interface = new ethers_1.Interface(IERC20_json_1.default.abi);
        const revokeApproval = await buildRevokeApprovalIfNeeded(userTx, account, state, provider);
        if (revokeApproval)
            calls.push(revokeApproval);
        calls.push({
            to: userTx.approvalData.approvalTokenAddress,
            value: BigInt('0'),
            data: erc20Interface.encodeFunctionData('approve', [
                userTx.approvalData.allowanceTarget,
                BigInt(userTx.approvalData.minimumApprovalAmount)
            ]),
            fromUserRequestId: userTx.activeRouteId
        });
    }
    calls.push({
        to: userTx.txTarget,
        value: BigInt(userTx.value),
        data: userTx.txData,
        fromUserRequestId: userTx.activeRouteId
    });
    return calls;
};
exports.getSwapAndBridgeCalls = getSwapAndBridgeCalls;
const buildSwapAndBridgeUserRequests = async (userTx, chainId, account, provider, state, paymasterService) => {
    return [
        {
            id: userTx.activeRouteId,
            action: {
                kind: 'calls',
                calls: await getSwapAndBridgeCalls(userTx, account, provider, state)
            },
            meta: {
                isSignAction: true,
                chainId,
                accountAddr: account.addr,
                activeRouteId: userTx.activeRouteId,
                isSwapAndBridgeCall: true,
                paymasterService
            }
        }
    ];
};
exports.buildSwapAndBridgeUserRequests = buildSwapAndBridgeUserRequests;
const getIsBridgeTxn = (userTxType) => userTxType === 'fund-movr';
exports.getIsBridgeTxn = getIsBridgeTxn;
const getIsBridgeRoute = (route) => {
    return route.userTxs.some((userTx) => (0, exports.getIsBridgeTxn)(userTx.userTxType));
};
exports.getIsBridgeRoute = getIsBridgeRoute;
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
    }
    if (chainId === 8453) {
        const shouldAddAmbireWalletToken = newTokens.every((t) => t.address !== constants_1.AMBIRE_WALLET_TOKEN_ON_BASE.address);
        if (shouldAddAmbireWalletToken)
            newTokens.unshift(constants_1.AMBIRE_WALLET_TOKEN_ON_BASE);
    }
    return newTokens;
};
exports.addCustomTokensIfNeeded = addCustomTokensIfNeeded;
//# sourceMappingURL=swapAndBridge.js.map