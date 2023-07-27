"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MainController = void 0;
const ethers_1 = require("ethers");
const emailVault_1 = require("../emailVault");
const portfolio_1 = require("../portfolio");
const keystore_1 = require("../../libs/keystore/keystore");
const networks_1 = require("../../consts/networks");
const eventEmitter_1 = __importDefault(require("../eventEmitter"));
const accountState_1 = require("../../libs/accountState/accountState");
const estimate_1 = require("../../libs/estimate/estimate");
class MainController extends eventEmitter_1.default {
    constructor(storage, fetch, relayerUrl) {
        super();
        // Private sub-structures
        this.providers = {};
        this.accountStates = {};
        this.isReady = false;
        // @TODO read networks from settings
        this.accounts = [];
        this.selectedAccount = null;
        this.keys = [];
        this.userRequests = [];
        // The reason we use a map structure and not a flat array is:
        // 1) it's easier in the UI to deal with structured data rather than having to .find/.filter/etc. all the time
        // 2) it's easier to mutate this - to add/remove accountOps, to find the right accountOp to extend, etc.
        // accountAddr => networkId => accountOp
        // @TODO consider getting rid of the `| null` ugliness, but then we need to auto-delete
        this.accountOpsToBeSigned = {};
        this.accountOpsToBeConfirmed = {};
        // accountAddr => UniversalMessage[]
        this.messagesToBeSigned = {};
        this.lastUpdate = new Date();
        this.storage = storage;
        this.portfolio = new portfolio_1.PortfolioController(storage);
        // @TODO: KeystoreSigners
        this.keystore = new keystore_1.Keystore(storage, {});
        this.initialLoadPromise = this.load();
        this.settings = { networks: networks_1.networks };
        this.emailVault = new emailVault_1.EmailVaultController(storage, fetch, relayerUrl, this.keystore);
        // Load userRequests from storage and emit that we have updated
        // @TODO
    }
    async load() {
        ;
        [this.keys, this.accounts] = await Promise.all([
            this.keystore.getKeys(),
            this.storage.get('accounts', [])
        ]);
        this.providers = Object.fromEntries(this.settings.networks.map((network) => [network.id, new ethers_1.JsonRpcProvider(network.rpcUrl)]));
        // @TODO reload those
        // @TODO error handling here
        this.accountStates = await this.getAccountsInfo(this.accounts);
        this.isReady = true;
        this.emitUpdate();
    }
    async getAccountsInfo(accounts) {
        const result = await Promise.all(this.settings.networks.map((network) => (0, accountState_1.getAccountState)(this.providers[network.id], network, accounts)));
        const states = accounts.map((acc, accIndex) => {
            return [
                acc.addr,
                Object.fromEntries(this.settings.networks.map((network, netIndex) => {
                    return [network.id, result[netIndex][accIndex]];
                }))
            ];
        });
        return Object.fromEntries(states);
    }
    async updateAccountStates() {
        this.accountStates = await this.getAccountsInfo(this.accounts);
        this.lastUpdate = new Date();
        this.emitUpdate();
    }
    selectAccount(toAccountAddr) {
        if (!this.accounts.find((acc) => acc.addr === toAccountAddr))
            throw new Error(`try to switch to not exist account: ${toAccountAddr}`);
        this.selectedAccount = toAccountAddr;
    }
    async ensureAccountInfo(accountAddr, networkId) {
        // Wait for the current load to complete
        await this.initialLoadPromise;
        // Initial sanity check: does this account even exist?
        if (!this.accounts.find((x) => x.addr === accountAddr))
            throw new Error(`ensureAccountInfo: called for non-existant acc ${accountAddr}`);
        // If this still didn't work, re-load
        // @TODO: should we re-start the whole load or only specific things?
        if (!this.accountStates[accountAddr]?.[networkId])
            await (this.initialLoadPromise = this.load());
        // If this still didn't work, throw error: this prob means that we're calling for a non-existant acc/network
        if (!this.accountStates[accountAddr]?.[networkId])
            throw new Error(`ensureAccountInfo: acc info for ${accountAddr} on ${networkId} was not retrieved`);
    }
    getAccountOp(accountAddr, networkId) {
        const account = this.accounts.find((x) => x.addr === accountAddr);
        if (!account)
            throw new Error(`getAccountOp: tried to run for non-existant account ${accountAddr}`);
        // @TODO consider bringing back functional style if we can figure out how not to trip up the TS compiler
        // Note: we use reduce instead of filter/map so that the compiler can deduce that we're checking .kind
        const calls = this.userRequests.reduce((uCalls, req) => {
            // only the first one for EOAs
            if (!account.creation && uCalls.length > 0)
                return uCalls;
            if (req.action.kind === 'call' &&
                req.networkId === networkId &&
                req.accountAddr === accountAddr) {
                const { to, value, data } = req.action;
                uCalls.push({ to, value, data, fromUserRequestId: req.id });
            }
            return uCalls;
        }, []);
        if (!calls.length)
            return null;
        const currentAccountOp = this.accountOpsToBeSigned[accountAddr][networkId];
        return {
            accountAddr,
            networkId,
            signingKeyAddr: currentAccountOp?.signingKeyAddr || null,
            gasLimit: currentAccountOp?.gasLimit || null,
            gasFeePayment: currentAccountOp?.gasFeePayment || null,
            // We use the AccountInfo to determine
            nonce: this.accountStates[accountAddr][networkId].nonce,
            // @TODO set this to a spoofSig based on accountState
            signature: null,
            // @TODO from pending recoveries
            accountOpToExecuteBefore: null,
            calls
        };
    }
    async addUserRequest(req) {
        this.userRequests.push(req);
        const { action, accountAddr, networkId } = req;
        if (!this.settings.networks.find((x) => x.id === networkId))
            throw new Error(`addUserRequest: ${networkId}: network does not exist`);
        if (action.kind === 'call') {
            // @TODO: if EOA, only one call per accountOp
            if (!this.accountOpsToBeSigned[accountAddr])
                this.accountOpsToBeSigned[accountAddr] = {};
            // @TODO
            // one solution would be to, instead of checking, have a promise that we always await here, that is responsible for fetching
            // account data; however, this won't work with EOA accountOps, which have to always pick the first userRequest for a particular acc/network,
            // and be recalculated when one gets dismissed
            // although it could work like this: 1) await the promise, 2) check if exists 3) if not, re-trigger the promise;
            // 4) manage recalc on removeUserRequest too in order to handle EOAs
            // @TODO consider re-using this whole block in removeUserRequest
            await this.ensureAccountInfo(accountAddr, networkId);
            const accountOp = this.getAccountOp(accountAddr, networkId);
            this.accountOpsToBeSigned[accountAddr][networkId] = accountOp;
            try {
                if (accountOp)
                    await this.estimateAccountOp(accountOp);
            }
            catch (e) {
                // @TODO: unified wrapper for controller errors
                console.error(e);
            }
        }
        else {
            if (!this.messagesToBeSigned[accountAddr])
                this.messagesToBeSigned[accountAddr] = [];
            if (this.messagesToBeSigned[accountAddr].find((x) => x.fromUserRequestId === req.id))
                return;
            this.messagesToBeSigned[accountAddr].push({
                content: action,
                fromUserRequestId: req.id,
                signature: null
            });
        }
        // @TODO emit update
    }
    lock() {
        this.keystore.lock();
    }
    isUnlock() {
        return this.keystore.isUnlocked();
    }
    // @TODO allow this to remove multiple OR figure out a way to debounce re-estimations
    // first one sounds more reasonble
    // although the second one can't hurt and can help (or no debounce, just a one-at-a-time queue)
    removeUserRequest(id) {
        const req = this.userRequests.find((uReq) => uReq.id === id);
        if (!req)
            throw new Error(`removeUserRequest: request with id ${id} not found`);
        // remove from the request queue
        this.userRequests.splice(this.userRequests.indexOf(req), 1);
        // update the pending stuff to be signed
        const { action, accountAddr, networkId } = req;
        if (action.kind === 'call') {
            // @TODO ensure acc info, re-estimate
            this.accountOpsToBeSigned[accountAddr][networkId] = this.getAccountOp(accountAddr, networkId);
        }
        else
            this.messagesToBeSigned[accountAddr] = this.messagesToBeSigned[accountAddr].filter((x) => x.fromUserRequestId !== id);
    }
    // @TODO: protect this from race conditions/simultanous executions
    async estimateAccountOp(accountOp) {
        await this.initialLoadPromise;
        // new accountOps should have spoof signatures so that they can be easily simulated
        // this is not used by the Estimator, because it iterates through all associatedKeys and
        // it knows which ones are authenticated, and it can generate it's own spoofSig
        // @TODO
        // accountOp.signature = `${}03`
        // TODO check if needed data in accountStates are available
        // this.accountStates[accountOp.accountAddr][accountOp.networkId].
        const account = this.accounts.find((x) => x.addr === accountOp.accountAddr);
        if (!account)
            throw new Error(`estimateAccountOp: ${accountOp.accountAddr}: account does not exist`);
        const network = this.settings.networks.find((x) => x.id === accountOp.networkId);
        if (!network)
            throw new Error(`estimateAccountOp: ${accountOp.networkId}: network does not exist`);
        const [, estimation] = await Promise.all([
            // NOTE: we are not emitting an update here because the portfolio controller will do that
            // NOTE: the portfolio controller has it's own logic of constructing/caching providers, this is intentional, as
            // it may have different needs
            this.portfolio.updateSelectedAccount(this.accounts, this.settings.networks, accountOp.accountAddr, Object.fromEntries(Object.entries(this.accountOpsToBeSigned[accountOp.accountAddr])
                .filter(([, accOp]) => accOp)
                .map(([networkId, accOp]) => [networkId, [accOp]]))),
            // @TODO nativeToCheck: pass all EOAs,
            // @TODO feeTokens: pass a hardcoded list from settings
            (0, estimate_1.estimate)(this.providers[accountOp.networkId], network, account, accountOp, [], [])
            // @TODO refresh the estimation
        ]);
        console.log(estimation);
    }
    // when an accountOp is signed; should this be private and be called by
    // the method that signs it?
    resolveAccountOp() { }
    // when a message is signed; same comment applies: should this be private?
    resolveMessage() { }
}
exports.MainController = MainController;
//# sourceMappingURL=main.js.map