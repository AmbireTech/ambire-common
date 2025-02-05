"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountsController = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const account_1 = require("../../libs/account/account");
const accountState_1 = require("../../libs/accountState/accountState");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const STATUS_WRAPPED_METHODS = {
    selectAccount: 'INITIAL',
    updateAccountPreferences: 'INITIAL'
};
class AccountsController extends eventEmitter_1.default {
    #storage;
    #networks;
    #providers;
    accounts = [];
    accountStates = {};
    accountStatesLoadingState = {};
    statuses = STATUS_WRAPPED_METHODS;
    #onAddAccounts;
    #updateProviderIsWorking;
    #onAccountStateUpdate;
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    constructor(storage, providers, networks, onAddAccounts, updateProviderIsWorking, onAccountStateUpdate) {
        super();
        this.#storage = storage;
        this.#providers = providers;
        this.#networks = networks;
        this.#onAddAccounts = onAddAccounts;
        this.#updateProviderIsWorking = updateProviderIsWorking;
        this.#onAccountStateUpdate = onAccountStateUpdate;
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.initialLoadPromise = this.#load();
    }
    async #load() {
        await this.#networks.initialLoadPromise;
        await this.#providers.initialLoadPromise;
        const [accounts, accountPreferences] = await Promise.all([
            this.#storage.get('accounts', []),
            this.#storage.get('accountPreferences', undefined)
        ]);
        if (accountPreferences) {
            this.accounts = (0, account_1.getUniqueAccountsArray)((0, account_1.migrateAccountPreferencesToAccounts)(accountPreferences, accounts));
            await this.#storage.set('accounts', this.accounts);
            await this.#storage.remove('accountPreferences');
        }
        else {
            this.accounts = (0, account_1.getUniqueAccountsArray)(accounts);
        }
        // Emit an update before updating account states as the first state update may take some time
        this.emitUpdate();
        // Don't await this. Networks should update one by one
        // NOTE: YOU MUST USE waitForAccountsCtrlFirstLoad IN TESTS
        // TO ENSURE ACCOUNT STATE IS LOADED
        this.#updateAccountStates(this.accounts);
    }
    async updateAccountStates(blockTag = 'latest', networks = []) {
        await this.#updateAccountStates(this.accounts, blockTag, networks);
    }
    async updateAccountState(accountAddr, blockTag = 'latest', networks = []) {
        const accountData = this.accounts.find((account) => account.addr === accountAddr);
        if (!accountData)
            return;
        await this.#updateAccountStates([accountData], blockTag, networks);
    }
    async #updateAccountStates(accounts, blockTag = 'latest', updateOnlyNetworksWithIds = []) {
        // if any, update the account state only for the passed networks; else - all
        const updateOnlyPassedNetworks = updateOnlyNetworksWithIds.length;
        const networksToUpdate = this.#networks.networks.filter((network) => {
            if (this.accountStatesLoadingState[network.id])
                return false;
            if (!updateOnlyPassedNetworks)
                return true;
            return updateOnlyNetworksWithIds.includes(network.id);
        });
        networksToUpdate.forEach((network) => {
            this.accountStatesLoadingState[network.id] = true;
        });
        this.emitUpdate();
        await Promise.all(networksToUpdate.map(async (network) => {
            try {
                const networkAccountStates = await (0, accountState_1.getAccountState)(this.#providers.providers[network.id], network, accounts, blockTag);
                this.#updateProviderIsWorking(network.id, true);
                networkAccountStates.forEach((accountState) => {
                    const addr = accountState.accountAddr;
                    if (!this.accountStates[addr]) {
                        this.accountStates[addr] = {};
                    }
                    this.accountStates[addr][network.id] = accountState;
                });
            }
            catch (err) {
                console.error(`account state update error for ${network.name}: `, err);
                this.#updateProviderIsWorking(network.id, false);
            }
            finally {
                this.accountStatesLoadingState[network.id] = false;
            }
            this.emitUpdate();
        }));
        this.#onAccountStateUpdate();
    }
    async addAccounts(accounts = []) {
        if (!accounts.length)
            return;
        // eslint-disable-next-line no-param-reassign
        accounts = accounts.map((a) => ({ ...a, addr: (0, ethers_1.getAddress)(a.addr) }));
        const alreadyAddedAddressSet = new Set(this.accounts.map((account) => account.addr));
        const newAccountsNotAddedYet = accounts.filter((acc) => !alreadyAddedAddressSet.has(acc.addr));
        const newAccountsAlreadyAdded = accounts.filter((acc) => alreadyAddedAddressSet.has(acc.addr));
        const nextAccounts = [
            ...this.accounts.map((acc) => ({
                ...acc,
                // reset the `newlyCreated` state for all already added accounts
                newlyCreated: false,
                // reset the `newlyAdded` state for all accounts added on prev sessions
                newlyAdded: false,
                // Merge the existing and new associated keys for the account (if the
                // account was already imported). This ensures up-to-date keys,
                // considering changes post-import (associated keys of the smart
                // accounts can change) or incomplete initial data (during the initial
                // import, not all associated keys could have been fetched (for privacy).
                associatedKeys: Array.from(new Set([
                    ...acc.associatedKeys,
                    ...(newAccountsAlreadyAdded.find((x) => x.addr === acc.addr)?.associatedKeys || [])
                ]))
            })),
            ...newAccountsNotAddedYet.map((a) => ({ ...a, newlyAdded: true }))
        ];
        this.accounts = (0, account_1.getUniqueAccountsArray)(nextAccounts);
        await this.#storage.set('accounts', this.accounts);
        this.#onAddAccounts(accounts);
        // update the state of new accounts. Otherwise, the user needs to restart his extension
        this.#updateAccountStates(newAccountsNotAddedYet);
        this.emitUpdate();
    }
    async removeAccountData(address) {
        this.accounts = this.accounts.filter((acc) => acc.addr !== address);
        delete this.accountStates[address];
        this.#storage.set('accounts', this.accounts);
        this.emitUpdate();
    }
    async updateAccountPreferences(accounts) {
        await this.withStatus('updateAccountPreferences', async () => this.#updateAccountPreferences(accounts), true);
    }
    async #updateAccountPreferences(accounts) {
        this.accounts = this.accounts.map((acc) => {
            const account = accounts.find((a) => a.addr === acc.addr);
            if (!account)
                return acc;
            if ((0, ethers_1.isAddress)(account.preferences.pfp)) {
                account.preferences.pfp = (0, ethers_1.getAddress)(account.preferences.pfp);
            }
            return { ...acc, preferences: account.preferences, newlyAdded: false };
        });
        await this.#storage.set('accounts', this.accounts);
        this.emitUpdate();
    }
    get areAccountStatesLoading() {
        return Object.values(this.accountStatesLoadingState).some((isLoading) => isLoading);
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            areAccountStatesLoading: this.areAccountStatesLoading
        };
    }
}
exports.AccountsController = AccountsController;
//# sourceMappingURL=accounts.js.map