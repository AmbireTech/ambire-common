import { Contract, formatUnits, getAddress, Interface, MaxUint256, parseUnits, ZeroAddress } from 'ethers';
import ERC20 from '../../../contracts/compiled/IERC20.json';
import { MAX_UINT256 } from '../../consts/deploy';
import { BRIDGE_STATUS_INTERVAL, UPDATE_SWAP_AND_BRIDGE_QUOTE_INTERVAL } from '../../consts/intervals';
import { getTokenUsdAmount } from '../../controllers/signAccountOp/helper';
import { LIFI_EXPLORER_URL } from '../../services/lifi/consts';
import { AMBIRE_WALLET_TOKEN_ON_ETHEREUM, FEE_PERCENT, JPYC_TOKEN, NULL_ADDRESS, SOCKET_EXPLORER_URL, ZERO_ADDRESS } from '../../services/socket/constants';
import { SQUID_EXPLORER_URL } from '../../services/squid/constants';
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters';
import { isBasicAccount } from '../account/account';
import { AssetType } from '../defiPositions/types';
import { getTokenBalanceInUSD } from '../portfolio/helpers';
import { getSanitizedAmount } from '../transfer/amount';
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
    const validCelo = ZeroAddress;
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
export const attemptToSortTokensByMarketCap = async ({ fetch, chainId, tokens }) => {
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
export const sortNativeTokenFirst = (tokens) => {
    return tokens.sort((a, b) => {
        if (a.address === ZeroAddress)
            return -1;
        if (b.address === ZeroAddress)
            return 1;
        return 0;
    });
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
        // Otherwise, don't change, persist the order from the service provider
        return 0;
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
export const getIsTokenEligibleForSwapAndBridge = (token, requirePositiveBalance = true) => {
    const flagsRequirement = 
    // The same token can be in the Gas Tank (or as a Reward) and in the portfolio.
    // Exclude the one in the Gas Tank (swapping Gas Tank tokens is not supported).
    !token.flags.onGasTank &&
        // And exclude the rewards ones (swapping rewards is not supported).
        !token.flags.rewardsType &&
        // Borrow tokens (e.g. variableDebt tokens) are protocol accounting assets
        // and are not transferable/swappable by design.
        token.flags.defiTokenType !== AssetType.Borrow;
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
export const convertPortfolioTokenToSwapAndBridgeToToken = (portfolioToken, chainId) => {
    const { address, decimals, symbol } = portfolioToken;
    // Although name and symbol will be the same, it's better than having "No name" in the UI (valid use-case)
    const name = symbol;
    // Fine for not having both icon props, because this would fallback to the
    // icon discovery method used for the portfolio tokens
    const icon = '';
    return { address, chainId, decimals, symbol, name, icon };
};
/**
 * Return the lowest active route service time in MILLISECONDS
 */
const getActiveRoutesLowestServiceTime = (activeRoutes) => {
    const serviceTimes = [];
    activeRoutes.forEach((r) => {
        // for squid swaps, make the service time 10s
        if (r.serviceProviderId === 'squid' && r.fromAsset?.chainId === r.toAsset?.chainId) {
            serviceTimes.push(BRIDGE_STATUS_INTERVAL / 1000);
            return;
        }
        r.route?.userTxs.forEach((tx) => {
            if (tx.serviceTime) {
                serviceTimes.push(tx.serviceTime);
            }
        });
    });
    const time = serviceTimes.sort((a, b) => a - b)[0];
    if (!time)
        return UPDATE_SWAP_AND_BRIDGE_QUOTE_INTERVAL;
    return time * 1000;
};
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
// If you have approval that has not been spent (in some smart contracts), the transaction may revert
const buildRevokeApprovalIfNeeded = async (userTx, account, state, provider) => {
    if (!userTx.approvalData)
        return;
    const erc20Contract = new Contract(userTx.approvalData.approvalTokenAddress, ERC20.abi, provider);
    const requiredAmount = !isBasicAccount(account, state)
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
    const erc20Contract = new Contract(userTx.approvalData.approvalTokenAddress, ERC20.abi, provider);
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
        const erc20Interface = new Interface(ERC20.abi);
        // if the allowance is not 0 and not MAX but anything between,
        // check if we need to do a revoke first
        // USDT on Ethereum being one example for this
        if (allowanceData.allowance !== undefined &&
            allowanceData.allowance > 0n &&
            allowanceData.allowance < MAX_UINT256) {
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
        activeRouteId: userTx.activeRouteId
    });
    return calls;
};
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
export const getIsBridgeRoute = (route) => {
    return route.providerId === 'squid' || route.fromChainId !== route.toChainId;
};
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
    return activeRoutes.filter((r) => getAddress(r.route?.sender || r.route?.userAddress || '') === accountAddress);
};
/**
 * Since v4.41.0 we request the shortlist from our service provider, which might
 * not include the Ambire $WALLET token. So adding it manually on the supported chains.
 */
const addCustomTokensIfNeeded = ({ tokens, chainId }) => {
    const newTokens = [...tokens];
    if (chainId === 1) {
        const shouldAddAmbireWalletToken = newTokens.every((t) => t.address !== AMBIRE_WALLET_TOKEN_ON_ETHEREUM.address);
        if (shouldAddAmbireWalletToken)
            newTokens.unshift(AMBIRE_WALLET_TOKEN_ON_ETHEREUM);
        const shouldAddJPYCToken = newTokens.every((t) => t.address !== JPYC_TOKEN.address);
        if (shouldAddJPYCToken)
            newTokens.unshift({ ...JPYC_TOKEN, chainId: 1 });
    }
    if (chainId === 137) {
        const shouldAddJPYCToken = newTokens.every((t) => t.address !== JPYC_TOKEN.address);
        if (shouldAddJPYCToken)
            newTokens.unshift({ ...JPYC_TOKEN, chainId: 137 });
    }
    if (chainId === 43114) {
        const shouldAddJPYCToken = newTokens.every((t) => t.address !== JPYC_TOKEN.address);
        if (shouldAddJPYCToken)
            newTokens.unshift({ ...JPYC_TOKEN, chainId: 43114 });
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
// the celo native token is at an address 0x471EcE3750Da237f93B8E339c536989b8978a438
// and LiFi doesn't work if we pass address 0 for this. We map it only for
// lifi to make the swap work in this case
const lifiMapNativeToAddr = (chainId, tokenAddr) => {
    if (tokenAddr !== ZeroAddress)
        return tokenAddr;
    // celo chain
    if (chainId !== 42220)
        return tokenAddr;
    return '0x471EcE3750Da237f93B8E339c536989b8978a438';
};
/**
 * Map the token address back to native when needed
 */
const mapBannedToValidAddr = (chainId, tokenAddr) => {
    const list = getBannedToValidAddresses()[chainId];
    if (!list || !list[tokenAddr])
        return tokenAddr;
    return list[tokenAddr];
};
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
const getSlippage = (fromAsset, fromAmount, upperBoundary, delimeter) => {
    // make sure the slippage doesn't exceed 100$
    // we do so by having a base of 0.005
    // to have a slippage of 100$, we need a fromAmountInUsd of at least 20000$,
    // so each time the from amount makes a jump of 20000$, we lower
    // the slippage by half
    const fromAmountInUsd = getTokenUsdAmount(fromAsset, fromAmount);
    return Number(fromAmountInUsd) < 400
        ? upperBoundary
        : (delimeter / Math.ceil(Number(fromAmountInUsd) / 20000)).toPrecision(2);
};
export const calculateAmountWarnings = (selectedRoute, fromAmountInFiat, fromAmount, fromSelectedTokenDecimals) => {
    if (!selectedRoute)
        return null;
    let inputValueInUsd = 0;
    const outputValueInUsd = selectedRoute.outputValueInUsd;
    try {
        inputValueInUsd = Number(fromAmountInFiat);
    }
    catch (error) {
        // silent fail
    }
    if (!inputValueInUsd)
        return null;
    try {
        const sanitizedFromAmount = getSanitizedAmount(fromAmount, fromSelectedTokenDecimals);
        const bigintFromAmount = parseUnits(sanitizedFromAmount, fromSelectedTokenDecimals);
        if (bigintFromAmount !== BigInt(selectedRoute.fromAmount))
            return null;
        // Can be negative if the output is higher
        // (possible during arbitrage swaps)
        const difference = inputValueInUsd - outputValueInUsd;
        const percentageDiff = (difference / inputValueInUsd) * 100;
        if (percentageDiff >= 5) {
            return {
                type: 'highPriceImpact',
                percentageDiff
            };
        }
        // try to calculate the slippage
        const txn = selectedRoute.userTxs[selectedRoute.userTxs.length - 1];
        if (!txn)
            throw new Error('no userTxs in selectedRoute');
        const minAmountOutInWei = BigInt(txn.minAmountOut);
        const minInUsd = safeTokenAmountAndNumberMultiplication(minAmountOutInWei, selectedRoute.toToken.decimals, Number(selectedRoute.toToken.priceUSD));
        const allowedSlippage = Number(inputValueInUsd) < 400
            ? 1.05
            : Number((0.005 / Math.ceil(Number(inputValueInUsd) / 20000)).toPrecision(2)) * 100 + 0.01;
        const possibleSlippage = (1 - Number(minInUsd) / outputValueInUsd) * 100;
        // @precautionary if
        const diffBetweenQuoteAndMinAmount = outputValueInUsd > Number(minInUsd) ? outputValueInUsd - Number(minInUsd) : 0;
        // It seems a bit odd to display a slippage warning only if the difference
        // is > $50?
        if (possibleSlippage > allowedSlippage && diffBetweenQuoteAndMinAmount > 50) {
            return {
                type: 'slippageImpact',
                possibleSlippage,
                minInUsd: Number(minInUsd),
                minInToken: formatUnits(minAmountOutInWei, selectedRoute.toToken.decimals),
                symbol: selectedRoute.toToken.symbol
            };
        }
        return null;
    }
    catch (error) {
        return null;
    }
};
const getLink = (route) => {
    const providerId = route.route ? route.route.providerId : route.serviceProviderId;
    if (providerId === 'socket')
        return `${SOCKET_EXPLORER_URL}/tx/${route.userTxHash}`;
    if (providerId === 'squid')
        return `${SQUID_EXPLORER_URL}/${route.userTxHash}`;
    return `${LIFI_EXPLORER_URL}/tx/${route.userTxHash}`;
};
const isTxnBridge = (txn) => {
    return txn.fromAsset.chainId !== txn.toAsset.chainId;
};
const convertNullAddressToZeroAddressIfNeeded = (addr) => addr === NULL_ADDRESS ? ZERO_ADDRESS : addr;
/**
 * Get the swap sponsorship details.
 * We need the native price so we can later understand if the cost
 * of the txn in USD is less than the swap fee to sponsor it.
 * No sponsorships in og mode.
 * Also, to calculate the fee in USD, we multiply the full from
 * amount in USD to the fee percent
 */
const getSwapSponsorship = ({ hasConvinienceFee, nativePrice, fromAmountInUsd, fromTokenPriceInUsd, fromTokenDecimals, providerId }) => {
    if (!hasConvinienceFee ||
        !nativePrice ||
        !fromAmountInUsd ||
        !fromTokenPriceInUsd ||
        !fromTokenDecimals ||
        providerId === 'squid')
        return undefined;
    return {
        nativePrice,
        swapFeeInUsd: (fromAmountInUsd * FEE_PERCENT) / 100,
        fromTokenPriceInUsd,
        fromTokenDecimals
    };
};
export { addCustomTokensIfNeeded, convertNullAddressToZeroAddressIfNeeded, getActiveRoutesForAccount, getActiveRoutesLowestServiceTime, getActiveRoutesUpdateInterval, getBannedToTokenList, getLink, getSlippage, getSwapAndBridgeCalls, getSwapAndBridgeRequestParams, getSwapSponsorship, isNoFeeToken, isTxnBridge, lifiMapNativeToAddr, mapBannedToValidAddr };
//# sourceMappingURL=swapAndBridge.js.map