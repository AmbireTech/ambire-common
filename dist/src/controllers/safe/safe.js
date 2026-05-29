"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SafeController = exports.STATUS_WRAPPED_METHODS = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const api_kit_1 = tslib_1.__importDefault(require("@safe-global/api-kit"));
const intervals_1 = require("../../consts/intervals");
const safe_1 = require("../../consts/safe");
const safe_2 = require("../../libs/safe/safe");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
exports.STATUS_WRAPPED_METHODS = {
    findSafe: 'INITIAL'
};
class SafeController extends eventEmitter_1.default {
    #storage;
    #networks;
    #accounts;
    #providers;
    /**
     * The last time a request to fetch pending Safe txn was made
     */
    #updatedAt;
    #automaticallyResolvedSafeTxns = [];
    #rejectedSafeTxns = [];
    initialLoadPromise;
    statuses = exports.STATUS_WRAPPED_METHODS;
    importError;
    safeInfo;
    constructor({ eventEmitterRegistry, networks, providers, storage, accounts }) {
        super(eventEmitterRegistry);
        this.#networks = networks;
        this.#providers = providers;
        this.#storage = storage;
        this.#accounts = accounts;
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    async #load() {
        await this.#accounts.initialLoadPromise;
        this.#rejectedSafeTxns = await this.#storage.get('rejectedSafeTxns', []);
        this.#automaticallyResolvedSafeTxns = await this.#storage.get('automaticallyResolvedSafeTxns', []);
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
            .catch((e) => ({ chainId: n.chainId, code: '0x' }))));
        const deployedOn = codes.find((c) => c.code && c.code !== '0x');
        if (!deployedOn) {
            this.importError = {
                address: safeAddr,
                message: `The Safe account is not deployed on any of your enabled networks that have Safe support: ${safeNetworks.map((n) => n.name).join(',')}. Please deploy it from Safe Global on at least one network before continuing`
            };
            return;
        }
        const apiKit = new api_kit_1.default({
            chainId: deployedOn.chainId,
            apiKey: process.env.SAFE_API_KEY
        });
        const [safeInfo, safeCreationInfo] = await Promise.all([
            apiKit.getSafeInfo(safeAddr).catch((e) => e),
            apiKit.getSafeCreationInfo(safeAddr).catch((e) => e)
        ]);
        if (safeInfo instanceof Error || safeCreationInfo instanceof Error) {
            this.importError = {
                address: safeAddr,
                message: 'Failed to retrieve information about the Safe. Please try again'
            };
            return;
        }
        const setupData = safeCreationInfo.setupData;
        this.safeInfo = {
            version: safeInfo.version,
            address: safeInfo.address,
            owners: safeInfo.owners,
            deployedOn: codes.filter((c) => c.code !== '0x').map((c) => c.chainId),
            factoryAddr: safeCreationInfo.factoryAddress,
            singleton: safeCreationInfo.singleton,
            saltNonce: safeCreationInfo.saltNonce
                ? (0, ethers_1.toBeHex)(BigInt(safeCreationInfo.saltNonce), 32)
                : (0, ethers_1.toBeHex)(0, 32),
            setupData,
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
    getMessageId(msg) {
        return `${msg.messageHash}`;
    }
    #filterOutHidden(pending, safeAddr) {
        // filter out all resolved & rejected Safe txns
        const hiddenTxns = [
            ...this.#rejectedSafeTxns,
            ...this.#automaticallyResolvedSafeTxns.map((row) => row.txnIds).flat()
        ];
        return Object.assign({}, ...Object.keys(pending).map((chainId) => {
            const state = this.#accounts.accountStates[safeAddr]?.[chainId];
            return {
                [chainId]: {
                    txns: pending[chainId].txns.filter((r) => !hiddenTxns.includes(r.safeTxHash)),
                    messages: pending[chainId].messages.filter((m) => {
                        return (
                        // filter out rejected msgs by the user
                        !hiddenTxns.includes(this.getMessageId(m)) &&
                            !hiddenTxns.includes(`${this.getMessageId(m)}-${new Date(m.created).getTime()}`) &&
                            // and those that the user cannot sign
                            (state?.threshold || 0) > m.confirmations.length);
                    })
                }
            };
        }));
    }
    shouldSkipFetchPending(safeAddr) {
        return (!!this.#updatedAt &&
            this.#updatedAt.addr === safeAddr &&
            Date.now() - this.#updatedAt.time < intervals_1.FETCH_SAFE_TXNS);
    }
    async fetchPending(safeAddr, networks) {
        this.#updatedAt = {
            time: Date.now(),
            addr: safeAddr
        };
        const pending = await (0, safe_2.fetchAllPending)(networks, safeAddr);
        if (!pending)
            return null;
        return this.#filterOutHidden(pending, safeAddr);
    }
    async fetchExecuted(txns) {
        return (0, safe_2.fetchExecutedTransactions)(txns);
    }
    async rejectTxnId(safeTxnIds) {
        this.#rejectedSafeTxns = [...this.#rejectedSafeTxns, ...safeTxnIds];
        return this.#storage.set('rejectedSafeTxns', this.#rejectedSafeTxns);
    }
    async resolveTxnId(resolves) {
        for (let i = 0; i < resolves.length; i++) {
            const resolve = resolves[i];
            const resolved = this.#automaticallyResolvedSafeTxns.find((txns) => txns.nonce === resolve.nonce);
            if (!resolved)
                this.#automaticallyResolvedSafeTxns.push(resolve);
            else
                resolved.txnIds.push(...resolve.txnIds);
        }
        return this.#storage.set('automaticallyResolvedSafeTxns', this.#automaticallyResolvedSafeTxns);
    }
    /**
     * Upon failure, unresolve all Safe txns with the same nonce
     */
    async unresolve(nonce) {
        // reset the counter so we could fetch immediately
        this.#updatedAt = undefined;
        this.#automaticallyResolvedSafeTxns = this.#automaticallyResolvedSafeTxns.filter((txns) => txns.nonce !== nonce);
        return this.#storage.set('automaticallyResolvedSafeTxns', this.#automaticallyResolvedSafeTxns);
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