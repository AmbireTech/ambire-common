"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveRoutesForAccount = exports.buildSwapAndBridgeUserRequests = exports.getActiveRoutesUpdateInterval = exports.getActiveRoutesLowestServiceTime = exports.getQuoteRouteSteps = exports.getIsNetworkSupported = exports.getIsBridgeTxn = exports.convertPortfolioTokenToSocketAPIToken = exports.getIsTokenEligibleForSwapAndBridge = exports.sortPortfolioTokenList = exports.sortTokenListResponse = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const IERC20_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/IERC20.json"));
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
        // Otherwise, just alphabetical
        return (a.name || '').localeCompare(b.name || '');
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
const convertPortfolioTokenToSocketAPIToken = (portfolioToken, chainId) => {
    const { address, decimals, symbol } = portfolioToken;
    // Although name and symbol will be the same, it's better than having "No name" in the UI (valid use-case)
    const name = symbol;
    // Fine for not having both icon props, because this would fallback to the
    // icon discovery method used for the portfolio tokens
    const icon = '';
    const logoURI = '';
    return { address, chainId, decimals, symbol, name, icon, logoURI };
};
exports.convertPortfolioTokenToSocketAPIToken = convertPortfolioTokenToSocketAPIToken;
const getQuoteRouteSteps = (userTxs) => {
    return userTxs.reduce((stepsAcc, tx) => {
        if (tx.userTxType === 'fund-movr') {
            tx.steps.forEach((s) => stepsAcc.push({ ...s, userTxIndex: tx.userTxIndex }));
        }
        if (tx.userTxType === 'dex-swap') {
            stepsAcc.push({
                chainId: tx.chainId,
                fromAmount: tx.fromAmount,
                fromAsset: tx.fromAsset,
                gasFees: tx.gasFees,
                minAmountOut: tx.minAmountOut,
                protocol: tx.protocol,
                swapSlippage: tx.swapSlippage,
                toAmount: tx.toAmount,
                toAsset: tx.toAsset,
                type: 'swap',
                userTxIndex: tx.userTxIndex
            });
        }
        return stepsAcc;
    }, []);
};
exports.getQuoteRouteSteps = getQuoteRouteSteps;
const getActiveRoutesLowestServiceTime = (activeRoutes) => {
    const serviceTimes = [];
    activeRoutes.forEach((r) => r.route.userTxs.forEach((tx) => {
        if (tx.serviceTime) {
            serviceTimes.push(tx.serviceTime);
        }
    }));
    return serviceTimes.sort((a, b) => a - b)[0];
};
exports.getActiveRoutesLowestServiceTime = getActiveRoutesLowestServiceTime;
const getActiveRoutesUpdateInterval = (minServiceTime) => {
    if (!minServiceTime)
        return 7000;
    if (minServiceTime < 60)
        return 5000;
    if (minServiceTime <= 180)
        return 6000;
    if (minServiceTime <= 300)
        return 8000;
    if (minServiceTime <= 600)
        return 12000;
    return 15000;
};
exports.getActiveRoutesUpdateInterval = getActiveRoutesUpdateInterval;
const buildRevokeApprovalIfNeeded = async (userTx, account, provider) => {
    if (!userTx.approvalData)
        return;
    const erc20Contract = new ethers_1.Contract(userTx.approvalData.approvalTokenAddress, IERC20_json_1.default.abi, provider);
    const requiredAmount = (0, account_1.isSmartAccount)(account)
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
const buildSwapAndBridgeUserRequests = async (userTx, networkId, account, provider) => {
    if ((0, account_1.isSmartAccount)(account)) {
        const calls = [];
        if (userTx.approvalData) {
            const erc20Interface = new ethers_1.Interface(IERC20_json_1.default.abi);
            const revokeApproval = await buildRevokeApprovalIfNeeded(userTx, account, provider);
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
        return [
            {
                id: userTx.activeRouteId,
                action: {
                    kind: 'calls',
                    calls
                },
                meta: {
                    isSignAction: true,
                    networkId,
                    accountAddr: account.addr,
                    activeRouteId: userTx.activeRouteId,
                    isSwapAndBridgeCall: true
                }
            }
        ];
    }
    const requests = [];
    let shouldBuildSwapOrBridgeTx = true;
    if (userTx.approvalData) {
        const erc20Interface = new ethers_1.Interface(IERC20_json_1.default.abi);
        let shouldApprove = true;
        try {
            const erc20Contract = new ethers_1.Contract(userTx.approvalData.approvalTokenAddress, IERC20_json_1.default.abi, provider);
            const allowance = await erc20Contract.allowance(userTx.approvalData.owner, userTx.approvalData.allowanceTarget);
            // check if an approval already exists
            if (BigInt(allowance) >= BigInt(userTx.approvalData.minimumApprovalAmount))
                shouldApprove = false;
        }
        catch (error) {
            console.error(error);
        }
        if (shouldApprove) {
            const revokeApproval = await buildRevokeApprovalIfNeeded(userTx, account, provider);
            if (revokeApproval) {
                requests.push({
                    id: `${userTx.activeRouteId}-revoke-approval`,
                    action: { kind: 'calls', calls: [revokeApproval] },
                    meta: {
                        isSignAction: true,
                        networkId,
                        accountAddr: account.addr,
                        isSwapAndBridgeCall: true,
                        activeRouteId: userTx.activeRouteId
                    }
                });
            }
            requests.push({
                id: `${userTx.activeRouteId}-approval`,
                action: {
                    kind: 'calls',
                    calls: [
                        {
                            to: userTx.approvalData.approvalTokenAddress,
                            value: BigInt('0'),
                            data: erc20Interface.encodeFunctionData('approve', [
                                userTx.approvalData.allowanceTarget,
                                ethers_1.MaxUint256 // approve the max possible amount for better UX on BA
                            ]),
                            fromUserRequestId: `${userTx.activeRouteId}-approval`
                        }
                    ]
                },
                meta: {
                    isSignAction: true,
                    networkId,
                    accountAddr: account.addr,
                    isSwapAndBridgeCall: true,
                    activeRouteId: userTx.activeRouteId
                }
            });
            // first build only the approval tx and then when confirmed this func will be called a second time
            // and then only the swap or bridge tx will be created
            shouldBuildSwapOrBridgeTx = false;
        }
    }
    if (shouldBuildSwapOrBridgeTx) {
        requests.push({
            id: userTx.activeRouteId,
            action: {
                kind: 'calls',
                calls: [
                    {
                        to: userTx.txTarget,
                        value: BigInt(userTx.value),
                        data: userTx.txData,
                        fromUserRequestId: userTx.activeRouteId
                    }
                ]
            },
            meta: {
                isSignAction: true,
                networkId,
                accountAddr: account.addr,
                isSwapAndBridgeCall: true,
                activeRouteId: userTx.activeRouteId
            }
        });
    }
    return requests;
};
exports.buildSwapAndBridgeUserRequests = buildSwapAndBridgeUserRequests;
const getIsBridgeTxn = (userTxType) => userTxType === 'fund-movr';
exports.getIsBridgeTxn = getIsBridgeTxn;
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
    return activeRoutes.filter((r) => (0, ethers_1.getAddress)(r.route.sender || r.route.userAddress) === accountAddress);
};
exports.getActiveRoutesForAccount = getActiveRoutesForAccount;
//# sourceMappingURL=swapAndBridge.js.map