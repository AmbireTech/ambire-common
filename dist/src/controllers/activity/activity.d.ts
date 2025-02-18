import { Account, AccountId } from '../../interfaces/account';
import { Banner } from '../../interfaces/banner';
import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
import { Storage } from '../../interfaces/storage';
import { Message } from '../../interfaces/userRequest';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { AccountsController } from '../accounts/accounts';
import EventEmitter from '../eventEmitter/eventEmitter';
import { NetworksController } from '../networks/networks';
import { ProvidersController } from '../providers/providers';
import { SelectedAccountController } from '../selectedAccount/selectedAccount';
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
export interface SignedMessage extends Message {
    dapp: {
        name: string;
        icon: string;
    } | null;
    timestamp: number;
}
interface AccountsOps extends PaginationResult<SubmittedAccountOp> {
}
interface MessagesToBeSigned extends PaginationResult<SignedMessage> {
}
export interface Filters {
    account: string;
    network?: string;
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
 * `syncFilteredSignedMessages()` to synchronize filtered data with the source data.
 *
 * The frontend is responsible for clearing filtered items for a session when a component unmounts
 * by calling `resetAccountsOpsFilters()` or `resetSignedMessagesFilters()`. If not cleared, all
 * sessions will be automatically removed when the browser is closed or the controller terminates.
 *
 * 💡 For performance, items per account and network are limited to 1000.
 * Older items are trimmed, keeping the most recent ones.
 */
export declare class ActivityController extends EventEmitter {
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
    constructor(storage: Storage, fetch: Fetch, callRelayer: Function, accounts: AccountsController, selectedAccount: SelectedAccountController, providers: ProvidersController, networks: NetworksController, onContractsDeployed: (network: Network) => Promise<void>);
    filterAccountsOps(sessionId: string, filters: Filters, pagination?: Pagination): Promise<void>;
    resetAccountsOpsFilters(sessionId: string): void;
    private syncFilteredAccountsOps;
    filterSignedMessages(sessionId: string, filters: Filters, pagination?: Pagination): Promise<void>;
    resetSignedMessagesFilters(sessionId: string): void;
    private syncSignedMessages;
    removeNetworkData(id: Network['id']): void;
    addAccountOp(accountOp: SubmittedAccountOp): Promise<void>;
    /**
     * Update AccountsOps statuses (inner and public state, and storage)
     *
     * Here is the algorithm:
     * 0. Once we broadcast an AccountOp, we are adding it to ActivityController via `addAccountOp`,
     * and are setting its status to AccountOpStatus.BroadcastedButNotConfirmed.
     * 1. Here, we firstly rely on `getTransactionReceipt` for determining the status (success or failure).
     * 2. If we don't manage to determine its status, we are comparing AccountOp and Account nonce.
     * If Account nonce is greater than AccountOp, then we know that AccountOp has past nonce (AccountOpStatus.UnknownButPastNonce).
     */
    updateAccountsOpsStatuses(): Promise<{
        shouldEmitUpdate: boolean;
        shouldUpdatePortfolio: boolean;
        updatedAccountsOps: SubmittedAccountOp[];
        newestOpTimestamp: number;
    }>;
    addSignedMessage(signedMessage: SignedMessage, account: string): Promise<void>;
    removeAccountData(address: Account['addr']): Promise<void>;
    hideBanner({ addr, network, timestamp }: {
        addr: string;
        network: string;
        timestamp: number;
    }): Promise<void>;
    get broadcastedButNotConfirmed(): SubmittedAccountOp[];
    get banners(): Banner[];
    /**
     * A not confirmed account op can actually be with a status of BroadcastButNotConfirmed
     * and BroadcastButStuck. Typically, it becomes BroadcastButStuck if not confirmed
     * in a 15 minutes interval after becoming BroadcastButNotConfirmed. We need two
     * statuses to hide the banner of BroadcastButNotConfirmed from the dashboard.
     */
    getNotConfirmedOpIfAny(accId: AccountId, networkId: Network['id']): SubmittedAccountOp | null;
    getLastTxn(networkId: Network['id']): SubmittedAccountOp | null;
    findMessage(account: string, filter: (item: SignedMessage) => boolean): Promise<SignedMessage | null | undefined>;
    toJSON(): this & {
        broadcastedButNotConfirmed: SubmittedAccountOp[];
        banners: Banner[];
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=activity.d.ts.map