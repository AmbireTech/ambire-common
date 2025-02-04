import { Contract, getAddress, Interface, MaxUint256 } from 'ethers';
import ERC20 from '../../../contracts/compiled/IERC20.json';
import { isSmartAccount } from '../account/account';
import { getTokenBalanceInUSD } from '../portfolio/helpers';
const sortTokensByPendingAndBalance = (a, b) => {
    // Pending tokens go on top
    const isAPending = typeof a.amountPostSimulation === 'bigint' && a.amountPostSimulation !== BigInt(a.amount);
    const isBPending = typeof b.amountPostSimulation === 'bigint' && b.amountPostSimulation !== BigInt(b.amount);
    if (isAPending && !isBPending)
        return -1;
    if (!isAPending && isBPending)
        return 1;
    // Otherwise, higher balance comes first
    const aBalanceUSD = getTokenBalanceInUSD(a);
    const bBalanceUSD = getTokenBalanceInUSD(b);
    if (aBalanceUSD !== bBalanceUSD)
        return bBalanceUSD - aBalanceUSD;
    return 0;
};
export const sortTokenListResponse = (tokenListResponse, accountPortfolioTokenList) => {
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
export const sortPortfolioTokenList = (accountPortfolioTokenList) => {
    return accountPortfolioTokenList.sort((a, b) => {
        const comparisonResult = sortTokensByPendingAndBalance(a, b);
        if (comparisonResult !== 0)
            return comparisonResult;
        // Otherwise, just alphabetical
        return (a.symbol || '').localeCompare(b.symbol || '');
    });
};
/**
 * Determines if a token is eligible for swapping and bridging.
 * Not all tokens in the portfolio are eligible.
 */
export const getIsTokenEligibleForSwapAndBridge = (token) => {
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
export const convertPortfolioTokenToSocketAPIToken = (portfolioToken, chainId) => {
    const { address, decimals, symbol } = portfolioToken;
    // Although name and symbol will be the same, it's better than having "No name" in the UI (valid use-case)
    const name = symbol;
    // Fine for not having both icon props, because this would fallback to the
    // icon discovery method used for the portfolio tokens
    const icon = '';
    const logoURI = '';
    return { address, chainId, decimals, symbol, name, icon, logoURI };
};
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
const getActiveRoutesLowestServiceTime = (activeRoutes) => {
    const serviceTimes = [];
    activeRoutes.forEach((r) => r.route.userTxs.forEach((tx) => {
        if (tx.serviceTime) {
            serviceTimes.push(tx.serviceTime);
        }
    }));
    return serviceTimes.sort((a, b) => a - b)[0];
};
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
const buildRevokeApprovalIfNeeded = async (userTx, account, provider) => {
    if (!userTx.approvalData)
        return;
    const erc20Contract = new Contract(userTx.approvalData.approvalTokenAddress, ERC20.abi, provider);
    const requiredAmount = isSmartAccount(account)
        ? BigInt(userTx.approvalData.minimumApprovalAmount)
        : MaxUint256;
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
    if (isSmartAccount(account)) {
        const calls = [];
        if (userTx.approvalData) {
            const erc20Interface = new Interface(ERC20.abi);
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
        const erc20Interface = new Interface(ERC20.abi);
        let shouldApprove = true;
        try {
            const erc20Contract = new Contract(userTx.approvalData.approvalTokenAddress, ERC20.abi, provider);
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
                                MaxUint256 // approve the max possible amount for better UX on BA
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
export const getIsBridgeTxn = (userTxType) => userTxType === 'fund-movr';
/**
 * Checks if a network is supported by our Swap & Bridge service provider. As of v4.43.0
 * there are 16 networks supported, so user could have (many) custom networks that are not.
 */
export const getIsNetworkSupported = (supportedChainIds, network) => {
    // Assume supported if missing (and receive no results when attempting to use
    // a not-supported network) than the alternative - blocking the UI.
    if (!supportedChainIds.length || !network)
        return true;
    return supportedChainIds.includes(network.chainId);
};
const getActiveRoutesForAccount = (accountAddress, activeRoutes) => {
    return activeRoutes.filter((r) => getAddress(r.route.sender || r.route.userAddress) === accountAddress);
};
export { getQuoteRouteSteps, getActiveRoutesLowestServiceTime, getActiveRoutesUpdateInterval, buildSwapAndBridgeUserRequests, getActiveRoutesForAccount };
//# sourceMappingURL=swapAndBridge.js.map