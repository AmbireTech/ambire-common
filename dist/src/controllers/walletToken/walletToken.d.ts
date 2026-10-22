import { IActivityController } from '../../interfaces/activity';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { IProvidersController } from '../../interfaces/provider';
import { IStorageController } from '../../interfaces/storage';
import { BindedRelayerCall } from '../../libs/relayerCall/relayerCall';
import { PendingWalletWithdrawal } from '../../libs/walletStaking/pendingWithdrawal';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare const WALLET_STAKING_RELAYER_LOGS_TIMEOUT_MS = 5000;
/** Why the transaction ID that the user entered didn't reveal a pending withdrawal. */
export type WalletStakingTxnIdLookupError = 'invalid' | 'not-found' | 'failed';
/** The pending $WALLET withdrawals (unstakes) of one account. */
export interface AccountPendingWalletWithdrawals {
    status: 'loading' | 'loaded' | 'error';
    /** The withdrawal that unlocks last - the one the staking screen shows. */
    latestWithdrawal: PendingWalletWithdrawal | null;
    /** The shares of all active withdrawals, which the xWALLET balance must back. */
    totalShares: bigint;
    txnIdLookupError: WalletStakingTxnIdLookupError | null;
    /**
     * True while a transaction ID that the user entered is checked. Kept apart from `status`, so
     * that the check doesn't replace the screen with a loader.
     */
    isTxnIdLookupLoading: boolean;
}
/**
 * Loads the pending $WALLET withdrawals (unstakes) of each account. The xWALLET conversion rate
 * that the portfolio shows is loaded by the portfolio itself (`getWalletStakingShareValue`).
 *
 * The withdrawals are found from the staking contract's leave logs. The relayer returns them,
 * but that sends the account address to the relayer, so the user can opt out
 * (`walletStakingWithdrawalsLookup`). Then the logs are read from the receipts of the unstake
 * transactions made from this device and of the transaction IDs that the user enters. The logs
 * of active withdrawals are stored, so a withdrawal found once stays known.
 */
export declare class WalletTokenController extends EventEmitter {
    #private;
    pendingWithdrawals: {
        [accountAddr: string]: AccountPendingWalletWithdrawals;
    };
    initialLoadPromise?: Promise<void>;
    constructor({ eventEmitterRegistry, storage, featureFlags, providers, callRelayer, activity }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        storage: IStorageController;
        featureFlags: IFeatureFlagsController;
        providers: IProvidersController;
        callRelayer: BindedRelayerCall;
        /** Gives the unstake transactions made from this device. */
        activity: IActivityController;
    });
    /** Loads the account's pending $WALLET withdrawals into `pendingWithdrawals`. */
    loadPendingWithdrawals(accountAddr: string): Promise<void>;
    /**
     * Looks for the account's pending withdrawal in a transaction that the user entered. The leave
     * logs found in it are stored, as if the relayer had returned them. The transaction ID itself
     * is not stored.
     */
    findPendingWithdrawalInTxn(accountAddr: string, txnId: string): Promise<void>;
    toJSON(): this & {
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=walletToken.d.ts.map