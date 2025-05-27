import { Account, AccountOnchainState, AccountPreferences, AccountStates } from '../../interfaces/account';
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter';
import { NetworksController } from '../networks/networks';
import { ProvidersController } from '../providers/providers';
import { StorageController } from '../storage/storage';
declare const STATUS_WRAPPED_METHODS: {
    readonly selectAccount: "INITIAL";
    readonly updateAccountPreferences: "INITIAL";
    readonly addAccounts: "INITIAL";
};
export declare class AccountsController extends EventEmitter {
    #private;
    accounts: Account[];
    accountStates: AccountStates;
    accountStatesLoadingState: {
        [chainId: string]: boolean;
    };
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    initialLoadPromise: Promise<void>;
    constructor(storage: StorageController, providers: ProvidersController, networks: NetworksController, onAddAccounts: (accounts: Account[]) => void, updateProviderIsWorking: (chainId: bigint, isWorking: boolean) => void, onAccountStateUpdate: () => void);
    updateAccountStates(blockTag?: string | number, networks?: bigint[]): Promise<void>;
    updateAccountState(accountAddr: Account['addr'], blockTag?: 'pending' | 'latest', networks?: bigint[]): Promise<void>;
    addAccounts(accounts?: Account[]): Promise<void>;
    removeAccountData(address: Account['addr']): void;
    updateAccountPreferences(accounts: {
        addr: string;
        preferences: AccountPreferences;
    }[]): Promise<void>;
    get areAccountStatesLoading(): boolean;
    getOrFetchAccountStates(addr: string): Promise<{
        [chainId: string]: AccountOnchainState;
    }>;
    getOrFetchAccountOnChainState(addr: string, chainId: bigint): Promise<AccountOnchainState>;
    resetAccountsNewlyAddedState(): void;
    forceFetchPendingState(addr: string, chainId: bigint): Promise<AccountOnchainState>;
    toJSON(): this & {
        areAccountStatesLoading: boolean;
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=accounts.d.ts.map