"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PortfolioController = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const ethers_1 = require("ethers");
const portfolio_1 = require("../libs/portfolio/portfolio");
class PortfolioController {
    constructor(storage) {
        this.minUpdateInterval = 20000; // 20 seconds
        this.latest = {};
        this.pending = {};
        this.portfolioLibs = new Map();
        this.storage = storage;
    }
    // NOTE: we always pass in all `accounts` and `networks` to ensure that the user of this
    // controller doesn't have to update this controller every time that those are updated
    // The recommended behavior of the application that this API encourages is:
    // 1) when the user selects an account, update it's portfolio on all networks (latest state only) by calling updateSelectedAccount
    // 2) every time the user has a change in their pending (to be signed or to be mined) bundle(s) on a
    // certain network, call updateSelectedAccount again with those bundles; it will update the portfolio balance
    // on each network where there are bundles, and it will update both `latest` and `pending` states on said networks
    // it will also use a high `priceRecency` to make sure we don't lose time in updating prices (since we care about running the simulations)
    // the purpose of this function is to call it when an account is selected or the queue of accountOps changes
    async updateSelectedAccount(accounts, networks, accountId, 
    // network => AccountOp
    accountOps, opts) {
        // Load storage cached hints
        const storagePreviousHints = await this.storage.get('previousHints', {});
        const selectedAccount = accounts.find((x) => x.addr === accountId);
        if (!selectedAccount)
            throw new Error('selected account does not exist');
        const prepareState = (state) => {
            if (!state[accountId])
                state[accountId] = {};
            const accountState = state[accountId];
            for (const networkId of Object.keys(accountState)) {
                if (!networks.find((x) => x.id === networkId))
                    delete accountState[networkId];
            }
        };
        prepareState(this.latest);
        prepareState(this.pending);
        const accountState = this.latest[accountId];
        const pendingState = this.pending[accountId];
        const updatePortfolioState = async (accountState, network, portfolioLib, portfolioProps, forceUpdate) => {
            if (!accountState[network.id])
                accountState[network.id] = { isReady: false, isLoading: false };
            const state = accountState[network.id];
            // When the portfolio was called lastly
            const lastUpdateStartedAt = state.result?.updateStarted;
            if (lastUpdateStartedAt &&
                Date.now() - lastUpdateStartedAt <= this.minUpdateInterval &&
                !forceUpdate)
                return false;
            // Only one loading at a time, ensure there are no race conditions
            if (state.isLoading && !forceUpdate)
                return false;
            state.isLoading = true;
            try {
                const result = await portfolioLib.get(accountId, {
                    priceRecency: 60000,
                    priceCache: state.result?.priceCache,
                    ...portfolioProps
                });
                accountState[network.id] = { isReady: true, isLoading: false, result };
                return true;
            }
            catch (e) {
                state.isLoading = false;
                if (!state.isReady)
                    state.criticalError = e;
                else
                    state.errors = [e];
                return false;
            }
        };
        await Promise.all(networks.map(async (network) => {
            const key = `${network.id}:${accountId}`;
            if (!this.portfolioLibs.has(key)) {
                const provider = new ethers_1.JsonRpcProvider(network.rpcUrl);
                this.portfolioLibs.set(key, new portfolio_1.Portfolio(node_fetch_1.default, provider, network));
            }
            const portfolioLib = this.portfolioLibs.get(key);
            const currentAccountOps = accountOps?.[network.id];
            const simulatedAccountOps = pendingState[network.id]?.accountOps;
            const forceUpdate = opts?.forceUpdate ||
                stringifyWithBigInt(currentAccountOps) !== stringifyWithBigInt(simulatedAccountOps);
            const [isSuccessfulLatestUpdate, isSuccessfulPendingUpdate] = await Promise.all([
                // Latest state update
                updatePortfolioState(accountState, network, portfolioLib, {
                    blockTag: 'latest',
                    previousHints: storagePreviousHints[key]
                }, forceUpdate),
                // Pending state update
                // We are updating the pending state, only if AccountOps are changed or the application logic requests a force update
                forceUpdate
                    ? await updatePortfolioState(pendingState, network, portfolioLib, {
                        blockTag: 'pending',
                        previousHints: storagePreviousHints[key],
                        ...(currentAccountOps && {
                            simulation: {
                                account: selectedAccount,
                                accountOps: currentAccountOps
                            }
                        })
                    }, forceUpdate)
                    : Promise.resolve(false)
            ]);
            // Persist previousHints in the disk storage for further requests, when:
            // latest state was updated successful and hints were fetched successful too (no hintsError from portfolio result)
            if (isSuccessfulLatestUpdate && !accountState[network.id].result.hintsError) {
                storagePreviousHints[key] = getHintsWithBalance(accountState[network.id].result);
                await this.storage.set('previousHints', storagePreviousHints);
            }
            // We cache the previously simulated AccountOps
            // in order to compare them with the newly passed AccountOps before executing a new updatePortfolioState.
            // This allows us to identify any differences between the two.
            if (isSuccessfulPendingUpdate && currentAccountOps) {
                pendingState[network.id].accountOps = currentAccountOps;
            }
        }));
        // console.log({ latest: this.latest, pending: this.pending })
    }
}
exports.PortfolioController = PortfolioController;
// By default, JSON.stringify doesn't stringifies BigInt.
// Because of this, we are adding support for BigInt values with this utility function.
// @TODO: move this into utils
function stringifyWithBigInt(value) {
    return JSON.stringify(value, (key, value) => typeof value === 'bigint' ? value.toString() : value);
}
// We already know that `results.tokens` and `result.collections` tokens have a balance (this is handled by the portfolio lib).
// Based on that, we can easily find out which hint tokens also have a balance.
function getHintsWithBalance(result) {
    const erc20s = result.tokens.map((token) => token.address);
    const erc721s = Object.fromEntries(result.collections.map((collection) => [
        collection.address,
        result.hints.erc721s[collection.address]
    ]));
    return {
        erc20s,
        erc721s
    };
}
//# sourceMappingURL=portfolio.js.map