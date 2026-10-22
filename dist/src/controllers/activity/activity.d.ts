import { TransactionReceipt } from 'ethers';
import { AddressPoisoningMatch } from '../../interfaces/transfer';
import { AmbireIdbDatabase } from '../../services/storage/idbDatabase';
import { Account, AccountId, IAccountsController } from '../../interfaces/account';
import { IActivityController } from '../../interfaces/activity';
import { Banner } from '../../interfaces/banner';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Fetch } from '../../interfaces/fetch';
import { INetworksController, Network } from '../../interfaces/network';
import { IPortfolioController } from '../../interfaces/portfolio';
import { IProvidersController } from '../../interfaces/provider';
import { ISafeController } from '../../interfaces/safe';
import { ISelectedAccountController } from '../../interfaces/selectedAccount';
import { IStorageController } from '../../interfaces/storage';
import { AccountOpIdentifiedBy, BalanceChange, NftBalanceChange, PortfoliosToUpdate, SubmittedAccountOp, SubmittedAccountOpLike } from '../../libs/accountOp/submittedAccountOp';
import { Call } from '../../libs/accountOp/types';
import EventEmitter from '../eventEmitter/eventEmitter';
import { SignedMessage } from './types';
import type { BalanceChangesReceipt } from '../../libs/accountOp/balanceChanges';
export interface Pagination {
    fromPage: number;
    itemsPerPage: number;
}
interface PaginationResult<T> {
    items: T[];
    itemsTotal: number;
    currentPage: number;
    maxPages: number;
}
type AccountsOps = PaginationResult<SubmittedAccountOpLike>;
type AddExternalAccountOpParams = {
    accountAddr: string;
    chainId: bigint;
    txnId: string;
    receipt: TransactionReceipt;
    callId?: Call['id'];
    shouldLearnTokens?: boolean;
};
type AccountOpBalanceChangesBackfillReference = Pick<SubmittedAccountOp, 'identifiedBy' | 'accountAddr' | 'chainId'>;
type MessagesToBeSigned = PaginationResult<SignedMessage>;
export interface Filters {
    account: string;
    chainId?: bigint;
    identifiedBy?: AccountOpIdentifiedBy;
}
export interface ExternalAccountOps {
    [account: string]: {
        [network: string]: SubmittedAccountOpLike[];
    };
}
/**
 * Activity Controller
 * Manages signed AccountsOps and Messages in controller memory and browser storage.
 *
 * Raw, unfiltered data is stored in private properties `ActivityController.#accountsOps` and
 * `ActivityController.#signedMessages`.
 *
 * Public methods and properties are exposed for retrieving data with filtering and pagination.
 *
 * To apply filters or pagination, call `filterAccountsOps()` or `filterSignedMessages()` with the
 * required parameters. Filtered items are stored in `ActivityController.accountsOps` and
 * `ActivityController.signedMessages` by session ID.
 *
 * Sessions ensure that each page manages its own filters and pagination independently. For example,
 * filters in "Settings -> Transactions History" and "Dashboard -> Activity Tab" are isolated per session.
 *
 * After adding or removing an AccountOp or SignedMessage, call `syncFilteredAccountsOps()` or
 * `syncSignedMessages()` to synchronize filtered data with the source data.
 *
 * The frontend is responsible for clearing filtered items for a session when a component unmounts
 * by calling `resetAccountsOpsFilters()` or `resetSignedMessagesFilters()`. If not cleared, all
 * sessions will be automatically removed when the browser is closed or the controller terminates.
 *
 * 💡 For performance, items per account and network are capped (see MAX_OPS_PER_GROUP).
 * Older items are trimmed, keeping the most recent ones.
 */
export declare class ActivityController extends EventEmitter implements IActivityController {
    #private;
    accountsOps: {
        [sessionId: string]: {
            result: AccountsOps;
            filters: Filters;
            pagination: Pagination;
        };
    };
    signedMessages: {
        [sessionId: string]: {
            result: MessagesToBeSigned;
            filters: Filters;
            pagination: Pagination;
        };
    };
    constructor(storage: IStorageController, fetch: Fetch, callRelayer: Function, accounts: IAccountsController, selectedAccount: ISelectedAccountController, providers: IProvidersController, networks: INetworksController, portfolio: IPortfolioController, safe: ISafeController, featureFlags: IFeatureFlagsController, onContractsDeployed: (network: Network) => Promise<void>, eventEmitterRegistry?: IEventEmitterRegistryController, idb?: AmbireIdbDatabase);
    /** Total ops ever. Not the in-memory lengths — those are only the startup window. */
    getTotalOpsCountForAccount(accountAddr: string): number;
    /**
     * Checks if there are any account operations that were sent to a specific address.
     * Returns history metadata plus an optional poisoning match for first-time recipients.
     */
    hasAccountOpsSentTo(toAddress: string, // the address to check for received transactions
    accountId: AccountId): Promise<{
        found: boolean;
        lastTransactionDate: Date | null;
        addressPoisoningMatch: AddressPoisoningMatch | null;
    }>;
    filterAccountsOps(sessionId: string, filters: Filters, pagination?: Pagination): Promise<void>;
    setDashboardBannersSeen(sessionId: string, accountAddr: string, params?: {
        accountOpIds?: SubmittedAccountOp['id'][];
        emitUpdate?: boolean;
        /**
         * When true, the banners are hidden immediately, instead of awaiting the user
         * to leave the screen
         */
        hideImmediately?: boolean;
    }): void;
    resetAccountsOpsFilters(sessionId: string, skipEmit?: boolean): void;
    private syncFilteredAccountsOps;
    /** Persist changed ops, sync filtered views, and emit an update. */
    private persistAccountsOps;
    filterSignedMessages(sessionId: string, filters: Filters, pagination?: Pagination): Promise<void>;
    resetSignedMessagesFilters(sessionId: string): void;
    private syncSignedMessages;
    /** Returns the account ops that the account submitted from this device on one network. */
    getInternalAccountOps(accountAddr: string, chainId: bigint): Promise<SubmittedAccountOp[]>;
    removeNetworkData(chainId: bigint): void;
    addAccountOp(accountOp: SubmittedAccountOp): Promise<void>;
    /**
     * The other accounts (EOAs) that already paid the fee for a transaction of `accountAddr` on
     * `chainId`, checksummed and ordered from the one that paid last. Paying from one of them
     * links nothing new to the account publicly.
     *
     * Only knows what this wallet broadcast: a payer used from another wallet or device is missing,
     * which errs on the side of warning the user. The index is filled on broadcast, so the ops in
     * memory (the recent ones, see STARTUP_RECENT_OPS_LIMIT) are merged in to also cover the ones
     * broadcast before the index existed.
     */
    getFeePayers(accountAddr: string, chainId: bigint): string[];
    /** Returns the address a domain last resolved to when the user sent to it, or null if never. */
    getSentToDomainAddress(domain: string): string | null;
    addExternalAccountOp({ accountAddr, chainId, txnId, receipt, callId, shouldLearnTokens }: AddExternalAccountOpParams): Promise<void>;
    setAccountOpBalanceChanges(identifiedBy: AccountOpIdentifiedBy, accountAddr: string, chainId: bigint, balanceChanges: BalanceChange[] | Error, nftBalanceChanges?: NftBalanceChange[]): Promise<void>;
    /**
     * Use this method for updates from the UI only
     * as we're persisting the state right after the operation
     */
    backfillAccountOpBalanceChangesAndPersist(accountOps: SubmittedAccountOp[]): Promise<void>;
    /**
     * This method calculate the balanche changes and puts them in memory
     * as a reference to #accountOps only.
     * Use backfillAccountOpBalanceChangesAndPersist if you want to persist them.
     * We have this separation in order to persist to storage only after the
     * end of an operation
     */
    backfillAccountOpBalanceChanges(accountOp: AccountOpBalanceChangesBackfillReference): Promise<void>;
    updateAccountsOpsStatuses(accountAddresses?: string[]): Promise<Record<string, {
        shouldEmitUpdate: boolean;
        chainsToUpdate: Network['chainId'][];
        portfoliosToUpdate: PortfoliosToUpdate;
        updatedAccountsOps: SubmittedAccountOp[];
        newestOpTimestamp: number;
        shouldFetchSafeTxns: boolean;
    }>>;
    updateAccountOpBalanceChanges(accountOp: SubmittedAccountOp, network: Network, tokenAddrs: string[], receiptBlockNumber: number, prevBlockNumber?: number, receipts?: BalanceChangesReceipt[], nftBalanceChanges?: NftBalanceChange[]): Promise<BalanceChange[]>;
    addSignedMessage(signedMessage: SignedMessage, account: string): Promise<void>;
    /**
     * Top the newly selected account up to the full startup window.
     *
     * Startup gives every non-selected account a shorter window (see
     * STARTUP_RECENT_OPS_LIMIT_OTHER), so without this the account the user just switched to
     * would render fewer finalized ops than one they started on. Awaited by selectAccount, so
     * the switch does not resolve while the history is still short.
     */
    onSelectedAccountChange(accountAddr: Account['addr']): Promise<void>;
    removeAccountData(address: Account['addr']): Promise<void>;
    get broadcastedButNotConfirmed(): {
        [accAddr: string]: SubmittedAccountOp[];
    };
    findMessage(account: string, filter: (item: SignedMessage) => boolean): Promise<SignedMessage>;
    getConfirmedTxId(submittedAccountOp: SubmittedAccountOp, counter?: number): Promise<string | undefined>;
    findByIdentifiedBy(identifiedBy: AccountOpIdentifiedBy, accountAddr: string, chainId: bigint): SubmittedAccountOp | undefined;
    get banners(): Banner[];
    getAccountOpsForAccount({ accountAddr, from, numberOfItems, sortAccOps }: {
        accountAddr?: string;
        from?: number;
        numberOfItems?: number;
        sortAccOps?: boolean;
    }): SubmittedAccountOp[];
    toJSON(): this & {
        broadcastedButNotConfirmed: {
            [accAddr: string]: SubmittedAccountOp[];
        };
        banners: Banner[];
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=activity.d.ts.map