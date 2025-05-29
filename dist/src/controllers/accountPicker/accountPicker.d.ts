import { HD_PATH_TEMPLATE_TYPE } from '../../consts/derivation';
import { Account, AccountOnPage, SelectedAccountForImport } from '../../interfaces/account';
import { Fetch } from '../../interfaces/fetch';
import { KeyIterator } from '../../interfaces/keyIterator';
import { ExternalSignerControllers, ReadyToAddKeys } from '../../interfaces/keystore';
import { AccountsController } from '../accounts/accounts';
import EventEmitter from '../eventEmitter/eventEmitter';
import { KeystoreController } from '../keystore/keystore';
import { NetworksController } from '../networks/networks';
import { ProvidersController } from '../providers/providers';
export declare const DEFAULT_PAGE = 1;
export declare const DEFAULT_PAGE_SIZE = 1;
/**
 * Account Picker Controller
 * is responsible for listing accounts that can be selected for adding, and for
 * adding (creating) identity for the smart accounts (if needed) on the Relayer.
 * It uses a KeyIterator interface allow iterating all the keys in a specific
 * underlying store such as a hardware device or an object holding a seed.
 */
export declare class AccountPickerController extends EventEmitter {
    #private;
    initParams: {
        keyIterator: KeyIterator | null;
        hdPathTemplate: HD_PATH_TEMPLATE_TYPE;
        page?: number;
        pageSize?: number;
        shouldSearchForLinkedAccounts?: boolean;
        shouldGetAccountsUsedOnNetworks?: boolean;
        shouldAddNextAccountAutomatically?: boolean;
    } | null;
    keyIterator?: KeyIterator | null;
    hdPathTemplate?: HD_PATH_TEMPLATE_TYPE;
    isInitialized: boolean;
    shouldSearchForLinkedAccounts: boolean;
    shouldGetAccountsUsedOnNetworks: boolean;
    shouldAddNextAccountAutomatically: boolean;
    page: number;
    pageSize: number;
    pageError: null | string;
    selectedAccountsFromCurrentSession: SelectedAccountForImport[];
    readyToAddAccounts: Account[];
    readyToRemoveAccounts: Account[];
    readyToAddKeys: ReadyToAddKeys;
    addAccountsStatus: 'LOADING' | 'SUCCESS' | 'INITIAL';
    selectNextAccountStatus: 'LOADING' | 'SUCCESS' | 'INITIAL';
    accountsLoading: boolean;
    linkedAccountsLoading: boolean;
    networksWithAccountStateError: bigint[];
    addAccountsPromise?: Promise<void>;
    findAndSetLinkedAccountsPromise?: Promise<void>;
    constructor({ accounts, keystore, networks, providers, externalSignerControllers, relayerUrl, fetch, onAddAccountsSuccessCallback }: {
        accounts: AccountsController;
        keystore: KeystoreController;
        networks: NetworksController;
        providers: ProvidersController;
        externalSignerControllers: ExternalSignerControllers;
        relayerUrl: string;
        fetch: Fetch;
        onAddAccountsSuccessCallback: () => Promise<void>;
    });
    get accountsOnPage(): AccountOnPage[];
    get allKeysOnPage(): string[];
    get selectedAccounts(): SelectedAccountForImport[];
    get addedAccountsFromCurrentSession(): Account[];
    set addedAccountsFromCurrentSession(val: Account[]);
    setInitParams(params: {
        keyIterator: KeyIterator | null;
        hdPathTemplate: HD_PATH_TEMPLATE_TYPE;
        page?: number;
        pageSize?: number;
        shouldSearchForLinkedAccounts?: boolean;
        shouldGetAccountsUsedOnNetworks?: boolean;
        shouldAddNextAccountAutomatically?: boolean;
    }): void;
    init(): Promise<void>;
    get type(): "internal" | "trezor" | "ledger" | "lattice" | undefined;
    get subType(): "seed" | "private-key" | "hw" | undefined;
    reset(resetInitParams?: boolean): Promise<void>;
    resetAccountsSelection(): void;
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
    setPage({ page, pageSize, shouldSearchForLinkedAccounts, shouldGetAccountsUsedOnNetworks }: {
        page: number;
        pageSize?: number;
        shouldSearchForLinkedAccounts?: boolean;
        shouldGetAccountsUsedOnNetworks?: boolean;
    }): Promise<void>;
    /**
     * Triggers the process of adding accounts via the AccountPicker flow by
     * creating identity for the smart accounts (if needed) on the Relayer.
     * Then the `onAccountPickerSuccess` listener in the Main Controller gets
     * triggered, which uses the `readyToAdd...` properties to further set
     * the newly added accounts data (like preferences, keys and others)
     */
    addAccounts(accounts?: SelectedAccountForImport[]): Promise<void>;
    selectNextAccount(): Promise<void>;
    createAndAddEmailAccount(selectedAccount: SelectedAccountForImport): Promise<void>;
    addExistingEmailAccounts(accounts: Account[]): Promise<void>;
    removeNetworkData(chainId: bigint): void;
    toJSON(): this & {
        accountsOnPage: AccountOnPage[];
        allKeysOnPage: string[];
        selectedAccounts: SelectedAccountForImport[];
        addedAccountsFromCurrentSession: Account[];
        type: "internal" | "trezor" | "ledger" | "lattice" | undefined;
        subType: "seed" | "private-key" | "hw" | undefined;
        isPageLocked: boolean;
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
export default AccountPickerController;
//# sourceMappingURL=accountPicker.d.ts.map