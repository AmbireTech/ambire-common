"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWalletStakingShareValue = exports.xWalletShareValueCache = exports.XWalletShareValueCache = exports.getXWalletConversionText = exports.getXWalletLockedShares = exports.getXWalletAmountFromWallet = exports.getWalletAmountFromXWallet = exports.X_WALLET_LOCKED_SHARES_RPC_TIMEOUT_MS = exports.X_WALLET_SHARE_VALUE_RPC_TIMEOUT_MS = exports.X_WALLET_SHARE_VALUE_CACHE_TTL = exports.WALLET_STAKING_CHAIN_ID = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const addresses_1 = require("../../consts/addresses");
const formatDecimals_1 = tslib_1.__importDefault(require("../../utils/formatDecimals/formatDecimals"));
const with_timeout_1 = require("../../utils/with-timeout");
exports.WALLET_STAKING_CHAIN_ID = 1n;
exports.X_WALLET_SHARE_VALUE_CACHE_TTL = 60 * 60 * 1000;
exports.X_WALLET_SHARE_VALUE_RPC_TIMEOUT_MS = 6000;
const X_WALLET_SHARE_VALUE_ABI = 'function shareValue() view returns (uint256)';
const X_WALLET_LOCKED_SHARES_ABI = 'function lockedShares(address) view returns (uint256)';
exports.X_WALLET_LOCKED_SHARES_RPC_TIMEOUT_MS = 6000;
const normalizeError = (error) => error instanceof Error ? error : new Error('Unable to load the WALLET staking conversion rate.');
/** Calculates the WALLET value represented by an xWALLET amount. */
const getWalletAmountFromXWallet = (xWalletAmount, shareValue) => (xWalletAmount * shareValue) / ethers_1.WeiPerEther;
exports.getWalletAmountFromXWallet = getWalletAmountFromXWallet;
/** Calculates the xWALLET/stkWALLET shares a WALLET amount would convert into (the inverse of {@link getWalletAmountFromXWallet}). */
const getXWalletAmountFromWallet = (walletAmount, shareValue) => shareValue > 0n ? (walletAmount * ethers_1.WeiPerEther) / shareValue : 0n;
exports.getXWalletAmountFromWallet = getXWalletAmountFromWallet;
/**
 * Reads the xWALLET shares the account has already committed to a pending unstake. Those shares
 * stay locked in the staking contract, so only the remainder of the balance can still be migrated.
 * Unlike the share value, this is per account and therefore not cached globally.
 */
const getXWalletLockedShares = async (provider, accountAddr) => {
    const contract = new ethers_1.Contract(addresses_1.WALLET_STAKING_ADDR, [X_WALLET_LOCKED_SHARES_ABI], provider);
    const getLockedShares = contract.lockedShares;
    if (typeof getLockedShares !== 'function') {
        throw new Error('The locked xWALLET shares are unavailable.');
    }
    return BigInt(await (0, with_timeout_1.withTimeout)(() => getLockedShares(accountAddr), {
        timeoutMs: exports.X_WALLET_LOCKED_SHARES_RPC_TIMEOUT_MS,
        message: 'The locked xWALLET shares took too long to load.'
    }));
};
exports.getXWalletLockedShares = getXWalletLockedShares;
/** Formats the shared xWALLET-to-WALLET explanation used across the wallet. */
const getXWalletConversionText = (xWalletAmount, walletAmount) => {
    const formattedXWalletAmount = (0, formatDecimals_1.default)(Number((0, ethers_1.formatUnits)(xWalletAmount, 18)), 'amount');
    const formattedWalletAmount = (0, formatDecimals_1.default)(Number((0, ethers_1.formatUnits)(walletAmount, 18)), 'amount');
    return `${formattedXWalletAmount} $xWALLET = ${formattedWalletAmount} $WALLET`;
};
exports.getXWalletConversionText = getXWalletConversionText;
/**
 * Shares the global xWALLET conversion rate between portfolio, staking and signing flows.
 * Failed refreshes keep the last successful value and postpone the next attempt for one hour.
 */
class XWalletShareValueCache {
    #cachedResult;
    #cachedError;
    #expiresAt = 0;
    #refreshPromise;
    async get(provider) {
        if (Date.now() < this.#expiresAt) {
            if (this.#cachedResult)
                return this.#cachedResult;
            throw this.#cachedError || new Error('Unable to load the WALLET staking conversion rate.');
        }
        if (this.#refreshPromise)
            return this.#refreshPromise;
        const refreshPromise = this.#refresh(provider);
        this.#refreshPromise = refreshPromise;
        try {
            return await refreshPromise;
        }
        finally {
            if (this.#refreshPromise === refreshPromise)
                this.#refreshPromise = undefined;
        }
    }
    async #refresh(provider) {
        try {
            const contract = new ethers_1.Contract(addresses_1.WALLET_STAKING_ADDR, [X_WALLET_SHARE_VALUE_ABI], provider);
            const getShareValue = contract.shareValue;
            if (typeof getShareValue !== 'function') {
                throw new Error('The WALLET staking conversion rate is unavailable.');
            }
            const shareValue = BigInt(await (0, with_timeout_1.withTimeout)(() => getShareValue(), {
                timeoutMs: exports.X_WALLET_SHARE_VALUE_RPC_TIMEOUT_MS,
                message: 'The WALLET staking conversion rate took too long to load.'
            }));
            if (shareValue <= 0n) {
                throw new Error('The WALLET staking conversion rate is unavailable.');
            }
            const updatedAt = Date.now();
            this.#cachedResult = { shareValue, updatedAt };
            this.#cachedError = undefined;
            this.#expiresAt = updatedAt + exports.X_WALLET_SHARE_VALUE_CACHE_TTL;
            return this.#cachedResult;
        }
        catch (error) {
            const refreshError = normalizeError(error);
            this.#cachedError = refreshError;
            this.#expiresAt = Date.now() + exports.X_WALLET_SHARE_VALUE_CACHE_TTL;
            if (this.#cachedResult)
                return { ...this.#cachedResult, refreshError };
            throw refreshError;
        }
    }
}
exports.XWalletShareValueCache = XWalletShareValueCache;
exports.xWalletShareValueCache = new XWalletShareValueCache();
/**
 * The locked shares are a nice-to-have next to the conversion rate, so a failure here is
 * reported and swallowed rather than dropping the share value the rest of the app relies on.
 */
const getLockedShares = async (provider, lockedSharesGetter, onError, accountAddr) => {
    if (!accountAddr)
        return undefined;
    try {
        return await lockedSharesGetter(provider, accountAddr);
    }
    catch (error) {
        onError({
            level: 'silent',
            message: 'Unable to load the locked xWALLET shares.',
            error: error instanceof Error ? error : new Error('Unable to load the locked xWALLET shares.')
        });
        return undefined;
    }
};
/**
 * Returns the xWALLET conversion rate (and the account's locked shares) when the portfolio
 * contains an xWALLET balance. It never throws: failures are reported through `onError`.
 */
const getWalletStakingShareValue = async ({ chainId, tokens, provider, accountAddr, onError, shareValueCache = exports.xWalletShareValueCache, lockedSharesGetter = exports.getXWalletLockedShares }) => {
    if (chainId !== exports.WALLET_STAKING_CHAIN_ID)
        return null;
    const hasXWalletBalance = tokens.some((token) => token.address.toLowerCase() === addresses_1.WALLET_STAKING_ADDR.toLowerCase() &&
        (token.amount > 0n || (token.amountPostSimulation || 0n) > 0n));
    if (!hasXWalletBalance)
        return null;
    try {
        const { shareValue, updatedAt, refreshError } = await shareValueCache.get(provider);
        if (refreshError) {
            onError({
                level: 'silent',
                message: 'Unable to refresh the WALLET staking conversion rate.',
                error: refreshError
            });
        }
        return {
            shareValue,
            updatedAt,
            lockedShares: await getLockedShares(provider, lockedSharesGetter, onError, accountAddr)
        };
    }
    catch (error) {
        onError({
            level: 'silent',
            message: 'Unable to load the WALLET staking conversion rate.',
            error: error instanceof Error
                ? error
                : new Error('Unable to load the WALLET staking conversion rate.')
        });
        return null;
    }
};
exports.getWalletStakingShareValue = getWalletStakingShareValue;
//# sourceMappingURL=shareValue.js.map