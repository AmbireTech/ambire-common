"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountPickerController = exports.DEFAULT_PAGE_SIZE = exports.DEFAULT_PAGE = void 0;
const tslib_1 = require("tslib");
/* eslint-disable @typescript-eslint/no-floating-promises */
const ethers_1 = require("ethers");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const ExternalSignerError_1 = tslib_1.__importDefault(require("../../classes/ExternalSignerError"));
const account_1 = require("../../consts/account");
const deploy_1 = require("../../consts/deploy");
const derivation_1 = require("../../consts/derivation");
const hardwareWallets_1 = require("../../consts/hardwareWallets");
const account_2 = require("../../interfaces/account");
const keystore_1 = require("../../interfaces/keystore");
const account_3 = require("../../libs/account/account");
const accountState_1 = require("../../libs/accountState/accountState");
const keys_1 = require("../../libs/keys/keys");
const relayerCall_1 = require("../../libs/relayerCall/relayerCall");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
exports.DEFAULT_PAGE = 1;
exports.DEFAULT_PAGE_SIZE = 1;
const DEFAULT_SHOULD_SEARCH_FOR_LINKED_ACCOUNTS = true;
const DEFAULT_SHOULD_GET_ACCOUNTS_USED_ON_NETWORKS = true;
const DEFAULT_SHOULD_ADD_NEXT_ACCOUNT_AUTOMATICALLY = true;
/**
 * Account Picker Controller
 * is responsible for listing accounts that can be selected for adding, and for
 * adding (creating) identity for the smart accounts (if needed) on the Relayer.
 * It uses a KeyIterator interface allow iterating all the keys in a specific
 * underlying store such as a hardware device or an object holding a seed.
 */
class AccountPickerController extends eventEmitter_1.default {
    #callRelayer;
    #accounts;
    #keystore;
    #networks;
    #providers;
    #externalSignerControllers;
    initParams = null;
    keyIterator;
    hdPathTemplate;
    isInitialized = false;
    shouldSearchForLinkedAccounts = DEFAULT_SHOULD_SEARCH_FOR_LINKED_ACCOUNTS;
    shouldGetAccountsUsedOnNetworks = DEFAULT_SHOULD_GET_ACCOUNTS_USED_ON_NETWORKS;
    shouldAddNextAccountAutomatically = DEFAULT_SHOULD_ADD_NEXT_ACCOUNT_AUTOMATICALLY;
    /* This is only the index of the current page */
    page = exports.DEFAULT_PAGE;
    /* The number of accounts to be displayed on a single page */
    pageSize = exports.DEFAULT_PAGE_SIZE;
    /* State to indicate the page requested fails to load (and the reason why) */
    pageError = null;
    selectedAccountsFromCurrentSession = [];
    // Accounts which identity is created on the Relayer (if needed), and are ready
    // to be added to the user's account list by the Main Controller
    readyToAddAccounts = [];
    // Accounts that were selected in a previous session but are now deselected in the current one
    readyToRemoveAccounts = [];
    // The keys for the `readyToAddAccounts`, that are ready to be added to the
    // user's keystore by the Main Controller
    readyToAddKeys = { internal: [], external: [] };
    // Identity for the smart accounts must be created on the Relayer, this
    // represents the status of the operation, needed managing UI state
    addAccountsStatus = 'INITIAL';
    selectNextAccountStatus = 'INITIAL';
    #addedAccountsFromCurrentSession = [];
    accountsLoading = false;
    linkedAccountsLoading = false;
    networksWithAccountStateError = [];
    #derivedAccounts = [];
    #linkedAccounts = [];
    #alreadyImportedAccounts = [];
    addAccountsPromise;
    #onAddAccountsSuccessCallback;
    #onAddAccountsSuccessCallbackPromise;
    findAndSetLinkedAccountsPromise;
    #shouldDebounceFlags = {};
    #addAccountsOnKeystoreReady = null;
    constructor({ accounts, keystore, networks, providers, externalSignerControllers, relayerUrl, fetch, onAddAccountsSuccessCallback }) {
        super();
        this.#accounts = accounts;
        this.#keystore = keystore;
        this.#networks = networks;
        this.#providers = providers;
        this.#externalSignerControllers = externalSignerControllers;
        this.#callRelayer = relayerCall_1.relayerCall.bind({ url: relayerUrl, fetch });
        this.#onAddAccountsSuccessCallback = onAddAccountsSuccessCallback;
        this.#accounts.onUpdate(() => {
            this.#debounceFunctionCalls('update-accounts', () => {
                if (!this.isInitialized)
                    return;
                if (this.addAccountsStatus !== 'INITIAL')
                    return;
                this.#updateStateWithTheLatestFromAccounts();
            }, 20);
        });
        this.#keystore.onUpdate(() => {
            if (this.#addAccountsOnKeystoreReady && this.#keystore.isReadyToStoreKeys) {
                this.addAccounts(this.#addAccountsOnKeystoreReady.accounts);
                this.#addAccountsOnKeystoreReady = null;
            }
        });
    }
    get accountsOnPage() {
        const processedAccounts = this.#derivedAccounts
            // Remove smart accounts derived programmatically, because since v4.60.0
            // unused smart accounts are no longer displayed on page.
            .filter((a) => !(0, account_3.isSmartAccount)(a.account))
            // The displayed (visible) accounts on page should not include the derived
            // EOA (basic) accounts only used as smart account keys, they should not
            // be visible nor importable (or selectable).
            .filter((x) => !(0, account_3.isDerivedForSmartAccountKeyOnly)(x.index))
            .flatMap((derivedAccount) => {
            const associatedLinkedAccounts = this.#linkedAccounts.filter((linkedAcc) => !(0, account_3.isSmartAccount)(derivedAccount.account) &&
                linkedAcc.account.associatedKeys.includes(derivedAccount.account.addr));
            const correspondingSmartAccount = this.#derivedAccounts.find((acc) => (0, account_3.isSmartAccount)(acc.account) && acc.slot === derivedAccount.slot);
            let accountsToReturn = [];
            if (!(0, account_3.isSmartAccount)(derivedAccount.account)) {
                accountsToReturn.push(derivedAccount);
                const duplicate = associatedLinkedAccounts.find((linkedAcc) => linkedAcc.account.addr === correspondingSmartAccount?.account?.addr);
                // The derived smart account that matches the relayer's linked account
                // should not be displayed as linked account. Use this cycle to mark it.
                if (duplicate)
                    duplicate.isLinked = false;
                if (!duplicate && correspondingSmartAccount) {
                    accountsToReturn.push(correspondingSmartAccount);
                }
            }
            accountsToReturn = accountsToReturn.concat(associatedLinkedAccounts.map((linkedAcc) => ({
                ...linkedAcc,
                slot: derivedAccount.slot,
                index: derivedAccount.index
            })));
            return accountsToReturn;
        });
        const unprocessedLinkedAccounts = this.#linkedAccounts
            .filter((linkedAcc) => !processedAccounts.find((processedAcc) => processedAcc?.account.addr === linkedAcc.account.addr))
            // Use `flatMap` instead of `map` in order to auto remove missing values.
            // The `flatMap` has a built-in mechanism to flatten the array and remove
            // null or undefined values (by returning empty array).
            .flatMap((linkedAcc) => {
            const correspondingDerivedAccount = this.#derivedAccounts.find((derivedAccount) => linkedAcc.account.associatedKeys.includes(derivedAccount.account.addr));
            // The `correspondingDerivedAccount` should always be found, except when
            // something is wrong with the data we have stored on the Relayer.
            // The this.#verifyLinkedAndDerivedAccounts() method should have
            // already emitted an error in that case. Do not emit here, since
            // this is a getter method (and emitting here is a no-go).
            if (!correspondingDerivedAccount)
                return [];
            return [
                {
                    ...linkedAcc,
                    slot: correspondingDerivedAccount.slot,
                    index: correspondingDerivedAccount.index
                }
            ];
        });
        const mergedAccounts = [...processedAccounts, ...unprocessedLinkedAccounts].filter((a) => !(0, account_3.isSmartAccount)(a.account) ||
            ((0, account_3.isSmartAccount)(a.account) &&
                this.#linkedAccounts.find((linkedAcc) => linkedAcc.account.addr === a.account.addr)));
        mergedAccounts.sort((a, b) => {
            const prioritizeAccountType = (item) => {
                if (!(0, account_3.isSmartAccount)(item.account))
                    return -1;
                if (item.isLinked)
                    return 1;
                return 0;
            };
            return prioritizeAccountType(a) - prioritizeAccountType(b) || a.slot - b.slot;
        });
        const accountsWithStatus = mergedAccounts.map((acc) => ({
            ...acc,
            importStatus: (0, account_3.getAccountImportStatus)({
                account: acc.account,
                alreadyImportedAccounts: this.#alreadyImportedAccounts,
                keys: this.#keystore.keys,
                accountsOnPage: mergedAccounts,
                keyIteratorType: this.keyIterator?.type
            })
        }));
        // Since v4.60.0 there should always be 1 unused Smart Account on the page,
        // except when all smart accounts are found via linked accounts (therefore, used).
        const nextUnusedSmartAcc = this.#derivedAccounts
            .filter((acc) => (0, account_3.isSmartAccount)(acc.account))
            .filter((acc) => !accountsWithStatus.map((as) => as.account.addr).includes(acc.account.addr))
            .sort((a, b) => a.index - b.index)[0];
        if (nextUnusedSmartAcc) {
            accountsWithStatus.push({
                ...nextUnusedSmartAcc,
                importStatus: (0, account_3.getAccountImportStatus)({
                    account: nextUnusedSmartAcc.account,
                    alreadyImportedAccounts: this.#alreadyImportedAccounts,
                    keys: this.#keystore.keys,
                    accountsOnPage: mergedAccounts,
                    keyIteratorType: this.keyIterator?.type
                })
            });
        }
        return accountsWithStatus;
    }
    get allKeysOnPage() {
        const derivedKeys = this.#derivedAccounts.flatMap((a) => a.account.associatedKeys);
        const linkedKeys = this.#linkedAccounts.flatMap((a) => a.account.associatedKeys);
        return [...new Set([...derivedKeys, ...linkedKeys])];
    }
    get selectedAccounts() {
        const accountsOnPageWithKeys = this.#alreadyImportedAccounts.filter((a) => this.#keystore.keys.some((k) => a.associatedKeys.includes(k.addr)));
        const accountsAddrOnPage = accountsOnPageWithKeys.map((a) => a.addr);
        const selectedAccountsFromPrevSession = this.accountsOnPage
            .filter((a) => accountsAddrOnPage.includes(a.account.addr) &&
            a.importStatus === account_2.ImportStatus.ImportedWithTheSameKeys)
            .map((a) => {
            const accountsOnPageWithThisAcc = this.accountsOnPage.filter((accOnPage) => accOnPage.account.addr === a.account.addr);
            const accountKeys = this.#getAccountKeys(a.account, accountsOnPageWithThisAcc);
            return {
                account: a.account,
                isLinked: a.isLinked,
                accountKeys: accountKeys.map((accKey) => ({
                    addr: accKey.account.addr,
                    slot: accKey.slot,
                    index: accKey.index
                }))
            };
        });
        const nextSelectedAccount = [
            ...selectedAccountsFromPrevSession,
            ...this.selectedAccountsFromCurrentSession
        ];
        const readyToRemoveAccountsAddr = this.readyToRemoveAccounts.map((a) => a.addr);
        return nextSelectedAccount.filter((a) => !readyToRemoveAccountsAddr.includes(a.account.addr));
    }
    get addedAccountsFromCurrentSession() {
        return this.#addedAccountsFromCurrentSession;
    }
    set addedAccountsFromCurrentSession(val) {
        this.#addedAccountsFromCurrentSession = Array.from(new Map(val.map((account) => [account.addr, account])).values());
    }
    setInitParams(params) {
        this.initParams = params;
        this.emitUpdate();
    }
    async init() {
        if (!this.initParams)
            return;
        const { keyIterator, hdPathTemplate, page, pageSize, shouldSearchForLinkedAccounts = DEFAULT_SHOULD_SEARCH_FOR_LINKED_ACCOUNTS, shouldGetAccountsUsedOnNetworks = DEFAULT_SHOULD_GET_ACCOUNTS_USED_ON_NETWORKS, shouldAddNextAccountAutomatically = DEFAULT_SHOULD_ADD_NEXT_ACCOUNT_AUTOMATICALLY } = this.initParams;
        await this.reset(false);
        this.keyIterator = keyIterator;
        if (!this.keyIterator)
            return this.#throwMissingKeyIterator();
        this.page = page || exports.DEFAULT_PAGE;
        if (pageSize)
            this.pageSize = pageSize;
        this.hdPathTemplate = hdPathTemplate;
        this.isInitialized = true;
        this.#alreadyImportedAccounts = [...this.#accounts.accounts];
        this.shouldSearchForLinkedAccounts = shouldSearchForLinkedAccounts;
        this.shouldGetAccountsUsedOnNetworks = shouldGetAccountsUsedOnNetworks;
        if (shouldAddNextAccountAutomatically) {
            await this.selectNextAccount();
            await this.addAccounts();
        }
        else {
            await this.forceEmitUpdate();
        }
    }
    get type() {
        return this.keyIterator?.type || this.initParams?.keyIterator?.type;
    }
    get subType() {
        return this.keyIterator?.subType || this.initParams?.keyIterator?.subType;
    }
    async reset(resetInitParams = true) {
        await this.addAccountsPromise;
        if (resetInitParams)
            this.initParams = null;
        this.keyIterator = null;
        this.selectedAccountsFromCurrentSession = [];
        this.page = exports.DEFAULT_PAGE;
        this.pageSize = exports.DEFAULT_PAGE_SIZE;
        this.hdPathTemplate = undefined;
        this.shouldSearchForLinkedAccounts = DEFAULT_SHOULD_SEARCH_FOR_LINKED_ACCOUNTS;
        this.shouldGetAccountsUsedOnNetworks = DEFAULT_SHOULD_GET_ACCOUNTS_USED_ON_NETWORKS;
        this.pageError = null;
        this.linkedAccountsLoading = false;
        this.addAccountsStatus = 'INITIAL';
        this.#derivedAccounts = [];
        this.#linkedAccounts = [];
        this.readyToAddAccounts = [];
        this.networksWithAccountStateError = [];
        this.readyToAddKeys = { internal: [], external: [] };
        this.isInitialized = false;
        this.addedAccountsFromCurrentSession = [];
        this.#addAccountsOnKeystoreReady = null;
        await this.forceEmitUpdate();
    }
    resetAccountsSelection() {
        this.selectedAccountsFromCurrentSession = [];
        this.readyToRemoveAccounts = [];
        this.emitUpdate();
    }
    async setHDPathTemplate({ hdPathTemplate }) {
        if (this.hdPathTemplate === hdPathTemplate)
            return;
        this.hdPathTemplate = hdPathTemplate;
        // Reset the currently selected accounts, because for the keys of these
        // accounts, as of v4.32.0, we don't store their hd path. When import
        // completes, only the latest hd path of the controller is stored.
        this.selectedAccountsFromCurrentSession = [];
        this.#derivedAccounts = [];
        this.emitUpdate();
        await this.setPage({
            page: exports.DEFAULT_PAGE,
            shouldGetAccountsUsedOnNetworks: DEFAULT_SHOULD_GET_ACCOUNTS_USED_ON_NETWORKS,
            shouldSearchForLinkedAccounts: DEFAULT_SHOULD_SEARCH_FOR_LINKED_ACCOUNTS
        }); // takes the user back on the first page
    }
    #getAccountKeys(account, accountsOnPageWithThisAcc) {
        // should never happen
        if (accountsOnPageWithThisAcc.length === 0) {
            console.error(`accountPicker: account ${account.addr} was not found in the accountsOnPage.`);
            return [];
        }
        // Case 1: The account is a EOA
        const isBasicAcc = !(0, account_3.isSmartAccount)(account);
        // The key of the EOA is the EOA itself
        if (isBasicAcc)
            return accountsOnPageWithThisAcc;
        // Case 2: The account is a Smart account, but not a linked one
        const isSmartAccountAndNotLinked = (0, account_3.isSmartAccount)(account) &&
            accountsOnPageWithThisAcc.length === 1 &&
            accountsOnPageWithThisAcc[0].isLinked === false;
        if (isSmartAccountAndNotLinked) {
            // The key of the smart account is the EOA on the same slot
            // that is explicitly derived for a smart account key only.
            const basicAccOnThisSlotDerivedForSmartAccKey = this.#derivedAccounts.find((a) => a.slot === accountsOnPageWithThisAcc[0].slot &&
                !(0, account_3.isSmartAccount)(a.account) &&
                (0, account_3.isDerivedForSmartAccountKeyOnly)(a.index));
            return basicAccOnThisSlotDerivedForSmartAccKey
                ? [basicAccOnThisSlotDerivedForSmartAccKey]
                : [];
        }
        // Case 3: The account is a Smart account and a linked one. For this case,
        // there could exist multiple keys (EOAs) found on different slots.
        const basicAccOnEverySlotWhereThisAddrIsFound = accountsOnPageWithThisAcc
            .map((a) => a.slot)
            .flatMap((slot) => {
            const basicAccOnThisSlot = this.#derivedAccounts.find((a) => a.slot === slot &&
                !(0, account_3.isSmartAccount)(a.account) &&
                // The key of the linked account is always the EOA (basic) account
                // on the same slot that is not explicitly used for smart account keys only.
                !(0, account_3.isDerivedForSmartAccountKeyOnly)(a.index));
            return basicAccOnThisSlot ? [basicAccOnThisSlot] : [];
        });
        return basicAccOnEverySlotWhereThisAddrIsFound;
    }
    selectAccount(_account) {
        if (!this.isInitialized)
            return this.#throwNotInitialized();
        if (!this.keyIterator)
            return this.#throwMissingKeyIterator();
        // Needed, because linked accounts could have multiple keys (EOAs),
        // and therefore - same linked account could be found on different slots.
        const accountsOnPageWithThisAcc = this.accountsOnPage.filter((accOnPage) => accOnPage.account.addr === _account.addr);
        const accountKeys = this.#getAccountKeys(_account, accountsOnPageWithThisAcc);
        if (!accountKeys.length)
            return this.emitError({
                level: 'major',
                message: `Selecting ${_account.addr} account failed because the details for this account are missing. Please try again or contact support if the problem persists.`,
                error: new Error(`Trying to select ${_account.addr} account, but this account was not found in the accountsOnPage or it's keys were not found.`)
            });
        const nextSelectedAccount = {
            account: _account,
            // If the account has more than 1 key, it is for sure linked account,
            // since EOAs have only 1 key and smart accounts with more than
            // one key present should always be found as linked accounts anyways.
            isLinked: accountKeys.length > 1,
            accountKeys: accountKeys.map((a) => ({
                addr: a.account.addr,
                slot: a.slot,
                index: a.index
            }))
        };
        const accountExists = this.selectedAccountsFromCurrentSession.some((x) => x.account.addr === nextSelectedAccount.account.addr);
        if (!accountExists)
            this.selectedAccountsFromCurrentSession.push(nextSelectedAccount);
        this.readyToRemoveAccounts = this.readyToRemoveAccounts.filter((a) => a.addr !== nextSelectedAccount.account.addr);
        this.emitUpdate();
    }
    deselectAccount(account) {
        if (!this.isInitialized)
            return this.#throwNotInitialized();
        if (!this.keyIterator)
            return this.#throwMissingKeyIterator();
        if (!this.selectedAccounts.find((x) => x.account.addr === account.addr))
            return;
        this.selectedAccountsFromCurrentSession = this.selectedAccountsFromCurrentSession.filter((a) => a.account.addr !== account.addr);
        const accountInAlreadyAddedAccounts = this.#alreadyImportedAccounts.find((a) => a.addr === account.addr);
        if (accountInAlreadyAddedAccounts) {
            const accountInReadyToRemoveAccounts = this.readyToRemoveAccounts.find((a) => a.addr === account.addr);
            if (!accountInReadyToRemoveAccounts)
                this.readyToRemoveAccounts.push(account);
        }
        this.emitUpdate();
    }
    /**
     * For internal keys only! Returns the ready to be added internal (private)
     * keys of the currently selected accounts.
     */
    retrieveInternalKeysOfSelectedAccounts() {
        if (!this.hdPathTemplate) {
            this.#throwMissingHdPath();
            return [];
        }
        if (!this.keyIterator?.retrieveInternalKeys) {
            this.#throwMissingKeyIteratorRetrieveInternalKeysMethod();
            return [];
        }
        return this.keyIterator?.retrieveInternalKeys(this.selectedAccountsFromCurrentSession, this.hdPathTemplate, this.#keystore.keys);
    }
    /**
     * Prevents requesting the next page before the current one is fully loaded.
     * This avoids race conditions where the user requests the next page before
     * linked accounts are fully loaded, causing misleadingly failing `#verifyLinkedAccounts` checks.
     */
    get isPageLocked() {
        return this.accountsLoading || this.linkedAccountsLoading;
    }
    async setPage({ page = this.page, pageSize, shouldSearchForLinkedAccounts, shouldGetAccountsUsedOnNetworks }) {
        if (!this.isInitialized)
            return this.#throwNotInitialized();
        if (!this.keyIterator)
            return this.#throwMissingKeyIterator();
        if (shouldSearchForLinkedAccounts !== undefined) {
            this.shouldSearchForLinkedAccounts = shouldSearchForLinkedAccounts;
        }
        if (shouldGetAccountsUsedOnNetworks !== undefined) {
            this.shouldGetAccountsUsedOnNetworks = shouldGetAccountsUsedOnNetworks;
        }
        if (pageSize && pageSize !== this.pageSize) {
            this.pageSize = pageSize;
            this.page = page;
        }
        else if (page === this.page && this.#derivedAccounts.length)
            return;
        this.page = page;
        this.pageError = null;
        this.#derivedAccounts = [];
        this.#linkedAccounts = [];
        this.accountsLoading = true;
        this.networksWithAccountStateError = [];
        this.linkedAccountsLoading = false;
        this.emitUpdate();
        if (page <= 0) {
            this.pageError = `Unexpected page was requested (page ${page}). Please try again or contact support for help.`;
            this.page = exports.DEFAULT_PAGE; // fallback to the default (initial) page
            this.emitUpdate();
            return;
        }
        try {
            this.#derivedAccounts = await this.#deriveAccounts();
            if (this.keyIterator?.type === 'internal' && this.keyIterator?.subType === 'private-key') {
                const accountsOnPageWithoutTheLinked = this.accountsOnPage.filter((acc) => !acc.isLinked);
                const usedAccounts = accountsOnPageWithoutTheLinked.filter((acc) => acc.account.usedOnNetworks.length);
                // If at least one account is used - preselect all accounts on the page
                // (except the linked ones). Usually there are are two accounts
                // (since the private key flow gas `pageSize` of 1)
                if (usedAccounts.length) {
                    accountsOnPageWithoutTheLinked.forEach((acc) => this.selectAccount(acc.account));
                }
            }
        }
        catch (e) {
            const fallbackMessage = `Failed to retrieve accounts on page ${this.page}. Please try again or contact support for assistance. Error details: ${e?.message}.`;
            this.pageError = e instanceof ExternalSignerError_1.default ? e.message : fallbackMessage;
        }
        this.accountsLoading = false;
        this.emitUpdate();
        this.findAndSetLinkedAccountsPromise = this.#findAndSetLinkedAccounts({
            accounts: this.#derivedAccounts
                .filter((acc) => 
            // Since v4.60.0, linked accounts are searched for 1) EOAs
            // and 2) EOAs derived for Smart Account keys ONLY
            // (workaround so that the Relayer returns information if the Smart
            // Account with this key is used (with identity) or not).
            !(0, account_3.isSmartAccount)(acc.account) || (0, account_3.isDerivedForSmartAccountKeyOnly)(acc.index))
                .map((acc) => acc.account)
        }).finally(() => {
            this.findAndSetLinkedAccountsPromise = undefined;
        });
        await this.findAndSetLinkedAccountsPromise;
    }
    #updateStateWithTheLatestFromAccounts() {
        this.#alreadyImportedAccounts = [...this.#accounts.accounts];
        this.addedAccountsFromCurrentSession = Array.from(new Set([
            ...this.addedAccountsFromCurrentSession
                .map((a) => this.#accounts.accounts.find((acc) => acc.addr === a.addr))
                .filter(Boolean)
        ]));
        this.#derivedAccounts = this.#derivedAccounts.map((derivedAcc) => {
            const updatedAccount = this.#accounts.accounts.find((acc) => acc.addr === derivedAcc.account.addr);
            if (updatedAccount) {
                return {
                    ...derivedAcc,
                    account: { ...derivedAcc.account, ...updatedAccount }
                };
            }
            return derivedAcc;
        });
        const accountsAddr = this.#accounts.accounts.map((a) => a.addr);
        this.readyToRemoveAccounts = this.readyToRemoveAccounts.filter((a) => accountsAddr.includes(a.addr));
        this.readyToAddAccounts = this.readyToAddAccounts.filter((a) => !accountsAddr.includes(a.addr));
        this.emitUpdate();
    }
    /**
     * Triggers the process of adding accounts via the AccountPicker flow by
     * creating identity for the smart accounts (if needed) on the Relayer.
     * Then the `onAccountPickerSuccess` listener in the Main Controller gets
     * triggered, which uses the `readyToAdd...` properties to further set
     * the newly added accounts data (like preferences, keys and others)
     */
    async addAccounts(accounts) {
        this.addAccountsPromise = this.#addAccounts(accounts).finally(() => {
            this.addAccountsPromise = undefined;
        });
        await this.addAccountsPromise;
    }
    async #addAccounts(accounts) {
        if (!this.isInitialized)
            return this.#throwNotInitialized();
        if (!this.keyIterator)
            return this.#throwMissingKeyIterator();
        if (!this.#keystore.isReadyToStoreKeys) {
            this.#addAccountsOnKeystoreReady = { accounts };
            return;
        }
        this.addAccountsStatus = 'LOADING';
        await this.forceEmitUpdate();
        let newlyCreatedAccounts = [];
        const accountsToAddOnRelayer = (accounts || this.selectedAccountsFromCurrentSession)
            // Identity only for the smart accounts must be created on the Relayer
            .filter((x) => (0, account_3.isSmartAccount)(x.account))
            // Skip creating identity for Ambire v1 smart accounts
            .filter((x) => !(0, account_3.isAmbireV1LinkedAccount)(x.account.creation?.factoryAddr));
        if (accountsToAddOnRelayer.length) {
            const body = accountsToAddOnRelayer.map(({ account }) => ({
                addr: account.addr,
                ...(account.email ? { email: account.email } : {}),
                associatedKeys: account.initialPrivileges,
                creation: {
                    factoryAddr: account.creation.factoryAddr,
                    salt: account.creation.salt,
                    baseIdentityAddr: deploy_1.PROXY_AMBIRE_ACCOUNT
                }
            }));
            try {
                const res = await this.#callRelayer('/v2/identity/create-multiple', 'POST', {
                    accounts: body
                });
                if (!res.success) {
                    throw new Error(res?.message || 'No response received from the Ambire Relayer.');
                }
                if (res.body) {
                    newlyCreatedAccounts = res.body
                        .filter((acc) => acc.status.created)
                        .map((acc) => acc.identity);
                }
            }
            catch (e) {
                this.emitError({
                    level: 'major',
                    message: 'Error when adding accounts on the Ambire Relayer. Please try again later or contact support if the problem persists.',
                    error: new Error(e?.message)
                });
                this.addAccountsStatus = 'INITIAL';
                await this.forceEmitUpdate();
                return;
            }
        }
        this.readyToAddAccounts = [
            ...(accounts || this.selectedAccountsFromCurrentSession).map((x, i) => {
                const alreadyImportedAcc = this.#alreadyImportedAccounts.find((a) => a.addr === x.account.addr);
                return {
                    ...x.account,
                    // Persist the already imported account preferences on purpose, otherwise,
                    // re-importing the same account via different key type(s) would reset them.
                    preferences: alreadyImportedAcc
                        ? alreadyImportedAcc.preferences
                        : (0, account_3.getDefaultAccountPreferences)(x.account.addr, this.#alreadyImportedAccounts, i),
                    newlyCreated: newlyCreatedAccounts.includes(x.account.addr)
                };
            })
        ];
        const readyToAddKeys = {
            internal: [],
            external: []
        };
        if (this.type === 'internal') {
            readyToAddKeys.internal = this.retrieveInternalKeysOfSelectedAccounts();
        }
        else {
            // External keys flow
            const keyType = this.type;
            const deviceIds = {
                ledger: this.#externalSignerControllers.ledger?.deviceId || '',
                trezor: this.#externalSignerControllers.trezor?.deviceId || '',
                lattice: this.#externalSignerControllers?.lattice?.deviceId || ''
            };
            const deviceModels = {
                ledger: this.#externalSignerControllers.ledger?.deviceModel || '',
                trezor: this.#externalSignerControllers.trezor?.deviceModel || '',
                lattice: this.#externalSignerControllers.lattice?.deviceModel || ''
            };
            const readyToAddExternalKeys = this.selectedAccountsFromCurrentSession.flatMap(({ account, accountKeys }) => accountKeys.map(({ addr, index }, i) => ({
                addr,
                type: keyType,
                label: `${hardwareWallets_1.HARDWARE_WALLET_DEVICE_NAMES[this.type]} ${(0, keys_1.getExistingKeyLabel)(this.#keystore.keys, addr, this.type) ||
                    (0, keys_1.getDefaultKeyLabel)(this.#keystore.keys.filter((key) => account.associatedKeys.includes(key.addr)), i)}`,
                dedicatedToOneSA: (0, account_3.isDerivedForSmartAccountKeyOnly)(index),
                meta: {
                    deviceId: deviceIds[keyType],
                    deviceModel: deviceModels[keyType],
                    // always defined in the case of external keys
                    hdPathTemplate: this.hdPathTemplate,
                    index,
                    createdAt: new Date().getTime()
                }
            })));
            readyToAddKeys.external = readyToAddExternalKeys;
        }
        this.readyToAddKeys = readyToAddKeys;
        this.addedAccountsFromCurrentSession = [
            ...this.addedAccountsFromCurrentSession,
            ...this.readyToAddAccounts
        ];
        this.selectedAccountsFromCurrentSession = [];
        this.#onAddAccountsSuccessCallbackPromise = this.#onAddAccountsSuccessCallback().finally(() => {
            this.#onAddAccountsSuccessCallbackPromise = undefined;
        });
        await this.#onAddAccountsSuccessCallbackPromise;
        this.addAccountsStatus = 'SUCCESS';
        await this.forceEmitUpdate();
        this.#updateStateWithTheLatestFromAccounts();
        // reset the addAccountsStatus in the next tick to ensure the FE receives the 'SUCCESS' state
        this.addAccountsStatus = 'INITIAL';
        await this.forceEmitUpdate();
    }
    async selectNextAccount() {
        if (!this.isInitialized)
            return this.#throwNotInitialized();
        if (!this.keyIterator)
            return this.#throwMissingKeyIterator();
        this.selectNextAccountStatus = 'LOADING';
        await this.forceEmitUpdate();
        let currentPage = this.page;
        let nextAccount;
        const maxPages = 10000; // limit, acts as a safeguard to prevent infinite loops
        while (currentPage <= maxPages) {
            // TODO: Flag that excludes getting smart account key addresses
            // Load the accounts for the current page
            // eslint-disable-next-line no-await-in-loop
            await this.setPage({
                page: currentPage,
                pageSize: this.pageSize,
                shouldGetAccountsUsedOnNetworks: false,
                shouldSearchForLinkedAccounts: false
            });
            if (this.pageError) {
                throw new EmittableError_1.default({
                    message: this.pageError,
                    level: 'major',
                    error: new Error(this.pageError)
                });
            }
            nextAccount = this.accountsOnPage.find(({ isLinked, account, importStatus }) => importStatus !== account_2.ImportStatus.ImportedWithTheSameKeys &&
                !isLinked &&
                !(0, account_3.isSmartAccount)(account))?.account;
            if (nextAccount) {
                this.selectAccount(nextAccount);
                break;
            }
            // If no account found on the page, move to the next page
            currentPage++;
        }
        // TODO: Should never happen, but could benefit with better error handling
        if (!nextAccount)
            console.error('accountPicker: no next account found');
        this.selectNextAccountStatus = 'SUCCESS';
        await this.forceEmitUpdate();
        this.selectNextAccountStatus = 'INITIAL';
        await this.forceEmitUpdate();
    }
    async createAndAddEmailAccount(selectedAccount) {
        const { account: { email }, accountKeys: [recoveryKey] } = selectedAccount;
        if (!this.isInitialized)
            return this.#throwNotInitialized();
        if (!this.keyIterator)
            return this.#throwMissingKeyIterator();
        const keyPublicAddress = (await this.keyIterator.retrieve([{ from: 0, to: 1 }]))[0];
        const emailSmartAccount = await (0, account_3.getEmailAccount)({
            emailFrom: email,
            secondaryKey: recoveryKey.addr
        }, keyPublicAddress);
        await this.addAccounts([{ ...selectedAccount, account: { ...emailSmartAccount, email } }]);
    }
    // updates the account picker state so the main ctrl receives the readyToAddAccounts
    // that should be added to the storage of the app
    async addExistingEmailAccounts(accounts) {
        // There is no need to call the addAccounts method in order to add that
        // account to the relayer because this func will be called only for accounts returned
        // from relayer that only need to be stored in the storage of the app
        this.readyToAddAccounts = accounts;
        this.addAccountsStatus = 'SUCCESS';
        this.emitUpdate();
    }
    removeNetworkData(chainId) {
        this.networksWithAccountStateError = this.networksWithAccountStateError.filter((n) => n !== chainId);
        this.emitUpdate();
    }
    async #deriveAccounts() {
        // Should never happen, because before the #deriveAccounts method gets
        // called - there is a check if the keyIterator exists.
        if (!this.keyIterator) {
            console.error('accountPicker: missing keyIterator');
            return [];
        }
        const accounts = [];
        const startIdx = (this.page - 1) * this.pageSize;
        const endIdx = (this.page - 1) * this.pageSize + (this.pageSize - 1);
        const indicesToRetrieve = [
            { from: startIdx, to: endIdx } // Indices for the basic (EOA) accounts
        ];
        // Since v4.31.0, do not retrieve smart accounts for the private key
        // type. That's because we can't use the common derivation offset
        // (SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET), and deriving smart
        // accounts out of the private key (with another approach - salt and
        // extra entropy) was creating confusion.
        const shouldRetrieveSmartAccountIndices = this.keyIterator.subType !== 'private-key';
        if (shouldRetrieveSmartAccountIndices) {
            // Indices for the smart accounts.
            indicesToRetrieve.push({
                from: startIdx + derivation_1.SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET,
                to: endIdx + derivation_1.SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET
            });
        }
        // Combine the requests for all accounts in one call to the keyIterator.
        // That's optimization primarily focused on hardware wallets, to reduce the
        // number of calls to the hardware device. This is important, especially
        // for Trezor, because it fires a confirmation popup for each call.
        const combinedBasicAndSmartAccKeys = await this.keyIterator.retrieve(indicesToRetrieve, this.hdPathTemplate);
        const basicAccKeys = combinedBasicAndSmartAccKeys.slice(0, this.pageSize);
        const smartAccKeys = combinedBasicAndSmartAccKeys.slice(this.pageSize, combinedBasicAndSmartAccKeys.length);
        const smartAccountsPromises = [];
        // Replace the parallel getKeys with foreach to prevent issues with Ledger,
        // which can only handle one request at a time.
        // eslint-disable-next-line no-restricted-syntax
        for (const [index, smartAccKey] of smartAccKeys.entries()) {
            const slot = startIdx + (index + 1);
            // The derived EOA (basic) account which is the key for the smart account
            const account = (0, account_3.getBasicAccount)(smartAccKey, this.#alreadyImportedAccounts);
            const indexWithOffset = slot - 1 + derivation_1.SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET;
            accounts.push({ account, isLinked: false, slot, index: indexWithOffset });
            // Derive the Ambire (smart) account
            smartAccountsPromises.push((0, account_3.getSmartAccount)([{ addr: smartAccKey, hash: keystore_1.dedicatedToOneSAPriv }], this.#alreadyImportedAccounts)
                .then((smartAccount) => {
                return { account: smartAccount, isLinked: false, slot, index: slot - 1 };
            })
                // If the error isn't caught here and the promise is rejected, Promise.all
                // will be rejected entirely.
                .catch(() => {
                // No need for emitting an error here, because a relevant error is already
                // emitted in the method #getAccountsUsedOnNetworks
                return null;
            }));
        }
        const unfilteredSmartAccountsList = await Promise.all(smartAccountsPromises);
        const smartAccounts = unfilteredSmartAccountsList.filter((x) => x !== null);
        accounts.push(...smartAccounts);
        // eslint-disable-next-line no-restricted-syntax
        for (const [index, basicAccKey] of basicAccKeys.entries()) {
            const slot = startIdx + (index + 1);
            // The EOA (basic) account on this slot
            const account = (0, account_3.getBasicAccount)(basicAccKey, this.#alreadyImportedAccounts);
            accounts.push({ account, isLinked: false, slot, index: slot - 1 });
        }
        const accountsWithNetworks = await this.#getAccountsUsedOnNetworks({ accounts });
        return accountsWithNetworks;
    }
    // inner func
    // eslint-disable-next-line class-methods-use-this
    async #getAccountsUsedOnNetworks({ accounts }) {
        if (!this.shouldGetAccountsUsedOnNetworks) {
            return accounts.map((a) => ({ ...a, account: { ...a.account, usedOnNetworks: [] } }));
        }
        const accountsObj = Object.fromEntries(accounts.map((a) => [a.account.addr, { ...a, account: { ...a.account, usedOnNetworks: [] } }]));
        const networkLookup = {};
        this.#networks.networks.forEach((network) => {
            networkLookup[network.chainId.toString()] = network;
        });
        const promises = Object.keys(this.#providers.providers).map(async (chainId) => {
            const network = networkLookup[chainId];
            if (network) {
                const accountState = await (0, accountState_1.getAccountState)(this.#providers.providers[chainId], network, accounts.map((acc) => acc.account)).catch(() => {
                    console.error('accountPicker: failed to get account state on ', chainId);
                    if (this.networksWithAccountStateError.includes(BigInt(chainId)))
                        return;
                    this.networksWithAccountStateError.push(BigInt(chainId));
                });
                if (!accountState)
                    return;
                accountState.forEach((acc) => {
                    const isUsedOnThisNetwork = 
                    // Known limitation: checks only the native token balance. If this
                    // account has any other tokens than native ones, this check will
                    // fail to detect that the account was used on this network.
                    acc.balance > BigInt(0) ||
                        (acc.isEOA
                            ? acc.nonce > BigInt(0)
                            : // For smart accounts, check for 'isDeployed' instead because in
                                // the erc-4337 scenario many cases might be missed with checking
                                // the `acc.nonce`. For instance, `acc.nonce` could be 0, but user
                                // might be actively using the account. This is because in erc-4337,
                                // we use the entry point nonce. However, detecting the entry point
                                // nonce is also not okay, because for various cases we do not use
                                // sequential nonce - i.e., the entry point nonce could still be 0,
                                // but the account is deployed. So the 'isDeployed' check is the
                                // only reliable way to detect if account is used on network.
                                acc.isDeployed);
                    if (isUsedOnThisNetwork) {
                        accountsObj[acc.accountAddr].account.usedOnNetworks.push(network);
                    }
                });
            }
        });
        await Promise.all(promises);
        const finalAccountsWithNetworksArray = Object.values(accountsObj);
        // Preserve the original order of networks based on usedOnNetworks
        const sortedAccountsWithNetworksArray = finalAccountsWithNetworksArray.sort((a, b) => {
            const chainIdsA = a.account.usedOnNetworks.map((network) => network.chainId);
            const chainIdsB = b.account.usedOnNetworks.map((network) => network.chainId);
            const networkIndexA = this.#networks.networks.findIndex((network) => chainIdsA.includes(network.chainId));
            const networkIndexB = this.#networks.networks.findIndex((network) => chainIdsB.includes(network.chainId));
            return networkIndexA - networkIndexB;
        });
        return sortedAccountsWithNetworksArray;
    }
    async #findAndSetLinkedAccounts({ accounts }) {
        if (!this.shouldSearchForLinkedAccounts)
            return;
        if (accounts.length === 0)
            return;
        this.linkedAccountsLoading = true;
        this.emitUpdate();
        const keys = accounts.map((acc) => `keys[]=${acc.addr}`).join('&');
        const url = `/v2/account-by-key/linked/accounts?${keys}`;
        const { data } = await this.#callRelayer(url);
        const linkedAccounts = Object.keys(data.accounts).flatMap((addr) => {
            // In extremely rare cases, on the Relayer, the identity data could be
            // missing in the identities table but could exist in the logs table.
            // When this happens, the account data will be `null`.
            const isIdentityDataMissing = !data.accounts[addr];
            if (isIdentityDataMissing) {
                // Same error for both cases, because most prob
                this.emitError({
                    level: 'minor',
                    message: `The address ${addr} is not linked to an Ambire account. Please try again later or contact support if the problem persists.`,
                    error: new Error(`The address ${addr} is not linked to an Ambire account. This could be because the identity data is missing in the identities table but could exist in the logs table.`)
                });
                return [];
            }
            const { factoryAddr, bytecode, salt, associatedKeys } = data.accounts[addr];
            // Checks whether the account.addr matches the addr generated from the
            // factory. Should never happen, but could be a possible attack vector.
            const isInvalidAddress = (0, ethers_1.getCreate2Address)(factoryAddr, salt, (0, ethers_1.keccak256)(bytecode)).toLowerCase() !==
                addr.toLowerCase();
            if (isInvalidAddress) {
                const message = `The address ${addr} can't be verified to be a smart account address.`;
                this.emitError({ level: 'minor', message, error: new Error(message) });
                return [];
            }
            const existingAccount = this.#alreadyImportedAccounts.find((acc) => acc.addr === addr);
            return [
                {
                    account: {
                        addr,
                        associatedKeys: Object.keys(associatedKeys),
                        initialPrivileges: data.accounts[addr].initialPrivilegesAddrs.map((address) => [
                            address,
                            // this is a default privilege hex we add on account creation
                            '0x0000000000000000000000000000000000000000000000000000000000000001'
                        ]),
                        creation: {
                            factoryAddr,
                            bytecode,
                            salt
                        },
                        preferences: {
                            label: existingAccount?.preferences.label || account_1.DEFAULT_ACCOUNT_LABEL,
                            pfp: existingAccount?.preferences?.pfp || addr
                        }
                    },
                    isLinked: true
                }
            ];
        });
        // in case the page is changed or the ctrl is reset do not continue with the logic
        if (!this.linkedAccountsLoading)
            return;
        const linkedAccountsWithNetworks = await this.#getAccountsUsedOnNetworks({
            accounts: linkedAccounts
        });
        if (!this.linkedAccountsLoading)
            return;
        this.#linkedAccounts = linkedAccountsWithNetworks;
        this.#verifyLinkedAccounts();
        this.linkedAccountsLoading = false;
        this.emitUpdate();
    }
    /**
     * The corresponding derived account for the linked accounts should always be found,
     * except when something is wrong with the data we have stored on the Relayer.
     * Also, could be an attack vector. So indicate to the user that something is wrong.
     */
    #verifyLinkedAccounts() {
        this.#linkedAccounts.forEach((linkedAcc) => {
            const correspondingDerivedAccount = this.#derivedAccounts.find((derivedAccount) => linkedAcc.account.associatedKeys.includes(derivedAccount.account.addr));
            // The `correspondingDerivedAccount` should always be found,
            // except something is wrong with the data we have stored on the Relayer
            if (!correspondingDerivedAccount) {
                this.emitError({
                    level: 'major',
                    message: `Something went wrong with finding the corresponding account in the associated keys of the linked account with address ${linkedAcc.account.addr}. Please start the process again. If the problem persists, contact support.`,
                    error: new Error(`Something went wrong with finding the corresponding account in the associated keys of the linked account with address ${linkedAcc.account.addr}.`)
                });
            }
        });
    }
    #throwNotInitialized() {
        this.emitError({
            level: 'major',
            message: 'Something went wrong with deriving the accounts. Please start the process again. If the problem persists, contact support.',
            error: new Error('accountPicker: requested a method of the AccountPicker controller, but the controller was not initialized')
        });
    }
    #throwMissingKeyIterator() {
        this.emitError({
            level: 'major',
            message: 'Something went wrong with deriving the accounts. Please start the process again. If the problem persists, contact support.',
            error: new Error('accountPicker: missing keyIterator')
        });
    }
    #throwMissingKeyIteratorRetrieveInternalKeysMethod() {
        this.emitError({
            level: 'major',
            message: 'Retrieving internal keys failed. Please try to start the process of selecting accounts again. If the problem persist, please contact support.',
            error: new Error('accountPicker: missing retrieveInternalKeys method')
        });
    }
    #throwMissingHdPath() {
        this.emitError({
            level: 'major',
            message: 'The HD path template is missing. Please try to start the process of selecting accounts again. If the problem persist, please contact support.',
            error: new Error('accountPicker: missing hdPathTemplate')
        });
    }
    #debounceFunctionCalls(funcName, func, ms = 0) {
        if (this.#shouldDebounceFlags[funcName])
            return;
        this.#shouldDebounceFlags[funcName] = true;
        setTimeout(() => {
            this.#shouldDebounceFlags[funcName] = false;
            try {
                func();
            }
            catch (error) {
                this.emitError({
                    level: 'minor',
                    message: `The execution of ${funcName} in the AccountPickerController failed`,
                    error
                });
            }
        }, ms);
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            // includes the getter in the stringified instance
            accountsOnPage: this.accountsOnPage,
            allKeysOnPage: this.allKeysOnPage,
            selectedAccounts: this.selectedAccounts,
            addedAccountsFromCurrentSession: this.addedAccountsFromCurrentSession,
            type: this.type,
            subType: this.subType,
            isPageLocked: this.isPageLocked
        };
    }
}
exports.AccountPickerController = AccountPickerController;
exports.default = AccountPickerController;
//# sourceMappingURL=accountPicker.js.map