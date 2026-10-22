"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SafeController = exports.STATUS_WRAPPED_METHODS = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const intervals_1 = require("../../consts/intervals");
const safe_1 = require("../../consts/safe");
const safe_2 = require("../../libs/safe/safe");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const with_timeout_1 = require("../../utils/with-timeout");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const SAFE_OWNER_SEARCH_TTL = 5 * 60 * 1000;
const SAFE_OWNER_SEARCH_DEBOUNCE = 3 * 1000;
/** The pause between two requests for pending Safe txns, to stay under the Safe API's rate limit */
const SAFE_PENDING_REQUEST_PAUSE = 600;
exports.STATUS_WRAPPED_METHODS = {
    findSafe: 'INITIAL'
};
class SafeController extends eventEmitter_1.default {
    #storage;
    #networks;
    #accounts;
    #keystore;
    #providers;
    /**
     * The last time a request to fetch pending Safe txns was made, per Safe
     */
    #pendingFetchedAt = {};
    #updateOtherSafesPendingCountsPromise;
    #rejectedSafeTxns = [];
    initialLoadPromise;
    statuses = exports.STATUS_WRAPPED_METHODS;
    importError;
    safeInfo;
    ownerCurrentlyDisplayingFor;
    safeOwnerSearches = {};
    /**
     * How many txns and messages wait for more owners' signatures, per Safe and chain id. Kept
     * for all of the user's Safes, so the ones that are not selected have a pending count
     * without a signing request being built for each of their txns.
     */
    pendingCountBySafe = {};
    constructor({ eventEmitterRegistry, networks, providers, storage, accounts, keystore }) {
        super(eventEmitterRegistry);
        this.#networks = networks;
        this.#providers = providers;
        this.#storage = storage;
        this.#accounts = accounts;
        this.#keystore = keystore;
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    async #load() {
        await this.#accounts.initialLoadPromise;
        this.#rejectedSafeTxns = await this.#storage.get('rejectedSafeTxns', []);
    }
    /**
     * Check if the passed safeAddr is deployed on any chain that:
     * - the user has enabled in the extension +
     * - Safe contracts are deployed on and are in our config, SAFE_NETWORKS
     * If deployed, get its config and check if we support it.
     * If we do, allow import of that safe
     */
    async #findSafe(safeAddr) {
        this.importError = undefined;
        this.safeInfo = undefined;
        // search enabled networks that are Safe supported
        const safeNetworks = this.#networks.networks.filter((n) => safe_1.SAFE_NETWORKS.includes(Number(n.chainId)) &&
            !!this.#providers.providers[n.chainId.toString()] // just in case
        );
        // check where the account is deployed
        const codes = await Promise.all(safeNetworks.map((n) => this.#providers.providers[n.chainId.toString()].getCode(safeAddr)
            .then((code) => ({ chainId: n.chainId, code }))
            .catch(() => ({ chainId: n.chainId, code: '0x' }))));
        const deployedOn = codes.find((c) => c.code && c.code !== '0x');
        if (!deployedOn) {
            this.importError = {
                address: safeAddr,
                message: `The Safe account isn't active on any of your enabled networks that support Safe: ${safeNetworks.map((n) => n.name).join(', ')}. Please activate it in the Safe app on at least one of them before continuing.`
            };
            return;
        }
        const apiKit = (0, safe_2.getApiKit)(deployedOn.chainId);
        const provider = this.#providers.providers[deployedOn.chainId.toString()];
        const [safeInfo, safeCreation] = await Promise.all([
            apiKit.getSafeInfo(safeAddr).catch((e) => e),
            (0, safe_2.findDeployData)(safeAddr, deployedOn.chainId, provider)
        ]);
        if (safeInfo instanceof Error) {
            this.importError = {
                address: safeAddr,
                message: 'Failed to retrieve information about the Safe. Please try again'
            };
            return;
        }
        if (safeCreation instanceof Error) {
            this.importError = {
                address: safeAddr,
                message: safeCreation.message
            };
            return;
        }
        this.safeInfo = {
            ...safeCreation,
            address: safeInfo.address,
            owners: safeInfo.owners,
            deployedOn: codes.filter((c) => c.code !== '0x').map((c) => c.chainId),
            requiresModules: safeInfo.owners.length === 1 && safeInfo.owners[0] === safe_1.safeNullOwner
        };
    }
    async findSafe(safeAddr) {
        await this.withStatus('findSafe', () => this.#findSafe(safeAddr), true);
    }
    async resetFind() {
        this.safeInfo = undefined;
        this.importError = undefined;
    }
    resetSearchByOwner() {
        this.ownerCurrentlyDisplayingFor = undefined;
        this.emitUpdate();
    }
    async findSafesByOwner(ownerAddress) {
        const owner = (0, ethers_1.getAddress)(ownerAddress);
        await this.#networks.initialLoadPromise;
        const safeNetworks = this.#networks.networks.filter((network) => safe_1.SAFE_NETWORKS.includes(Number(network.chainId)));
        this.ownerCurrentlyDisplayingFor = owner;
        const dataForCurrent = this.safeOwnerSearches[owner];
        if (dataForCurrent &&
            dataForCurrent.status === 'DONE' &&
            dataForCurrent.updatedAt > Date.now() - SAFE_OWNER_SEARCH_TTL &&
            !dataForCurrent.failedNetworks.length &&
            safeNetworks.every(({ chainId }) => dataForCurrent.searchedNetworks.includes(chainId))) {
            this.emitUpdate();
            return;
        }
        if (dataForCurrent?.status === 'LOADING' &&
            dataForCurrent.updatedAt > Date.now() - SAFE_OWNER_SEARCH_DEBOUNCE)
            return;
        const accountsByAddress = new Map();
        this.safeOwnerSearches[owner] = {
            owner,
            accounts: [],
            searchedNetworks: [],
            failedNetworks: [],
            updatedAt: Date.now(),
            status: 'LOADING'
        };
        this.emitUpdate();
        for (let i = 0; i < safeNetworks.length; i += safe_1.SAFE_API_BATCH_SIZE) {
            const networkBatch = safeNetworks.slice(i, i + safe_1.SAFE_API_BATCH_SIZE);
            const batchResults = await Promise.allSettled(networkBatch.map(async (network) => {
                const response = await (0, with_timeout_1.withTimeout)(() => (0, safe_2.getApiKit)(network.chainId).getSafesByOwner(owner), {
                    timeoutMs: safe_1.SAFE_API_TIMEOUT_MS,
                    message: `Safe API: owner search timed out after ${safe_1.SAFE_API_TIMEOUT_MS}ms`
                });
                return { chainId: network.chainId, safes: response.safes };
            }));
            const failedNetworks = [];
            const deployedOnByAddress = new Map();
            batchResults.forEach((result, index) => {
                const network = networkBatch[index];
                if (result.status === 'rejected') {
                    failedNetworks.push(network.chainId);
                    console.error(`Failed to search Safe accounts on network ${network.name}`, result.reason);
                    return;
                }
                result.value.safes.forEach((safeAddr) => {
                    const normalizedAddress = safeAddr.toLowerCase();
                    const existing = deployedOnByAddress.get(normalizedAddress);
                    if (existing) {
                        existing.chainIds.push(result.value.chainId);
                        return;
                    }
                    deployedOnByAddress.set(normalizedAddress, {
                        address: safeAddr,
                        chainIds: [result.value.chainId]
                    });
                });
            });
            const newSafeEntries = Array.from(deployedOnByAddress.entries()).filter(([address]) => !accountsByAddress.has(address));
            for (let safeIndex = 0; safeIndex < newSafeEntries.length; safeIndex += safe_1.SAFE_API_BATCH_SIZE) {
                const safeBatch = newSafeEntries.slice(safeIndex, safeIndex + safe_1.SAFE_API_BATCH_SIZE);
                const safeAccounts = await Promise.all(safeBatch.map(([, safeData]) => (0, safe_2.getSafeAccountByOwner)(safeData.address, owner, safeData.chainIds)));
                safeAccounts.forEach(({ account, failed }, index) => {
                    if (account) {
                        accountsByAddress.set(account.addr.toLowerCase(), account);
                        return;
                    }
                    if (failed)
                        failedNetworks.push(...safeBatch[index][1].chainIds);
                });
                // we use this to show results immediately to the user
                this.safeOwnerSearches[owner] = {
                    owner,
                    accounts: Array.from(accountsByAddress.values()),
                    searchedNetworks: this.safeOwnerSearches[owner]?.searchedNetworks || [],
                    failedNetworks: this.safeOwnerSearches[owner]?.failedNetworks || [],
                    updatedAt: Date.now(),
                    status: 'LOADING'
                };
                this.emitUpdate();
            }
            deployedOnByAddress.forEach(({ chainIds }, address) => {
                const account = accountsByAddress.get(address);
                if (!account)
                    return;
                account.deployedOn = Array.from(new Set([...account.deployedOn, ...chainIds]));
            });
            this.safeOwnerSearches[owner] = {
                owner,
                accounts: Array.from(accountsByAddress.values()),
                searchedNetworks: [
                    ...(this.safeOwnerSearches[owner]?.searchedNetworks || []),
                    ...networkBatch.map((network) => network.chainId)
                ],
                failedNetworks: Array.from(new Set([...(this.safeOwnerSearches[owner]?.failedNetworks || []), ...failedNetworks])),
                updatedAt: Date.now(),
                status: 'LOADING'
            };
            this.emitUpdate();
        }
        this.safeOwnerSearches[owner] = {
            ...this.safeOwnerSearches[owner],
            updatedAt: Date.now(),
            status: 'DONE'
        };
        this.emitUpdate();
    }
    getMessageId(msg) {
        return `${msg.messageHash}`;
    }
    #filterOutHidden(pending, safeAddr) {
        const hiddenMessages = [...this.#rejectedSafeTxns];
        return Object.assign({}, ...Object.keys(pending).map((chainId) => {
            const state = this.#accounts.accountStates[safeAddr]?.[chainId];
            return {
                [chainId]: {
                    txns: pending[chainId].txns,
                    messages: pending[chainId].messages.filter((m) => {
                        return (
                        // filter out rejected msgs by the user
                        !hiddenMessages.includes(this.getMessageId(m)) &&
                            !hiddenMessages.includes(`${this.getMessageId(m)}-${new Date(m.created).getTime()}`) &&
                            // and those that the user cannot sign
                            (state?.threshold || 0) > m.confirmations.length);
                    })
                }
            };
        }));
    }
    shouldSkipFetchPending(safeAddr, maxAge = intervals_1.FETCH_SAFE_TXNS) {
        const fetchedAt = this.#pendingFetchedAt[safeAddr];
        return fetchedAt !== undefined && Date.now() - fetchedAt < maxAge;
    }
    async fetchPending(safeAddr, networks) {
        this.#pendingFetchedAt[safeAddr] = Date.now();
        const pending = await (0, safe_2.fetchAllPending)(networks, safeAddr);
        if (!pending)
            return null;
        const visiblePending = this.#filterOutHidden(pending, safeAddr);
        this.#setPendingCounts(safeAddr, visiblePending);
        return visiblePending;
    }
    #setPendingCounts(safeAddr, pending) {
        const countByChainId = { ...this.pendingCountBySafe[safeAddr] };
        Object.entries(pending).forEach(([chainId, { txns, messages }]) => {
            countByChainId[chainId] = txns.length + messages.length;
        });
        // A new object per Safe, so the UI can tell which Safe's counts changed
        this.pendingCountBySafe = { ...this.pendingCountBySafe, [safeAddr]: countByChainId };
        this.emitUpdate();
    }
    /**
     * Refreshes the pending counts of the user's Safes other than the selected one, whose
     * pending txns `MainController.fetchSafeTxns` turns into requests instead. A Safe is
     * skipped while its counts are younger than `FETCH_OTHER_SAFES_PENDING`, and until at least
     * one of its owners is imported, as without one the user cannot sign what is pending. The
     * counts of a Safe whose owners were all removed are cleared.
     */
    async updateOtherSafesPendingCounts(selectedAccountAddr) {
        if (this.#updateOtherSafesPendingCountsPromise)
            return this.#updateOtherSafesPendingCountsPromise;
        this.#updateOtherSafesPendingCountsPromise = this.#updateOtherSafesPendingCounts(selectedAccountAddr).finally(() => {
            this.#updateOtherSafesPendingCountsPromise = undefined;
        });
        return this.#updateOtherSafesPendingCountsPromise;
    }
    /**
     * Drops the counts of the Safes that are not selected and no longer have an owner imported,
     * as they are not refreshed anymore. Forgetting when they were fetched lets an owner that is
     * imported again bring the count back right away.
     */
    #clearCountsOfSafesWithoutOwner(selectedAccountAddr) {
        const safesWithoutOwner = this.#accounts.accounts.filter((account) => !!account.safeCreation &&
            account.addr !== selectedAccountAddr &&
            !!this.pendingCountBySafe[account.addr] &&
            !this.#keystore.getAccountKeys(account).length);
        if (!safesWithoutOwner.length)
            return;
        const pendingCountBySafe = { ...this.pendingCountBySafe };
        safesWithoutOwner.forEach(({ addr }) => {
            delete pendingCountBySafe[addr];
            delete this.#pendingFetchedAt[addr];
        });
        this.pendingCountBySafe = pendingCountBySafe;
        this.emitUpdate();
    }
    async #updateOtherSafesPendingCounts(selectedAccountAddr) {
        this.#clearCountsOfSafesWithoutOwner(selectedAccountAddr);
        const safesToUpdate = this.#accounts.accounts.filter((account) => !!account.safeCreation &&
            account.addr !== selectedAccountAddr &&
            !!this.#keystore.getAccountKeys(account).length &&
            !this.shouldSkipFetchPending(account.addr, intervals_1.FETCH_OTHER_SAFES_PENDING));
        let isFirstRequest = true;
        // One chain of one Safe at a time, to stay under the Safe API's rate limit
        for (const safe of safesToUpdate) {
            const accountState = await this.#accounts.getOrFetchAccountStates(safe.addr);
            const deployedChains = this.#networks.networks.filter(({ chainId }) => accountState?.[chainId.toString()]?.isDeployed);
            for (const { chainId } of deployedChains) {
                if (!isFirstRequest)
                    await (0, wait_1.default)(SAFE_PENDING_REQUEST_PAUSE);
                isFirstRequest = false;
                const threshold = accountState[chainId.toString()]?.threshold || 0;
                await this.fetchPending(safe.addr, [{ chainId, threshold }]).catch((error) => {
                    this.emitError({
                        level: 'silent',
                        message: 'Failed to fetch the pending transactions of a Safe account',
                        error
                    });
                });
            }
        }
    }
    async fetchExecuted(safeAddr, chains) {
        return (0, safe_2.fetchExecutedTransactions)(safeAddr, chains);
    }
    async rejectTxnId(safeTxnIds) {
        this.#rejectedSafeTxns = [...new Set([...this.#rejectedSafeTxns, ...safeTxnIds])];
        return this.#storage.set('rejectedSafeTxns', this.#rejectedSafeTxns);
    }
    async restoreTxnId(safeTxnIds) {
        this.#rejectedSafeTxns = this.#rejectedSafeTxns.filter((id) => !safeTxnIds.includes(id));
        return this.#storage.set('rejectedSafeTxns', this.#rejectedSafeTxns);
    }
    async getMessagesByHash(data) {
        const messages = [];
        for (let i = 0; i < data.length; i++) {
            const entry = data[i];
            const msg = await (0, safe_2.getMessage)(entry).catch((e) => e);
            if (!msg || msg instanceof Error)
                continue;
            messages.push(msg);
        }
        return messages;
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON()
        };
    }
}
exports.SafeController = SafeController;
//# sourceMappingURL=safe.js.map