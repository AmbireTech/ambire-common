import { Account, AccountOnchainState, AccountPreferences, AccountStates, IAccountsController, SafeAccountCreation } from '../../interfaces/account';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Fetch } from '../../interfaces/fetch';
import { IKeystoreController } from '../../interfaces/keystore';
import { INetworksController } from '../../interfaces/network';
import { IProvidersController } from '../../interfaces/provider';
import { IStorageController } from '../../interfaces/storage';
import { UiManager } from '../../interfaces/ui';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare const STATUS_WRAPPED_METHODS: {
    readonly addAccounts: "INITIAL";
};
type AccountStateBlockTag = 'latest' | 'pending';
/**
 * Stores the wallet accounts and fetches their on-chain state.
 *
 * State fetches run in one queue per account and chain. Calls for different accounts never wait
 * for each other.
 * Calls for the same account run in call order, so an older fetch can't overwrite a newer result.
 * A call without `force` reuses the fetch that runs for its account when the block tag fits, so
 * repeated calls cause no extra RPC load. A call with `force` waits for a fetch that starts after
 * it.
 */
export declare class AccountsController extends EventEmitter implements IAccountsController {
    #private;
    accountStates: AccountStates;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    initialLoadPromise?: Promise<void>;
    accountStateInitialLoadPromise?: Promise<void>;
    constructor(storage: IStorageController, providers: IProvidersController, networks: INetworksController, keystore: IKeystoreController, onAddAccounts: (accounts: Account[]) => void, updateProviderIsWorking: (chainId: bigint, isWorking: boolean) => void, onAccountStateUpdate: () => void, relayerUrl: string, fetch: Fetch, eventEmitterRegistry?: IEventEmitterRegistryController, featureFlags?: IFeatureFlagsController, sendUiMessage?: UiManager['message']['sendUiMessage']);
    get accounts(): Account[];
    set accounts(nextAccounts: Account[]);
    /**
     * Fetches the on-chain state of one account.
     * - Use `'pending'` when the result must count
     * transactions that are not mined yet, such as the nonce for a new op or a check that stops a
     * second Safe deployment.
     * - Use `'latest'` for background refreshes and for facts that must already
     * be mined. `'pending'` differs from `'latest'` only on Ethereum, see
     * `getPendingBlockTagIfSupported`.
     * - Pass `force` when a transaction or a nonce error changed the
     * state, so a fetch that started before the call is not enough.
     */
    updateAccountState(accountAddr: Account['addr'], blockTag?: AccountStateBlockTag, networks?: bigint[], force?: boolean): Promise<void>;
    private updateAccountStates;
    addAccounts(accounts?: Account[]): Promise<void>;
    removeAccountData(address: Account['addr']): void;
    /**
     * Updates the preferences (label, pfp) of the given accounts and saves them.
     * If saving fails, the previous preferences are restored and the error is emitted.
     * When called with a `requestId` (via `dispatchAndWait` in the UI), it also replies
     * once they are saved or failed to save, and the error is emitted silently, as the
     * UI that asked tells the user instead.
     */
    updateAccountPreferences(accounts: {
        addr: string;
        preferences: AccountPreferences;
    }[], requestId?: string): Promise<void>;
    /** Saves recovered Safe creation data on an imported account. */
    updateSafeCreation(addr: Account['addr'], safeCreation: SafeAccountCreation): Promise<void>;
    reorderAccounts({ fromIndex, toIndex }: {
        fromIndex: number;
        toIndex: number;
    }): Promise<void>;
    get areAccountStatesLoading(): boolean;
    getOrFetchAccountStates(addr: string): Promise<{
        [chainId: string]: AccountOnchainState;
    }>;
    getOrFetchAccountOnChainState(addr: string, chainId: bigint): Promise<AccountOnchainState | undefined>;
    resetAccountsNewlyAddedState(): void;
    setViewOnlyAccountIdentitiesIfNeeded(): Promise<void>;
    /**
     * Creates identity for smart accounts on the Relayer and updates the accounts
     * with the identityCreatedAt timestamp. Handles retry mechanism for failed requests.
     */
    createSmartAccountIdentitiesIfNeeded(): Promise<void>;
    toJSON(): this & {
        areAccountStatesLoading: boolean;
        accounts: Account[];
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=accounts.d.ts.map