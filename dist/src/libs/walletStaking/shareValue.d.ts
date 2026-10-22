import { RPCProvider } from '../../interfaces/provider';
import { TokenResult } from '../portfolio/interfaces';
export declare const WALLET_STAKING_CHAIN_ID = 1n;
export declare const X_WALLET_SHARE_VALUE_CACHE_TTL: number;
export declare const X_WALLET_SHARE_VALUE_RPC_TIMEOUT_MS = 6000;
export declare const X_WALLET_LOCKED_SHARES_RPC_TIMEOUT_MS = 6000;
export type XWalletShareValueResult = {
    shareValue: bigint;
    updatedAt: number;
    refreshError?: Error;
};
/** Calculates the WALLET value represented by an xWALLET amount. */
export declare const getWalletAmountFromXWallet: (xWalletAmount: bigint, shareValue: bigint) => bigint;
/** Calculates the xWALLET/stkWALLET shares a WALLET amount would convert into (the inverse of {@link getWalletAmountFromXWallet}). */
export declare const getXWalletAmountFromWallet: (walletAmount: bigint, shareValue: bigint) => bigint;
/**
 * Reads the xWALLET shares the account has already committed to a pending unstake. Those shares
 * stay locked in the staking contract, so only the remainder of the balance can still be migrated.
 * Unlike the share value, this is per account and therefore not cached globally.
 */
export declare const getXWalletLockedShares: (provider: RPCProvider, accountAddr: string) => Promise<bigint>;
/** Formats the shared xWALLET-to-WALLET explanation used across the wallet. */
export declare const getXWalletConversionText: (xWalletAmount: bigint, walletAmount: bigint) => string;
/**
 * Shares the global xWALLET conversion rate between portfolio, staking and signing flows.
 * Failed refreshes keep the last successful value and postpone the next attempt for one hour.
 */
export declare class XWalletShareValueCache {
    #private;
    get(provider: RPCProvider): Promise<XWalletShareValueResult>;
}
export declare const xWalletShareValueCache: XWalletShareValueCache;
type WalletTokenBalance = Pick<TokenResult, 'address' | 'amount' | 'amountPostSimulation'>;
export type XWalletLockedSharesGetter = (provider: RPCProvider, accountAddr: string) => Promise<bigint>;
export type WalletStakingShareValue = {
    shareValue: bigint;
    updatedAt: number;
    /** Undefined while unknown - the per-account lookup is optional and may fail on its own. */
    lockedShares?: bigint;
};
/** An error of the share value lookup, in the shape that controllers emit. */
export type WalletStakingShareValueError = {
    level: 'silent';
    message: string;
    error: Error;
};
/**
 * Returns the xWALLET conversion rate (and the account's locked shares) when the portfolio
 * contains an xWALLET balance. It never throws: failures are reported through `onError`.
 */
export declare const getWalletStakingShareValue: ({ chainId, tokens, provider, accountAddr, onError, shareValueCache, lockedSharesGetter }: {
    chainId: bigint;
    tokens: WalletTokenBalance[];
    provider: RPCProvider;
    accountAddr?: string;
    onError: (error: WalletStakingShareValueError) => void;
    shareValueCache?: Pick<XWalletShareValueCache, "get">;
    lockedSharesGetter?: XWalletLockedSharesGetter;
}) => Promise<WalletStakingShareValue | null>;
export {};
//# sourceMappingURL=shareValue.d.ts.map