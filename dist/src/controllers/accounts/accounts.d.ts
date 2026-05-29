import { Account, AccountOnchainState, AccountPreferences, AccountStates, IAccountsController } from '../../interfaces/account';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { Fetch } from '../../interfaces/fetch';
import { IKeystoreController } from '../../interfaces/keystore';
import { INetworksController } from '../../interfaces/network';
import { IProvidersController } from '../../interfaces/provider';
import { IStorageController } from '../../interfaces/storage';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare const STATUS_WRAPPED_METHODS: {
    readonly addAccounts: "INITIAL";
};
export declare class AccountsController extends EventEmitter implements IAccountsController {
    #private;
    accountStates: AccountStates;
    accountStatesLoadingState: {
        [chainId: string]: Promise<AccountOnchainState[]> | undefined;
    };
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    initialLoadPromise?: Promise<void>;
    accountStateInitialLoadPromise?: Promise<void>;
    constructor(storage: IStorageController, providers: IProvidersController, networks: INetworksController, keystore: IKeystoreController, onAddAccounts: (accounts: Account[]) => void, updateProviderIsWorking: (chainId: bigint, isWorking: boolean) => void, onAccountStateUpdate: () => void, relayerUrl: string, fetch: Fetch, eventEmitterRegistry?: IEventEmitterRegistryController);
    get accounts(): Account[];
    set accounts(nextAccounts: Account[]);
    updateAccountState(accountAddr: Account['addr'], blockTag?: 'pending' | 'latest', networks?: bigint[]): Promise<void>;
    private updateAccountStates;
    addAccounts(accounts?: Account[]): Promise<void>;
    removeAccountData(address: Account['addr']): void;
    updateAccountPreferences(accounts: {
        addr: string;
        preferences: AccountPreferences;
    }[]): Promise<void>;
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
    forceFetchPendingState(addr: string, chainId: bigint): Promise<AccountOnchainState>;
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
//# sourceMappingURL=accounts.d.ts.map