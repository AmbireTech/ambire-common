import { Account, AccountPreferences, AccountStates } from '../../interfaces/account';
import { NetworkId } from '../../interfaces/network';
import { Storage } from '../../interfaces/storage';
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter';
import { NetworksController } from '../networks/networks';
import { ProvidersController } from '../providers/providers';
declare const STATUS_WRAPPED_METHODS: {
    readonly selectAccount: "INITIAL";
    readonly updateAccountPreferences: "INITIAL";
};
export declare class AccountsController extends EventEmitter {
    #private;
    accounts: Account[];
    accountStates: AccountStates;
    accountStatesLoadingState: {
        [networkId: string]: boolean;
    };
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    initialLoadPromise: Promise<void>;
    constructor(storage: Storage, providers: ProvidersController, networks: NetworksController, onAddAccounts: (accounts: Account[]) => void, updateProviderIsWorking: (networkId: NetworkId, isWorking: boolean) => void, onAccountStateUpdate: () => void);
    updateAccountStates(blockTag?: string | number, networks?: NetworkId[]): Promise<void>;
    updateAccountState(accountAddr: Account['addr'], blockTag?: 'pending' | 'latest', networks?: NetworkId[]): Promise<void>;
    addAccounts(accounts?: Account[]): Promise<void>;
    removeAccountData(address: Account['addr']): Promise<void>;
    updateAccountPreferences(accounts: {
        addr: string;
        preferences: AccountPreferences;
    }[]): Promise<void>;
    get areAccountStatesLoading(): boolean;
    toJSON(): this & {
        areAccountStatesLoading: boolean;
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=accounts.d.ts.map