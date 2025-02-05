import { HD_PATH_TEMPLATE_TYPE } from '../../consts/derivation';
import { Account, AccountOnPage, SelectedAccountForImport } from '../../interfaces/account';
import { Fetch } from '../../interfaces/fetch';
import { KeyIterator } from '../../interfaces/keyIterator';
import { ReadyToAddKeys } from '../../interfaces/keystore';
import { Network, NetworkId } from '../../interfaces/network';
import { AccountsController } from '../accounts/accounts';
import EventEmitter from '../eventEmitter/eventEmitter';
import { KeystoreController } from '../keystore/keystore';
import { NetworksController } from '../networks/networks';
import { ProvidersController } from '../providers/providers';
export declare const DEFAULT_PAGE = 1;
export declare const DEFAULT_PAGE_SIZE = 5;
/**
 * Account Adder Controller
 * is responsible for listing accounts that can be selected for adding, and for
 * adding (creating) identity for the smart accounts (if needed) on the Relayer.
 * It uses a KeyIterator interface allow iterating all the keys in a specific
 * underlying store such as a hardware device or an object holding a seed.
 */
export declare class AccountAdderController extends EventEmitter {
    #private;
    hdPathTemplate?: HD_PATH_TEMPLATE_TYPE;
    isInitialized: boolean;
    isInitializedWithSavedSeed: boolean;
    shouldSearchForLinkedAccounts: boolean;
    shouldGetAccountsUsedOnNetworks: boolean;
    page: number;
    pageSize: number;
    pageError: null | string;
    selectedAccounts: SelectedAccountForImport[];
    readyToAddAccounts: Account[];
    readyToAddKeys: ReadyToAddKeys;
    addAccountsStatus: 'LOADING' | 'SUCCESS' | 'INITIAL';
    accountsLoading: boolean;
    linkedAccountsLoading: boolean;
    networksWithAccountStateError: NetworkId[];
    constructor({ accounts, keystore, networks, providers, relayerUrl, fetch }: {
        accounts: AccountsController;
        keystore: KeystoreController;
        networks: NetworksController;
        providers: ProvidersController;
        relayerUrl: string;
        fetch: Fetch;
    });
    get accountsOnPage(): AccountOnPage[];
    init({ keyIterator, page, pageSize, hdPathTemplate, shouldSearchForLinkedAccounts, shouldGetAccountsUsedOnNetworks }: {
        keyIterator: KeyIterator | null;
        page?: number;
        pageSize?: number;
        hdPathTemplate: HD_PATH_TEMPLATE_TYPE;
        shouldSearchForLinkedAccounts?: boolean;
        shouldGetAccountsUsedOnNetworks?: boolean;
    }): Promise<void>;
    get type(): string | undefined;
    get subType(): "seed" | "private-key" | undefined;
    reset(): void;
    setHDPathTemplate({ hdPathTemplate }: {
        hdPathTemplate: HD_PATH_TEMPLATE_TYPE;
    }): Promise<void>;
    selectAccount(_account: Account): void;
    deselectAccount(account: Account): void;
    /**
     * For internal keys only! Returns the ready to be added internal (private)
     * keys of the currently selected accounts.
     */
    retrieveInternalKeysOfSelectedAccounts(): {
        addr: string;
        type: "internal";
        label: string;
        privateKey: string;
        dedicatedToOneSA: boolean;
        meta: {
            createdAt: number;
        };
    }[];
    /**
     * Prevents requesting the next page before the current one is fully loaded.
     * This avoids race conditions where the user requests the next page before
     * linked accounts are fully loaded, causing misleadingly failing `#verifyLinkedAccounts` checks.
     */
    get isPageLocked(): boolean;
    setPage({ page }: {
        page: number;
    }): Promise<void>;
    /**
     * Triggers the process of adding accounts via the AccountAdder flow by
     * creating identity for the smart accounts (if needed) on the Relayer.
     * Then the `onAccountAdderSuccess` listener in the Main Controller gets
     * triggered, which uses the `readyToAdd...` properties to further set
     * the newly added accounts data (like preferences, keys and others)
     */
    addAccounts(accounts?: SelectedAccountForImport[], readyToAddKeys?: ReadyToAddKeys): Promise<void>;
    createAndAddEmailAccount(selectedAccount: SelectedAccountForImport): Promise<void>;
    addExistingEmailAccounts(accounts: Account[]): Promise<void>;
    removeNetworkData(id: Network['id']): void;
    toJSON(): this & {
        accountsOnPage: AccountOnPage[];
        type: string | undefined;
        subType: "seed" | "private-key" | undefined;
        isPageLocked: boolean;
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
export default AccountAdderController;
//# sourceMappingURL=accountAdder.d.ts.map