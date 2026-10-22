"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePositionsByProviderAssetPrices = exports.mergeDefiUpdateModes = exports.getUniqueMergedPositions = exports.getNewDefiState = exports.getHasNonceChangedSinceLastUpdate = exports.getFormattedApiPositions = exports.getDefiUpdateMode = exports.getCustomProviderPositions = exports.getAssetValue = exports.getAllAssetsAsHints = exports.getAccountNetworksWithPositions = exports.enhancePortfolioTokensWithDefiPositions = exports.DefiUpdateMode = exports.getIsExternalApiDefiPositionsCallSuccessful = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const viem_1 = require("viem");
const amount_1 = require("../transfer/amount");
const formatters_1 = require("../../utils/numbers/formatters");
const shortenAddress_1 = tslib_1.__importDefault(require("../../utils/shortenAddress"));
const defiPrices_1 = require("./defiPrices");
Object.defineProperty(exports, "updatePositionsByProviderAssetPrices", { enumerable: true, get: function () { return defiPrices_1.updatePositionsByProviderAssetPrices; } });
const helpers_1 = require("./helpers");
Object.defineProperty(exports, "getAssetValue", { enumerable: true, get: function () { return helpers_1.getAssetValue; } });
const providers_1 = require("./providers");
const types_1 = require("./types");
const getIsExternalApiDefiPositionsCallSuccessful = (discoveryResponse) => {
    // If the request was skipped (no data, no errors) consider it successful
    if (!discoveryResponse)
        return true;
    return !!discoveryResponse.data?.defi;
};
exports.getIsExternalApiDefiPositionsCallSuccessful = getIsExternalApiDefiPositionsCallSuccessful;
/**
 * Fetches the defi positions of certain protocols using RPC calls and custom logic.
 * Cena is used for most of the positions, but some protocols require additional data
 * that is not available in Cena. This function fetches those positions on ENABLED
 * networks only.
 *
 * Returns the old positions if the call fails. Some positions, like that of Uniswap V3,
 * are merged with the data from Cena/Debank.
 */
const getCustomProviderPositions = async (addr, provider, network, fetch, previousPositions, debankNetworkPositionsByProvider, isDebankCallSuccessful, shouldFetchTokenPrices = true) => {
    if (network.disabled)
        return {
            positionsByProvider: [],
            providerErrors: []
        };
    try {
        const providerErrors = [];
        let error;
        let newPositions = (await Promise.all([
            (0, providers_1.getAAVEPositions)(addr, provider, network).catch((e) => {
                providerErrors.push({
                    providerName: 'AAVE v3',
                    error: e?.message || 'Unknown error'
                });
                return null;
            }),
            // Uniswap is a bit of an odd case. We return the positions merged with Debank data
            (0, providers_1.getDebankEnhancedUniV3Positions)(addr, provider, network, previousPositions, debankNetworkPositionsByProvider ||
                previousPositions.filter((p) => p.source !== 'custom'), isDebankCallSuccessful).catch((e) => {
                providerErrors.push({
                    providerName: 'Uniswap V3',
                    error: e?.message || 'Unknown error'
                });
                return null;
            })
        ])).filter(Boolean);
        if (newPositions.length && shouldFetchTokenPrices) {
            try {
                newPositions =
                    (await (0, defiPrices_1.updatePositionsByProviderAssetPrices)(fetch, newPositions, network.platformId)) ||
                        newPositions;
            }
            catch (e) {
                console.error(`#setAssetPrices error for ${addr} on ${network.name}:`, e);
                error = types_1.DeFiPositionsError.AssetPriceError;
            }
        }
        // Get the previous custom positions that were not updated in this call
        // This is done so the user doesn't lose their custom positions when the
        // new update fails
        const filteredPrevious = previousPositions.filter((prev) => prev.source === 'custom' &&
            !newPositions.some((n) => (0, helpers_1.getProviderId)(n.providerName) === (0, helpers_1.getProviderId)(prev.providerName)));
        return {
            positionsByProvider: [...filteredPrevious, ...newPositions],
            providerErrors,
            error
        };
    }
    catch (e) {
        console.error('Critical error fetching custom defi positions:', e);
        return {
            positionsByProvider: previousPositions.filter((p) => p.source === 'custom'),
            providerErrors: [],
            error: types_1.DeFiPositionsError.CriticalError
        };
    }
};
exports.getCustomProviderPositions = getCustomProviderPositions;
/**
 * Merges Debank positions with custom fetched positions, ensuring uniqueness by provider.
 */
const getUniqueMergedPositions = (debankNetworkPositionsByProvider, customPositions, stkWalletPosition) => {
    const debankPositionMap = new Map(debankNetworkPositionsByProvider.map((p) => [(0, helpers_1.getProviderId)(p.providerName), p]));
    customPositions.forEach((custom) => {
        const key = (0, helpers_1.getProviderId)(custom.providerName);
        debankPositionMap.set(key, custom);
    });
    if (stkWalletPosition) {
        const key = (0, helpers_1.getProviderId)(stkWalletPosition.providerName);
        debankPositionMap.set(key, stkWalletPosition);
    }
    let positionsArray = Array.from(debankPositionMap.values());
    // Sort the assets, positions by provider and provider positions by their value in USD descending
    positionsArray = positionsArray.map((providerPositions) => ({
        ...providerPositions,
        positions: providerPositions.positions
            .map((position) => ({
            ...position,
            assets: position.assets.sort((a, b) => (b.value || 0) - (a.value || 0))
        }))
            .sort((a, b) => (b.additionalData.positionInUSD || 0) - (a.additionalData.positionInUSD || 0))
    }));
    positionsArray = positionsArray.sort((a, b) => (b.positionInUSD || 0) - (a.positionInUSD || 0));
    return positionsArray;
};
exports.getUniqueMergedPositions = getUniqueMergedPositions;
/**
 * Returns the addresses of all assets and their protocolAssets (if applicable) as an
 * array of addresses. These addresses can be used as hints by the portfolio controller.
 */
const getAllAssetsAsHints = (portfolioState) => {
    if (!portfolioState)
        return [];
    const hints = [];
    portfolioState.positionsByProvider.forEach((providerPositions) => {
        providerPositions.positions.forEach((position) => {
            position.assets.forEach((asset) => {
                if (!(0, viem_1.isHex)(asset.address))
                    return;
                hints.push(asset.address.toLowerCase());
                if (asset.protocolAsset) {
                    if (!(0, viem_1.isHex)(asset.protocolAsset.address))
                        return;
                    hints.push(asset.protocolAsset.address.toLowerCase());
                }
            });
        });
    });
    return hints;
};
exports.getAllAssetsAsHints = getAllAssetsAsHints;
/**
 * Calculates the new DeFi positions state based on the latest fetched data
 * from Debank and custom providers and the previous state.
 * It ensures that positions are unique, merged correctly and that if the
 * latest Debank call failed, the previous positions are retained.
 */
const getNewDefiState = (pastPortfolioState, discoveryResponse, customPositionsByProvider, customPositionsError, customProvidersErrors, stkWalletToken, nonceId) => {
    const isForceApiUpdate = !!discoveryResponse?.data?.defi?.isForceUpdate;
    const isDebankCallSuccessful = (0, exports.getIsExternalApiDefiPositionsCallSuccessful)(discoveryResponse);
    const previousPositionsByProvider = pastPortfolioState?.defiPositions?.positionsByProvider || [];
    const debankPositionsByProvider = discoveryResponse?.data?.defi?.positions ||
        // Fallback to the old positions if the call failed or was skipped
        previousPositionsByProvider.filter((p) => p.source !== 'custom');
    const { lastForceApiUpdate, lastSuccessfulUpdate } = pastPortfolioState?.defiPositions || {};
    const stkWalletPosition = (0, providers_1.getStakedWalletPositions)(stkWalletToken);
    const uniqueAndMerged = getUniqueMergedPositions(debankPositionsByProvider, customPositionsByProvider, 
    // Ethereum-specific. Add the Staked Wallet token as a defi position
    stkWalletPosition);
    return {
        nonceId,
        error: !isDebankCallSuccessful ? types_1.DeFiPositionsError.CriticalError : customPositionsError,
        lastSuccessfulUpdate: isDebankCallSuccessful && !customPositionsError ? Date.now() : lastSuccessfulUpdate,
        lastForceApiUpdate: isForceApiUpdate ? Date.now() : lastForceApiUpdate,
        providerErrors: customProvidersErrors,
        positionsByProvider: uniqueAndMerged || previousPositionsByProvider
    };
};
exports.getNewDefiState = getNewDefiState;
/**
 * Formats the response from Debank in a format that is expected by the extension.
 * Invalid positions are excluded from the formatted response.
 */
const getFormattedApiPositions = (result) => {
    return result.map((p) => ({
        ...p,
        source: 'debank',
        chainId: !p.chainId ? undefined : BigInt(p.chainId),
        positions: p.positions
            .map((pos) => {
            try {
                const isCustomAppChain = !p.chainId;
                if (pos.additionalData.name === 'Deposit') {
                    pos.additionalData.name = 'Deposit pool';
                    if (pos.additionalData.pool?.id) {
                        pos.additionalData.positionIndex = (0, shortenAddress_1.default)(pos.additionalData.pool.id, 11);
                    }
                }
                return {
                    ...pos,
                    assets: pos.assets.map((asset) => {
                        let amount = asset.amount;
                        if (isCustomAppChain) {
                            // Amount should be formatted with decimals and turned to bigint after that
                            amount = (0, ethers_1.parseUnits)(String((0, amount_1.getSanitizedAmount)(String(amount), asset.decimals)), asset.decimals);
                            // In else because app assets don't have addresses and we don't want to set them as zero addresses
                        }
                        else {
                            // Debank returns zero addresses like `0x00` as `ethereum/base` which breaks our logic
                            asset.address = (0, viem_1.isHex)(asset.address) ? (0, viem_1.getAddress)(asset.address) : ethers_1.ZeroAddress;
                        }
                        return {
                            ...asset,
                            iconUrl: asset.iconUrl || asset.logo_url || undefined,
                            amount: BigInt(amount),
                            protocolAsset: asset.protocolAsset
                                ? {
                                    ...asset.protocolAsset,
                                    address: (0, viem_1.isHex)(asset.protocolAsset.address)
                                        ? (0, viem_1.getAddress)(asset.protocolAsset.address)
                                        : ethers_1.ZeroAddress
                                }
                                : undefined
                        };
                    })
                };
            }
            catch (error) {
                console.error('DeFi error when mapping positions: ', error, 'position', pos);
                return null;
            }
        })
            .filter(Boolean)
    }));
};
exports.getFormattedApiPositions = getFormattedApiPositions;
/**
 * Groups the portfolio tokens by their lowercased address, keeping the original
 * order within each group, so that looking a token up by address doesn't
 * require a scan of the whole list.
 */
const groupTokensByLowercasedAddress = (portfolioTokens) => {
    const tokensByAddress = new Map();
    portfolioTokens.forEach((token) => {
        const address = token.address.toLowerCase();
        const sameAddressTokens = tokensByAddress.get(address);
        if (sameAddressTokens)
            sameAddressTokens.push(token);
        else
            tokensByAddress.set(address, [token]);
    });
    return tokensByAddress;
};
/**
 * Finds the portfolio token that a DeFi position asset refers to by its address.
 * An exact address match wins over a case-insensitive one, and rewards and gas
 * tank tokens are never a protocol asset. Returns undefined if the portfolio
 * holds no such token.
 */
const findTokenByProtocolAssetAddress = (tokensByAddress, protocolAssetAddress) => tokensByAddress
    .get(protocolAssetAddress.toLowerCase())
    ?.find((token) => token.address === protocolAssetAddress ||
    (!token.flags.rewardsType && !token.flags.onGasTank));
/**
 * Finds the portfolio token that a DeFi position asset with no protocol asset
 * refers to. Nothing but the symbol links the two, so a match is accepted only
 * when both also hold nearly the same value, otherwise two unrelated tokens
 * sharing a symbol would be treated as one. Returns undefined when there is no
 * confident match.
 *
 * This scans every token and prices each candidate, so only reach for it when
 * there is no address to match on.
 */
const findTokenBySimilarSymbolAndValue = (portfolioTokens, asset) => {
    const assetValue = asset.value;
    // If the token or asset don't have a value we MUST! not compare them
    // by value as that would lead to false positives
    if (!assetValue)
        return undefined;
    const assetSymbol = asset.symbol.toLowerCase();
    return portfolioTokens.find((token) => {
        if (token.flags.rewardsType || token.flags.onGasTank)
            return false;
        const symbol = token.symbol.toLowerCase();
        // The portfolio token should contain the asset symbol, but be a different token
        if (symbol === assetSymbol || !symbol.includes(assetSymbol))
            return false;
        const priceUSD = token.priceIn.find(({ baseCurrency }) => baseCurrency.toLowerCase() === 'usd')?.price;
        if (!priceUSD)
            return false;
        const tokenBalanceUSD = Number((0, formatters_1.safeTokenAmountAndNumberMultiplication)(BigInt(token.amountPostSimulation || token.amount), token.decimals, priceUSD));
        if (!tokenBalanceUSD)
            return false;
        return (0, helpers_1.isTokenPriceWithinHalfPercent)(tokenBalanceUSD, assetValue);
    });
};
/**
 * Enhances the portfolio tokens with Defi position data.
 * Examples:
 * - Marks tokens that are part of a DeFi position with the position ID.
 * - Sets the defiTokenType flag based on the asset type in the DeFi position.
 * - Adjusts token prices for borrowed assets.
 * - Adds missing tokens that are part of DeFi positions but not in the portfolio tokens. This is a very rare
 * case in which the token is not found by Cena/Debank but is part of a custom defi position. Because they are fetched
 * after the portfolio tokens we need to add them here. This is needed only the first time as subsequent requests receive
 * the tokens as hints. (See `getAllAssetsAsHints`)
 */
const enhancePortfolioTokensWithDefiPositions = (portfolioTokens, defiPositionsState) => {
    if (!defiPositionsState)
        return portfolioTokens;
    try {
        const defiAssetsMap = new Map();
        const notYetHandledTokensToAdd = [];
        const tokensByAddress = groupTokensByLowercasedAddress(portfolioTokens);
        defiPositionsState.positionsByProvider.forEach((posByProvider) => {
            // Skip app providers
            const posChainId = posByProvider.chainId;
            if (!posChainId)
                return;
            posByProvider.positions.forEach((pos) => {
                try {
                    const controllerAddress = pos.additionalData?.pool?.controller;
                    if (controllerAddress) {
                        defiAssetsMap.set(controllerAddress.toLowerCase(), {
                            positionId: pos.id,
                            assetType: types_1.AssetType.Collateral,
                            priceIn: []
                        });
                    }
                    pos.assets.forEach((asset) => {
                        const protocolAsset = asset.protocolAsset || null;
                        const tokenCorrespondingToProtocolAsset = protocolAsset?.address
                            ? findTokenByProtocolAssetAddress(tokensByAddress, protocolAsset.address)
                            : findTokenBySimilarSymbolAndValue(portfolioTokens, asset);
                        if (tokenCorrespondingToProtocolAsset) {
                            defiAssetsMap.set(tokenCorrespondingToProtocolAsset.address.toLowerCase(), {
                                assetType: asset.type,
                                positionId: pos.id,
                                priceIn: asset.priceIn ? [asset.priceIn] : []
                            });
                        }
                        else if (protocolAsset &&
                            'address' in protocolAsset &&
                            'decimals' in protocolAsset &&
                            'symbol' in protocolAsset &&
                            'name' in protocolAsset &&
                            typeof protocolAsset.decimals === 'number' &&
                            typeof protocolAsset.symbol === 'string' &&
                            typeof protocolAsset.name === 'string') {
                            notYetHandledTokensToAdd.push({
                                amount: asset.amount,
                                latestAmount: asset.amount,
                                marketDataIn: [],
                                // Only list the borrowed asset with no price
                                priceIn: asset.type === types_1.AssetType.Collateral && asset.priceIn ? [asset.priceIn] : [],
                                decimals: Number(protocolAsset.decimals),
                                address: protocolAsset.address,
                                symbol: protocolAsset.symbol,
                                name: protocolAsset.name,
                                chainId: BigInt(posChainId),
                                flags: {
                                    canTopUpGasTank: false,
                                    isFeeToken: false,
                                    onGasTank: false,
                                    rewardsType: null,
                                    defiTokenType: asset.type,
                                    defiPositionId: pos.id
                                }
                            });
                        }
                    });
                }
                catch (e) {
                    console.error('Failed to enhance a portfolio token with DeFi position data.', e);
                }
            });
        });
        const enhancedTokenList = portfolioTokens.map((token) => {
            const defiAssetData = defiAssetsMap.get(token.address.toLowerCase());
            if (!defiAssetData)
                return token;
            let priceIn = token.priceIn;
            // Remove the prices of borrowed assets
            if (defiAssetData?.assetType === types_1.AssetType.Borrow) {
                priceIn = [];
            }
            else if (
            // If the token doesn't have a price in the portfolio but has in the defi state
            // we add it
            defiAssetData.priceIn &&
                (!token.priceIn.length || token.priceIn[0].price <= 0)) {
                priceIn = defiAssetData.priceIn;
            }
            const newToken = {
                ...token,
                priceIn,
                flags: {
                    ...token.flags,
                    defiPositionId: defiAssetData?.positionId,
                    defiTokenType: defiAssetData?.assetType
                }
            };
            defiAssetsMap.delete(token.address);
            return newToken;
        });
        return [...enhancedTokenList, ...notYetHandledTokensToAdd];
    }
    catch (e) {
        console.error('Failed to enhance portfolio tokens with DeFi positions.', e);
        return portfolioTokens;
    }
};
exports.enhancePortfolioTokensWithDefiPositions = enhancePortfolioTokensWithDefiPositions;
const getHasNonceChangedSinceLastUpdate = (previousState, nonceId) => {
    // First time fetching positions
    if (!previousState || !previousState.nonceId)
        return false;
    return nonceId !== previousState.nonceId;
};
exports.getHasNonceChangedSinceLastUpdate = getHasNonceChangedSinceLastUpdate;
/**
 * Describes how fresh the DeFi positions data should be when fetched, based on various factors such as:
 * - Whether the user explicitly requested a refresh (isManualUpdate)
 * - Whether there has been a nonce change since the last update, indicating on-chain activity
 * - Whether there is a scheduled update coming soon (hasScheduledUpdate)
 * - The age of the currently cached data (maxDataAgeMs)
 */
var DefiUpdateMode;
(function (DefiUpdateMode) {
    /** Serve cached data regardless of its age */
    DefiUpdateMode["Cache"] = "cache";
    /** Serve cached data if it is fresh enough, otherwise refetch */
    DefiUpdateMode["Default"] = "default";
    /** Bypass the server-side cache and refetch fresh data (was: `update=true`) */
    DefiUpdateMode["Force"] = "force";
})(DefiUpdateMode || (exports.DefiUpdateMode = DefiUpdateMode = {}));
const DEFI_UPDATE_MODE_RANK = {
    [DefiUpdateMode.Cache]: 0,
    [DefiUpdateMode.Default]: 1,
    [DefiUpdateMode.Force]: 2
};
// The server-side defi cache has a per-account cooldown; we only force a bypass once per window.
const FORCE_API_UPDATE_COOLDOWN_MS = 30000;
const getDefiUpdateMode = (params) => {
    const { previousState, bypassServerSideCache, isManualUpdate, hasKeys, sessionIds, hasNonceChangedSinceLastUpdate, hasScheduledUpdate, maxDataAgeMs } = params;
    // An explicit override always bypasses the server-side cache.
    if (bypassServerSideCache)
        return DefiUpdateMode.Force;
    // There is a scheduled update coming soon that will update defi positions
    const shouldDeferToScheduledUpdate = hasScheduledUpdate && !isManualUpdate;
    // A nonce change means on-chain state changed, so refetch fresh.
    if (hasNonceChangedSinceLastUpdate && !shouldDeferToScheduledUpdate)
        return DefiUpdateMode.Force;
    // Manual update with additional conditions
    const isThrottledManualForceDue = isManualUpdate &&
        !!sessionIds.length &&
        hasKeys &&
        Date.now() - (previousState?.lastForceApiUpdate || 0) >= FORCE_API_UPDATE_COOLDOWN_MS;
    if (isThrottledManualForceDue)
        return DefiUpdateMode.Force;
    // If there isn't a successful update yet do a default update
    // Example: extension boot
    if (!previousState || !previousState.lastSuccessfulUpdate || isManualUpdate)
        return DefiUpdateMode.Default;
    // In this case we don't care about defi positions so the age of the data doesn't matter, we can serve stale data from cache
    // Example: background update
    if (maxDataAgeMs < 0)
        return DefiUpdateMode.Cache;
    // If a specific maxDataAgeMs is set, then we rely on it instead of the default server-side cache age.
    if (Date.now() - previousState.lastSuccessfulUpdate < maxDataAgeMs)
        return DefiUpdateMode.Cache;
    return DefiUpdateMode.Default;
};
exports.getDefiUpdateMode = getDefiUpdateMode;
/**
 * Combines the modes of several batched requests into one (most aggressive mode wins because the request is shared)
 */
const mergeDefiUpdateModes = (modes) => {
    const definedModes = modes.filter((mode) => !!mode);
    if (!definedModes.length)
        return DefiUpdateMode.Default;
    return definedModes.reduce((strongest, mode) => DEFI_UPDATE_MODE_RANK[mode] > DEFI_UPDATE_MODE_RANK[strongest] ? mode : strongest);
};
exports.mergeDefiUpdateModes = mergeDefiUpdateModes;
/**
 * Returns the networks where the account has positions with certainty.
 * Certainty - there are no errors and the rpc is working.
 */
const getAccountNetworksWithPositions = (accountId, accountState, oldNetworksWithPositionsByAccounts, providers) => {
    const networksWithPositions = {
        ...oldNetworksWithPositionsByAccounts[accountId]
    };
    Object.keys(accountState).forEach((chainId) => {
        const state = accountState[chainId]?.result?.defiPositions;
        if (!providers[chainId] || !state)
            return;
        const isRPCDown = !providers[chainId].isWorking;
        const { positionsByProvider, error, providerErrors } = state;
        // RPC is down or an error occurred
        if (error || isRPCDown || providerErrors?.length)
            return;
        networksWithPositions[chainId] = positionsByProvider.reduce((networksWithPositionsByProviders, provider) => {
            if (networksWithPositionsByProviders.includes(provider.providerName))
                return networksWithPositionsByProviders;
            networksWithPositionsByProviders.push(provider.providerName);
            return networksWithPositionsByProviders;
        }, networksWithPositions[chainId] || []);
    });
    return networksWithPositions;
};
exports.getAccountNetworksWithPositions = getAccountNetworksWithPositions;
//# sourceMappingURL=defiPositions.js.map