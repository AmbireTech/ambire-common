"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PortfolioController = exports.EXCHANGE_LIST_URL = void 0;
const tslib_1 = require("tslib");
const viem_1 = require("viem");
const scheduler_1 = require("../../utils/scheduler");
const recurringTimeout_1 = require("../../classes/recurringTimeout/recurringTimeout");
const StaleRpcBlockError_1 = require("../../classes/StaleRpcBlockError");
const addresses_1 = require("../../consts/addresses");
const intervals_1 = require("../../consts/intervals");
const networks_1 = require("../../consts/networks");
const portfolio_1 = require("../../consts/portfolio");
const account_1 = require("../../libs/account/account");
const getBaseAccount_1 = require("../../libs/account/getBaseAccount");
const types_1 = require("../../libs/accountOp/types");
const defiPositions_1 = require("../../libs/defiPositions/defiPositions");
const keys_1 = require("../../libs/keys/keys");
const portfolio_2 = require("../../libs/portfolio");
const getNetworksWithAssets_1 = tslib_1.__importDefault(require("../../libs/portfolio/getNetworksWithAssets"));
const helpers_1 = require("../../libs/portfolio/helpers");
const portfolio_3 = require("../../libs/portfolio/portfolio");
const tokenProcessing_1 = require("../../libs/portfolio/tokenProcessing");
const relayerCall_1 = require("../../libs/relayerCall/relayerCall");
const selectedAccount_1 = require("../../libs/selectedAccount/selectedAccount");
const shareValue_1 = require("../../libs/walletStaking/shareValue");
const batcher_1 = tslib_1.__importDefault(require("../../utils/batcher"));
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const hintsController_1 = require("../hintsController/hintsController");
const EXTERNAL_API_HINTS_TTL = {
    dynamic: 15 * 60 * 1000,
    static: 60 * 60 * 1000
};
const TOKEN_PRICE_CACHE_TTL = 5 * 60 * 1000;
exports.EXCHANGE_LIST_URL = 'https://cena.ambire.com/api/v3/exchanges';
const EXCHANGE_LIST_MAX_RETRIES = 5;
const EXCHANGE_LIST_RETRY_DELAY = 10 * 60 * 1000;
/**
 * Strips the exchange list down to the fields the UI shows, so the rest of the
 * API response isn't kept in memory.
 */
const pickExchangeInfoFields = (exchanges) => Object.fromEntries(Object.entries(exchanges).map(([exchangeId, { id, name, url, image }]) => [
    exchangeId,
    { id, name, url, image }
]));
/**
 * The portfolio controller is responsible for managing and updating the portfolio state.
 * The portfolio state is divided by account and network. Every network's state
 * contains the tokens, NFTs and DeFi positions for the account on that network.
 *
 * Short glossary:
 * - Deployless - a library used by the portfolio library to fetch token and NFT information. It's
 * also used to fetch custom defi positions, account state etc. (in other places)
 * - Portfolio library - fetches tokens and NFTs using deployless and also makes a call for
 * prices.
 * - Hints - list of token and NFT addresses that are likely to be owned by the user.
 *
 * How it works:
 * - A call is made to Velcro to fetch hints and defi positions.
 * - Using the hints, the portfolio library is called to fetch tokens and NFTs.
 * - Parallel with the portfolio library call, deployless is used to fetch custom defi positions.
 * - Once all data is fetched, it's combined and the state is updated.
 * - As the custom defi positions may contain tokens that weren't in the hints and weren't fetched
 * by the portfolio library we add them in a hackish way to the state. On subsequent updates
 * the portfolio library receives them as hints and they are learned properly.
 *
 * Other concepts:
 * - Temporary tokens - tokens that are fetched on demand so they can be displayed in the UI.
 * As the name suggests, they are temporary and used for things like displaying a token's information
 * before being added as custom.
 * - To be learned tokens - tokens added from sources like swapAndBridge, activity, the humanizer. Some of them
 * may be owned by the user in the near future (e.g. the user swapped a token and will receive it soon).
 * - App defi positions - defi positions that are not linked to a specific network and have a slightly different structure (no addresses for assets). They are
 * fetched separately, but batched together with all other calls to the external API. (e.g, Polymarket and Hyperliquid positions)
 *
 * Hints sources:
 * - Velcro, existing defi positions, learned assets, toBeLearnedAssets, custom tokens
 * - On manual updates, learned tokens of other accounts are also used to discover new assets
 */
class PortfolioController extends eventEmitter_1.default {
    #state;
    // A queue to prevent race conditions when calling `updateSelectedAccount`.
    // All calls are queued by network and account.
    // Each time `updateSelectedAccount` is invoked to update the state, the call is added to the queue.
    // If a previous call is still running, the new call will be queued and executed only after the first one completes,
    // regardless of whether it succeeds or fails.
    // Before implementing this queue, multiple `updateSelectedAccount` calls made in a short period of time could cause
    // the response of the update call to be overwritten by a slower previous call.
    #queue;
    validTokens = { erc20: {}, erc721: {} };
    // Not part of the state, as the UI has no use for it. Keyed by standard too,
    // as the same address can be checked as a token and as a collection at once.
    #assetValidationsInProgress = new Set();
    temporaryTokens = {};
    hasFundedHotAccount = false;
    /**
     * The account's invite key for the Ambire Mobile app, returned by the relayer's
     * `portfolio-additional` endpoint. Present only for accounts the relayer has generated
     * one for; used to let the user activate the same account in the mobile app.
     */
    #mobileInviteKeys = {};
    #portfolioLibs;
    #banner;
    #storage;
    #fetch;
    #callRelayer;
    #velcroUrl;
    batchedPortfolioDiscovery;
    #networksWithAssetsByAccounts = {};
    #networksWithPositionsByAccounts = {};
    tokenDataCache = {};
    #providers;
    #verification;
    #networks;
    #accounts;
    #keystore;
    #featureFlags;
    #ui;
    /**
     * Handles token learning, temporary tokens, hints and their storage.
     */
    hints;
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    #defiSessionIds = [];
    #defiPositionsCountOnDisabledNetworks = {};
    #exchangeState = {
        exchanges: null,
        isLoading: false,
        retryCount: 0
    };
    #exchangeListRetryTimeout;
    /**
     * When the exchange list was last loaded, or null before that. Lets the UI look up
     * exchanges again once the list arrives, without the list itself being public.
     */
    exchangeListUpdatedAt = null;
    #blacklist = {
        blacklistAddrs: {},
        blacklistBySymbols: [],
        updatedAt: null,
        isLoading: false
    };
    #blacklistInterval;
    /** See {@link ScheduledUpdates} */
    #scheduledUpdates = {};
    /**
     * Runs every SCHEDULED_PORTFOLIO_UPDATES_RUNNER_INTERVAL and checks if there are any scheduled updates to run.
     * If there are, it runs them and removes them from the schedule.
     */
    #scheduledUpdatesRunnerInterval;
    constructor(storage, fetch, providers, networks, accounts, keystore, relayerUrl, velcroUrl, banner, featureFlags, ui, eventEmitterRegistry, verification, platform = 'default') {
        super(eventEmitterRegistry);
        this.#state = {};
        this.#queue = {};
        this.#portfolioLibs = new Map();
        this.#storage = storage;
        this.#fetch = fetch;
        this.#callRelayer = relayerCall_1.relayerCall.bind({ url: relayerUrl, fetch });
        this.#velcroUrl = velcroUrl;
        this.#providers = providers;
        this.#verification = verification;
        this.#networks = networks;
        this.#accounts = accounts;
        this.#keystore = keystore;
        this.#banner = banner;
        this.#featureFlags = featureFlags;
        this.#ui = ui;
        this.hints = new hintsController_1.HintsController(storage, accounts, keystore);
        // Re-emit hints updates as portfolio updates so the re-exposed getters
        // (customTokens, tokenPreferences) reach the UI when they change.
        this.hints.onUpdate((forceEmit) => this.propagateUpdate(forceEmit));
        this.#blacklistInterval = new recurringTimeout_1.RecurringTimeout(this.fetchBlacklist.bind(this), intervals_1.BLACKLIST_UPDATE_INTERVAL, this.emitError.bind(this));
        this.#scheduledUpdatesRunnerInterval = new recurringTimeout_1.RecurringTimeout(this.#runScheduledUpdates.bind(this), intervals_1.SCHEDULED_PORTFOLIO_UPDATES_RUNNER_INTERVAL, this.emitError.bind(this));
        this.#scheduledUpdatesRunnerInterval.start();
        this.#blacklistInterval.start();
        this.batchedPortfolioDiscovery = (0, batcher_1.default)(fetch, (queue) => {
            const baseCurrencies = [...new Set(queue.map((x) => x.data.baseCurrency))];
            const accountAddrs = [...new Set(queue.map((x) => x.data.accountAddr))];
            const pairs = baseCurrencies
                .map((baseCurrency) => accountAddrs.map((accountAddr) => ({
                baseCurrency,
                accountAddr,
                // When several requests for the same account+currency are batched, the most
                // aggressive update mode wins (see `mergeDefiUpdateModes`).
                defiUpdateMode: (0, defiPositions_1.mergeDefiUpdateModes)(queue
                    .filter((x) => x.data.baseCurrency === baseCurrency && x.data.accountAddr === accountAddr)
                    .map((x) => x.data.defiUpdateMode))
            })))
                .flat();
            return pairs.map(({ baseCurrency, accountAddr, defiUpdateMode }) => {
                const queueSegment = queue.filter((x) => x.data.baseCurrency === baseCurrency && x.data.accountAddr === accountAddr);
                // As of v4.36.0, for metric purposes, pass the account keys count as an
                // additional param for the batched velcro discovery requests. The account's
                // last known total balance on all networks is passed for the same reason.
                const accountKeysCount = (0, keys_1.getAccountKeysCount)({
                    accountAddr,
                    keys: this.#keystore.keys,
                    accounts: this.#accounts.accounts
                });
                const totalBalance = Math.round((0, helpers_1.getAccountPortfolioTotal)(this.#state[accountAddr]));
                // Analytics should not be polluted with inactive extensions
                const activeParam = this.#keystore.isUnlocked ? '&a=1' : '';
                // This is a hack to achieve something that would require a good amount of refactoring in the portfolio
                // To understand the problem you need to know the following information:
                // Discovery is done with the batcher, every network is updated in parallel and customAppChain is updated
                // in parallel with regular networks. customAppChain should be updated ONLY when AT LEAST ONE another network is updated.
                // There is absolutely no reason to update customAppChain with default or force mode by itself. To fix this properly
                // we have to move the logic that determines updateMode for each network BEFORE the Promise.all([]) that updates all networks
                // in parallel and also make the call to velcro there, instead of using the batcher. This way we will know which networks have to
                // be updated and can decide if customAppChain should be updated or not. For now, we will just update with 'cache' mode if the only
                // network to be updated is customAppChain.
                const isUpdatingOnlyDefiApps = queueSegment.length === 1 && queueSegment[0]?.data.chainId === 'customAppChain';
                // Tells velcro-v3 how fresh the defi positions must be
                const defiParam = `&defi=${isUpdatingOnlyDefiApps ? defiPositions_1.DefiUpdateMode.Cache : defiUpdateMode}`;
                const url = `${this.#velcroUrl}/portfolio?networks=${queueSegment
                    .map((x) => x.data.chainId)
                    .join(',')}&account=${accountAddr}&baseCurrency=${baseCurrency}${defiParam}&sigs=${accountKeysCount}&b=${totalBalance}${activeParam}`;
                return { url, queueSegment };
            });
        }, {
            timeoutSettings: {
                timeoutAfter: (0, portfolio_1.getDiscoveryTimeout)(platform),
                timeoutErrorMessage: 'Velcro discovery timed out'
            },
            dedupeByKeys: ['chainId', 'accountAddr']
        });
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    async updateExchangeList() {
        if (!this.#featureFlags.isFeatureEnabled('tokenPrices') ||
            this.#exchangeState.isLoading ||
            this.#exchangeState.retryCount >= EXCHANGE_LIST_MAX_RETRIES)
            return;
        this.#exchangeState.isLoading = true;
        clearTimeout(this.#exchangeListRetryTimeout);
        try {
            const response = await this.#fetch(exports.EXCHANGE_LIST_URL);
            if (!response.ok) {
                throw new Error(`Failed to fetch exchange list: ${response.statusText}`);
            }
            const fetchedExchanges = (await response.json()).data;
            this.#exchangeState = {
                exchanges: pickExchangeInfoFields(fetchedExchanges),
                isLoading: false,
                retryCount: 0
            };
            this.exchangeListUpdatedAt = Date.now();
            this.emitUpdate();
        }
        catch (e) {
            this.#exchangeState.isLoading = false;
            this.#exchangeState.retryCount += 1;
            this.emitError({
                level: 'silent',
                error: e,
                message: `Error while fetching exchange list: ${e.message}`
            });
            this.#exchangeListRetryTimeout = setTimeout(async () => {
                await this.updateExchangeList();
            }, EXCHANGE_LIST_RETRY_DELAY);
        }
    }
    /**
     * Looks up the display info of the given exchanges. Unknown ids are left out, and the
     * result is empty until the exchange list has loaded.
     */
    getExchangesInfo(exchangeIds) {
        const { exchanges } = this.#exchangeState;
        if (!exchanges)
            return {};
        return exchangeIds.reduce((exchangesInfo, exchangeId) => {
            const exchange = exchanges[exchangeId];
            if (exchange)
                exchangesInfo[exchangeId] = exchange;
            return exchangesInfo;
        }, {});
    }
    /** Replies to a UI request with {@link getExchangesInfo} for the given exchanges. */
    getExchangesInfoAndSendResToUi(exchangeIds, requestId) {
        this.#ui.message.sendUiMessage({
            requestId,
            ok: true,
            res: this.getExchangesInfo(exchangeIds)
        });
    }
    /** The account's invite key for the Ambire Mobile app, or undefined if it has none. */
    getMobileInviteKey(accountAddr) {
        return this.#mobileInviteKeys[accountAddr];
    }
    /**
     * The account's DeFi position counts on networks the user has disabled. Empty until a
     * full update across all networks has completed.
     */
    getDefiPositionsCountOnDisabledNetworks(accountAddr) {
        return this.#defiPositionsCountOnDisabledNetworks[accountAddr] || {};
    }
    async fetchBlacklist() {
        if (!this.#featureFlags.isFeatureEnabled('scamAndPhishingChecker'))
            return;
        try {
            if (this.#blacklist.isLoading)
                return;
            this.#blacklist.isLoading = true;
            const response = await this.#fetch('https://cena.ambire.com/api/v3/tokens/black-list');
            if (!response.ok) {
                throw new Error(`Failed to fetch token blacklist: ${response.statusText}`);
            }
            const data = await response.json();
            if (!data.success) {
                throw new Error('Token blacklist response returned success: false');
            }
            const rawAddrs = data.blacklistAddrs || {};
            const checksummedAddrs = {};
            for (const chainId of Object.keys(rawAddrs)) {
                checksummedAddrs[chainId] = (rawAddrs[chainId] || []).reduce((acc, addr) => {
                    try {
                        acc.push((0, viem_1.getAddress)(addr));
                    }
                    catch {
                        // skip malformed addresses
                    }
                    return acc;
                }, []);
            }
            this.#blacklist = {
                blacklistAddrs: checksummedAddrs,
                blacklistBySymbols: data.blacklistBySymbols || [],
                updatedAt: Date.now(),
                isLoading: false
            };
            // Reset the retry interval to the default value after a successful fetch
            this.#blacklistInterval.updateTimeout({
                timeout: intervals_1.BLACKLIST_UPDATE_INTERVAL
            });
            await this.#storage.set('tokenBlacklist', {
                blacklistAddrs: this.#blacklist.blacklistAddrs,
                blacklistBySymbols: this.#blacklist.blacklistBySymbols,
                updatedAt: this.#blacklist.updatedAt
            });
            this.emitUpdate();
        }
        catch (e) {
            // Update the retry interval based on whether we have a previously updated blacklist or not.
            if (!this.#blacklist.updatedAt) {
                this.#blacklistInterval.updateTimeout({
                    timeout: 5 * 60 * 1000
                });
            }
            else {
                this.#blacklistInterval.updateTimeout({
                    timeout: 30 * 60 * 1000
                });
            }
            this.#blacklist.isLoading = false;
            this.emitError({
                level: 'silent',
                message: `Failed to fetch token blacklist: ${e.message}`,
                error: e
            });
        }
    }
    get blacklist() {
        return this.#blacklist;
    }
    async #load() {
        try {
            await this.#networks.initialLoadPromise;
            await this.#accounts.initialLoadPromise;
            await this.#featureFlags.initialLoadPromise;
            await this.hints.initialLoadPromise;
            this.#networksWithPositionsByAccounts = await this.#storage.get('networksWithPositionsByAccounts', {});
            const networksWithAssets = await this.#storage.get('networksWithAssetsByAccount', {});
            const isOldStructure = Object.keys(networksWithAssets).every((key) => Array.isArray(networksWithAssets[key]) &&
                networksWithAssets[key].every((item) => typeof item === 'string'));
            if (!isOldStructure) {
                this.#networksWithAssetsByAccounts = networksWithAssets;
            }
            const storedBlacklist = await this.#storage.get('tokenBlacklist', null);
            if (storedBlacklist) {
                this.#blacklist = {
                    ...storedBlacklist,
                    isLoading: false
                };
                if (storedBlacklist.updatedAt &&
                    Date.now() - storedBlacklist.updatedAt > intervals_1.BLACKLIST_UPDATE_INTERVAL) {
                    // eslint-disable-next-line @typescript-eslint/no-floating-promises
                    this.fetchBlacklist();
                }
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                this.fetchBlacklist();
            }
        }
        catch (e) {
            this.emitError({
                message: 'Something went wrong when loading portfolio. Please try again or contact support if the problem persists.',
                level: 'major',
                error: e
            });
        }
        this.emitUpdate();
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.updateExchangeList();
    }
    #getHasFundedHotAccount() {
        const hotAccounts = this.#accounts.accounts.filter((acc) => this.#keystore.getAccountKeys(acc).find((key) => key.type === 'internal'));
        return hotAccounts.some((acc) => {
            const networksWithAssets = this.getNetworksWithAssets(acc.addr);
            return Object.values(networksWithAssets).some(Boolean);
        });
    }
    async #updatePortfolioOnTokenChange(chainId, selectedAccountAddr) {
        // As this function currently only updates the portfolio we can skip it altogether
        // if skipPortfolioUpdate is set to true
        if (!selectedAccountAddr)
            return;
        const networkData = this.#networks.networks.find((n) => n.chainId === chainId);
        await this.updateSelectedAccount(selectedAccountAddr, networkData ? [networkData] : undefined);
    }
    async addCustomToken(customToken, selectedAccountAddr, shouldUpdatePortfolio) {
        const didChange = await this.hints.addCustomToken(customToken);
        if (didChange && shouldUpdatePortfolio) {
            await this.#updatePortfolioOnTokenChange(customToken.chainId, selectedAccountAddr);
        }
    }
    async removeCustomToken(customToken, selectedAccountAddr, shouldUpdatePortfolio) {
        const didChange = await this.hints.removeCustomToken(customToken, selectedAccountAddr);
        if (didChange && shouldUpdatePortfolio) {
            await this.#updatePortfolioOnTokenChange(customToken.chainId, selectedAccountAddr);
        }
    }
    async toggleHideToken(tokenPreference, selectedAccountAddr, shouldUpdatePortfolio) {
        const didChange = await this.hints.toggleHideToken(tokenPreference);
        if (didChange && shouldUpdatePortfolio) {
            await this.#updatePortfolioOnTokenChange(tokenPreference.chainId, selectedAccountAddr);
        }
    }
    get customTokens() {
        return this.hints.customTokens;
    }
    get tokenPreferences() {
        return this.hints.tokenPreferences;
    }
    addTokensToBeLearned(tokenAddresses, chainId) {
        return this.hints.addTokensToBeLearned(tokenAddresses, chainId);
    }
    addErc721sToBeLearned(nftsData, accountAddr, chainId) {
        return this.hints.addErc721sToBeLearned(nftsData, accountAddr, chainId);
    }
    async #updateNetworksWithAssets(accountId, accountState) {
        const storageStateByAccount = this.#networksWithAssetsByAccounts;
        this.#networksWithAssetsByAccounts[accountId] = (0, getNetworksWithAssets_1.default)(accountId, accountState, storageStateByAccount, this.#providers.providers);
        await this.updateNetworksWithDefiPositions(accountId, accountState, this.#providers.providers);
        this.hasFundedHotAccount = this.#getHasFundedHotAccount();
        this.emitUpdate();
        await this.#storage.set('networksWithAssetsByAccount', this.#networksWithAssetsByAccounts);
    }
    #setNetworkLoading(accountId, network, isLoading, error) {
        const accountState = this.#state[accountId];
        if (!accountState)
            return;
        if (!accountState[network])
            accountState[network] = { errors: [], isReady: false, isLoading };
        accountState[network].isLoading = isLoading;
        if (error)
            accountState[network].criticalError = {
                message: error?.message || 'Error while executing the get function in the portfolio library.',
                simulationErrorMsg: error?.simulationErrorMsg,
                stack: error?.stack,
                name: error?.name
            };
    }
    removeNetworkData(chainId) {
        for (const accountId of Object.keys(this.#state)) {
            if (this.#state[accountId]) {
                delete this.#state[accountId][chainId.toString()];
            }
        }
        this.emitUpdate();
    }
    /**
     * Removes simulation results from the portfolio state. This function is used when
     * all simulated account ops should be discarded for a network-account pair. It does
     * not update the portfolio but simply removes the simulation results from the state.
     *
     * If you instead need to remove a specific accountOp from the simulation results, use `discardSimulation`
     * (e.g., after an account op is broadcasted and confirmed)
     *
     * If possible, this method shouldn't be awaited as we run the
     * risks of slowing the extension down unintentionally
     */
    async overrideSimulationResults(accountOp) {
        const { accountAddr, chainId } = accountOp;
        this.debugLog('simulation', `${chainId.toString()}: Overriding simulation results for ${accountAddr}`, () => ({
            accountOpId: accountOp.id
        }));
        const updatePromise = async () => {
            if (!this.#state[accountAddr] || !this.#state[accountAddr][chainId.toString()])
                return;
            const networkState = this.#state[accountAddr][chainId.toString()];
            // The simulation error is no longer relevant once its simulated balances are removed.
            // Keeping it would leave the portfolio balance in a warning state.
            const clearedSimulationError = !!networkState.criticalError?.simulationErrorMsg;
            if (clearedSimulationError) {
                delete networkState.criticalError;
            }
            if (!networkState.result) {
                if (clearedSimulationError)
                    this.emitUpdate();
                return;
            }
            networkState.result.tokens = networkState.result.tokens.map((token) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { amountPostSimulation, simulationAmount, ...rest } = token;
                return rest;
            });
            networkState.result.collections = (networkState.result.collections || []).map((collection) => {
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { amountPostSimulation, postSimulation, simulationAmount, ...rest } = collection;
                return rest;
            });
            networkState.result.total = (0, helpers_1.getTotal)(networkState.result.tokens, networkState.result.defiPositions);
            delete networkState.accountOps;
            this.emitUpdate();
        };
        // overrideSimulationResults is a synchronous function that updates the state by removing the simulation results.
        // However, there may be a portfolio update in progress that will override the state with the simulation results again. To prevent
        // this, we use a queue to ensure that if there is an update in progress, the override of the simulation results will be executed after the update is finished.
        // And that subsequent updates will wait for the override to be finished before updating the state again.
        if (!this.#queue?.[accountAddr]?.[chainId.toString()])
            this.#queue[accountAddr] = {
                ...this.#queue[accountAddr],
                [chainId.toString()]: Promise.resolve()
            };
        // Chain the new updatePromise to the current queue
        this.#queue[accountAddr][chainId.toString()] = this.#queue?.[accountAddr]?.[chainId.toString()].then(updatePromise).catch((error) => {
            console.error(error);
            return updatePromise();
        });
        // Ensure the method waits for the entire queue to resolve
        await this.#queue[accountAddr][chainId.toString()];
    }
    /**
     * Drops the given entries from the schedule, matching them by reference so that a newer entry,
     * scheduled for the same chain while these were running, is kept.
     */
    #forgetScheduledUpdates(accountId, updatesToForget) {
        const remaining = (this.#scheduledUpdates[accountId] || []).filter((update) => !updatesToForget.includes(update));
        if (remaining.length) {
            this.#scheduledUpdates[accountId] = remaining;
        }
        else {
            delete this.#scheduledUpdates[accountId];
        }
    }
    async #runScheduledUpdates() {
        if (Object.keys(this.#scheduledUpdates).length === 0)
            return;
        // The entries are references to the scheduled ones, so flagging them as running below
        // mutates the schedule itself
        const dueUpdatesByAccount = {};
        Object.entries(this.#scheduledUpdates).forEach(([accountId, updates]) => {
            const dueUpdates = updates.filter((update) => !update.isRunning && Date.now() - update.scheduledAt >= intervals_1.SCHEDULED_PORTFOLIO_UPDATE_DELAY);
            if (dueUpdates.length)
                dueUpdatesByAccount[accountId] = dueUpdates;
        });
        const accountIdsToUpdate = Object.keys(dueUpdatesByAccount);
        if (!accountIdsToUpdate.length)
            return;
        // Flag them as running so a subsequent run doesn't pick them up while the requests are in
        // flight. They are kept in the schedule (instead of removed upfront) so the UI can tell the
        // user the update is still happening.
        accountIdsToUpdate.forEach((accountId) => {
            dueUpdatesByAccount[accountId].forEach((update) => {
                update.isRunning = true;
            });
        });
        this.emitUpdate();
        await Promise.all(accountIdsToUpdate.map(async (accountId) => {
            const dueUpdates = dueUpdatesByAccount[accountId];
            const chainIdsToUpdate = dueUpdates.map((update) => update.chainId);
            try {
                await this.updateSelectedAccount(accountId, this.#networks.networks.filter((n) => chainIdsToUpdate.includes(n.chainId)), undefined, {
                    bypassServerSideCache: dueUpdates.some((update) => update.bypassServerSideCache)
                });
            }
            finally {
                this.#forgetScheduledUpdates(accountId, dueUpdates);
                this.emitUpdate();
            }
        }));
    }
    /**
     * Used to schedule portfolio updates for a specific account and network. Atm it's only used to
     * update the portfolio after an interval from the last transaction, so we are sure that potential changes
     * to defi positions have been indexed by our discovery API
     */
    scheduleUpdate({ accountId, chainId, bypassServerSideCache }) {
        const existing = this.#scheduledUpdates[accountId] || [];
        // A running update is already fetching stale data, so it can't be debounced. The new
        // transaction gets its own entry, which also keeps the UI indicator up until it runs.
        const pendingUpdateForNetwork = existing.find((update) => update.chainId === chainId && !update.isRunning);
        if (pendingUpdateForNetwork) {
            pendingUpdateForNetwork.bypassServerSideCache =
                pendingUpdateForNetwork.bypassServerSideCache || bypassServerSideCache;
            // Debounce: start the delay window from the most recent transaction, not the first
            pendingUpdateForNetwork.scheduledAt = Date.now();
            this.debugLog('simulation', `${chainId.toString()} Debounced scheduled update for ${accountId}`, () => ({
                bypassServerSideCache: pendingUpdateForNetwork.bypassServerSideCache,
                scheduledAt: pendingUpdateForNetwork.scheduledAt
            }));
            this.emitUpdate();
            return;
        }
        this.debugLog('simulation', `${chainId.toString()} Scheduled update for ${accountId}`, () => ({
            bypassServerSideCache,
            scheduledAt: Date.now()
        }));
        this.#scheduledUpdates[accountId] = [
            ...existing,
            { chainId, bypassServerSideCache, scheduledAt: Date.now(), isRunning: false }
        ];
        this.emitUpdate();
    }
    /**
     * The chains with a portfolio update queued or in flight after a recent transaction, by account.
     * Read by the UI to tell the user their defi positions are about to refresh.
     */
    get scheduledUpdateChainIds() {
        return Object.fromEntries(Object.entries(this.#scheduledUpdates).map(([accountId, updates]) => [
            accountId,
            updates.map(({ chainId }) => chainId)
        ]));
    }
    /**
     * Removes a specific simulated account op from the portfolio state and updates
     * the portfolio for the corresponding account and networks.
     *
     * The function protects against race conditions by removing specific accountOps
     *
     * Example usage: after an account op is broadcasted and confirmed
     */
    async discardSimulation(accountOps) {
        const updatesByAccount = {};
        accountOps.forEach((accountOp) => {
            const { accountAddr, chainId } = accountOp;
            const chainIdString = chainId.toString();
            if (!this.#state[accountAddr]?.[chainIdString])
                return;
            const networkData = this.#networks.networks.find((n) => n.chainId === chainId);
            if (!networkData) {
                this.emitError({
                    level: 'silent',
                    message: `Network with chainId ${chainId} not found while discarding simulation results.`,
                    error: new Error(`portfolio.discardSimulation: Network with chainId ${chainId} not found`)
                });
                return;
            }
            if (!updatesByAccount[accountAddr]) {
                updatesByAccount[accountAddr] = {
                    networksByChainId: {},
                    accountOpIdsByChainId: {}
                };
            }
            updatesByAccount[accountAddr].networksByChainId[chainIdString] = networkData;
            updatesByAccount[accountAddr].accountOpIdsByChainId[chainIdString] = [
                ...(updatesByAccount[accountAddr].accountOpIdsByChainId[chainIdString] || []),
                accountOp.id
            ];
        });
        await Promise.all(Object.entries(updatesByAccount).map(async ([accountAddr, { networksByChainId, accountOpIdsByChainId }]) => {
            const networksToUpdate = Object.values(networksByChainId);
            this.debugLog('simulation', `Discarding simulation for ${accountAddr}`, () => ({
                discardedOpIds: Object.values(accountOpIdsByChainId).flat(),
                chainIds: Object.keys(networksByChainId)
            }));
            await this.updateSelectedAccount(accountAddr, networksToUpdate, undefined, {
                accountOpIdsToDiscard: accountOpIdsByChainId
            });
        }));
    }
    async updateTokenValidationByStandard(token, accountId, allNetworks = false) {
        await this.initialLoadPromise;
        const key = (0, helpers_1.getAssetCacheKey)(token.address, token.chainId);
        if (this.validTokens.erc20[key]?.isValid === true)
            return;
        // Repeated dispatches for the same token are one check, not several
        const inProgressKey = `erc20-${key}`;
        if (this.#assetValidationsInProgress.has(inProgressKey))
            return;
        const provider = this.#providers.providers[token.chainId.toString()];
        if (!provider) {
            const message = `Error while updating token validation for ${token.address} (${token.chainId}).`;
            this.emitError({ level: 'silent', message, error: new Error(message) });
            return;
        }
        this.#assetValidationsInProgress.add(inProgressKey);
        try {
            const result = await (0, helpers_1.validateERC20Token)(token, accountId, provider, allNetworks
                ? {
                    allNetworks: this.#networks.networks,
                    allProviders: this.#providers.providers,
                    enableNetworkDetection: true
                }
                : undefined);
            const { isValid, error } = result;
            this.#storeAssetValidation('erc20', key, { isValid, error });
        }
        finally {
            this.#assetValidationsInProgress.delete(inProgressKey);
        }
        this.emitUpdate();
    }
    /**
     * Validates that the address is an ERC-721 collection before it's added as a
     * custom one and stores the result in `validTokens.erc721`.
     *
     * `shouldRefetch` runs the check again for an address that already has a
     * verdict, which the UI asks for after a network problem.
     */
    async updateCollectionValidation(collection, shouldRefetch) {
        await this.initialLoadPromise;
        const key = (0, helpers_1.getAssetCacheKey)(collection.address, collection.chainId);
        // A verdict about the contract itself doesn't change for an address
        if (this.validTokens.erc721[key] && !shouldRefetch)
            return;
        const inProgressKey = `erc721-${key}`;
        if (this.#assetValidationsInProgress.has(inProgressKey))
            return;
        const provider = this.#providers.providers[collection.chainId.toString()];
        if (!provider) {
            const message = `Error while validating collection ${collection.address} (${collection.chainId}).`;
            this.emitError({ level: 'silent', message, error: new Error(message) });
            return;
        }
        this.#assetValidationsInProgress.add(inProgressKey);
        try {
            const { isValid, error, collection: collectionMeta } = await (0, helpers_1.validateERC721Token)(collection, provider);
            this.#storeAssetValidation('erc721', key, { isValid, error, collection: collectionMeta });
        }
        finally {
            this.#assetValidationsInProgress.delete(inProgressKey);
        }
        this.emitUpdate();
    }
    /**
     * Checks whether the account owns the collectible and stores the result in
     * `validTokens.erc721`, keyed by the collection and the id.
     *
     * `shouldRefetch` checks again for a collectible that already has a verdict,
     * which the UI asks for after a network problem.
     */
    async updateCollectibleValidation(collectible, accountId, shouldRefetch) {
        await this.initialLoadPromise;
        const key = (0, helpers_1.getCollectibleCacheKey)(collectible.address, collectible.chainId, collectible.tokenId);
        // The owner can change, but only a new check would notice, so the verdict is
        // kept until the user asks again
        if (this.validTokens.erc721[key] && !shouldRefetch)
            return;
        const inProgressKey = `erc721-${key}`;
        if (this.#assetValidationsInProgress.has(inProgressKey))
            return;
        const provider = this.#providers.providers[collectible.chainId.toString()];
        if (!provider) {
            const message = `Error while validating collectible ${collectible.tokenId} of ${collectible.address}.`;
            this.emitError({ level: 'silent', message, error: new Error(message) });
            return;
        }
        this.#assetValidationsInProgress.add(inProgressKey);
        try {
            const { isValid, error } = await (0, helpers_1.validateCollectibleOwnership)(collectible, accountId, provider);
            this.#storeAssetValidation('erc721', key, { isValid, error });
        }
        finally {
            this.#assetValidationsInProgress.delete(inProgressKey);
        }
        this.emitUpdate();
    }
    #storeAssetValidation(standard, key, validation) {
        this.validTokens[standard] = { ...this.validTokens[standard], [key]: validation };
    }
    initializePortfolioLibIfNeeded(accountId, chainId, network) {
        const providers = this.#providers.providers;
        const key = `${chainId}:${accountId}`;
        const libForKey = this.#portfolioLibs.get(key);
        // Initialize a new Portfolio lib if:
        // 1. It does not exist in the portfolioLibs map
        // 2. The network RPC URL has changed or the provider is destroyed !
        if (!libForKey ||
            !libForKey.provider ||
            libForKey.provider.destroyed ||
            libForKey.provider?._getConnection().url !==
                providers[network.chainId.toString()]?._getConnection().url) {
            try {
                const provider = providers[network.chainId.toString()];
                if (!provider)
                    return null;
                this.#portfolioLibs.set(key, new portfolio_2.Portfolio(this.#fetch, provider, network, this.#velcroUrl, undefined, () => this.#featureFlags.isFeatureEnabled('tokenPrices')));
            }
            catch (e) {
                this.emitError({
                    level: 'silent',
                    message: `Error while initializing portfolio lib for ${network.name} (${network.chainId}).`,
                    error: e
                });
                return null;
            }
        }
        return this.#portfolioLibs.get(key);
    }
    async getTokenBalancesOnBlock(accountId, chainId, tokenAddrs, blockTag, accountAddr = accountId) {
        const network = this.#networks.networks.find((x) => x.chainId === chainId);
        if (!network)
            throw new Error(`Network with chainId ${chainId} not found`);
        const portfolioLib = this.initializePortfolioLibIfNeeded(accountId, chainId, network);
        if (!portfolioLib)
            return [];
        return portfolioLib.getTokensByAddresses(accountAddr, tokenAddrs, { blockTag });
    }
    async getTemporaryTokens(accountId, chainId, additionalHint) {
        const network = this.#networks.networks.find((x) => x.chainId === chainId);
        if (!network)
            throw new Error(`Network with chainId ${chainId} not found`);
        const portfolioLib = this.initializePortfolioLibIfNeeded(accountId, chainId, network);
        const temporaryTokensToFetch = (this.temporaryTokens[network.chainId.toString()] &&
            this.temporaryTokens[network.chainId.toString()]?.result?.tokens.filter((x) => x.address !== additionalHint)) ||
            [];
        this.temporaryTokens[network.chainId.toString()] = {
            isLoading: false,
            errors: [],
            result: {
                tokens: (this.temporaryTokens[network.chainId.toString()] &&
                    this.temporaryTokens[network.chainId.toString()]?.result?.tokens) ||
                    []
            }
        };
        this.emitUpdate();
        try {
            if (!portfolioLib) {
                throw new Error(`a portfolio library is not initialized for ${network.name} (${network.chainId})`);
            }
            const result = await portfolioLib.get(accountId, {
                tokenDataRecency: 60000 * 5,
                additionalErc20Hints: [additionalHint, ...temporaryTokensToFetch.map((x) => x.address)],
                disableAutoDiscovery: true
            });
            this.temporaryTokens[network.chainId.toString()] = {
                isLoading: false,
                errors: [],
                result: {
                    tokens: result.tokens
                }
            };
            this.emitUpdate();
            return true;
        }
        catch (e) {
            this.emitError({
                level: 'silent',
                message: `Error while executing the 'get' function in the portfolio library on ${network.name} (${network.chainId}) for account ${accountId}.`,
                error: e
            });
            const tempTokens = this.temporaryTokens[network.chainId.toString()];
            if (tempTokens) {
                tempTokens.isLoading = false;
                tempTokens.errors.push(e);
            }
            this.emitUpdate();
            return false;
        }
    }
    async getTokenPrice(accountId, chainId, address) {
        const network = this.#networks.networks.find((x) => x.chainId === chainId);
        if (!network)
            throw new Error(`Network with chainId ${chainId} not found`);
        const portfolioLib = this.initializePortfolioLibIfNeeded(accountId, chainId, network);
        if (!portfolioLib)
            return undefined;
        const networkTokenDataCache = this.tokenDataCache[chainId.toString()] || new Map();
        const price = await portfolioLib.getTokenPrice(address, {
            tokenDataCache: networkTokenDataCache,
            tokenDataRecency: TOKEN_PRICE_CACHE_TTL
        });
        this.tokenDataCache[chainId.toString()] = networkTokenDataCache;
        return price;
    }
    async #getAdditionalPortfolio(accountId, maxDataAgeMs) {
        const rewardsOrGasTankState = this.#state[accountId]?.rewards || this.#state[accountId]?.gasTank;
        const canSkipUpdate = rewardsOrGasTankState
            ? PortfolioController.#getCanSkipUpdate(rewardsOrGasTankState, maxDataAgeMs)
            : false;
        if (canSkipUpdate)
            return;
        const start = Date.now();
        const accountState = this.#state[accountId] ?? (this.#state[accountId] = {});
        this.#setNetworkLoading(accountId, 'gasTank', true);
        this.#setNetworkLoading(accountId, 'rewards', true);
        this.emitUpdate();
        let res = {
            data: {
                rewards: {},
                gasTank: { balance: [] }
            }
        };
        if (this.#featureFlags.isFeatureEnabled('gasTank')) {
            const accountKeysCount = (0, keys_1.getAccountKeysCount)({
                accountAddr: accountId,
                keys: this.#keystore.keys,
                accounts: this.#accounts.accounts
            });
            const sigsParam = accountKeysCount > 0 ? `?sigs=${accountKeysCount}` : '';
            try {
                res = await this.#callRelayer(`/v2/identity/${accountId}/portfolio-additional${sigsParam}`, 'GET', undefined, undefined, 5000);
            }
            catch (e) {
                console.error('relayer error for portfolio additional');
                this.#setNetworkLoading(accountId, 'gasTank', false, e);
                this.#setNetworkLoading(accountId, 'rewards', false, e);
                this.emitUpdate();
                return;
            }
        }
        if (res.data.banner) {
            const banner = res.data.banner;
            let actions = 
            // banner is placed in priority so:
            // when we add banners with surveys, we can also add a url
            // the goal is for old extensions to be redirected to a url, for new versions to have a survey
            // otherwise we will have to chose 1) new - survey, old - nothing or 2) both old and new - url
            banner.surveyId
                ? [
                    {
                        actionName: 'survey',
                        meta: { surveyId: banner.surveyId }
                    }
                ]
                : banner.url
                    ? [
                        {
                            actionName: 'open-link',
                            meta: { url: banner.url }
                        }
                    ]
                    : [];
            const endTimeNumber = typeof banner.endTime === 'number' ? banner.endTime : new Date(banner.endTime).getTime();
            const startTimeNumber = typeof banner.startTime === 'number'
                ? banner.startTime
                : new Date(banner.startTime).getTime();
            const formattedBanner = {
                id: banner.id || banner._id,
                type: banner.type || 'updates',
                meta: {
                    startTime: startTimeNumber,
                    endTime: endTimeNumber,
                    requirements: banner.require
                },
                ...(banner.text && { text: banner.text }),
                ...(banner.title && { title: banner.title }),
                actions,
                emoji: banner.emoji
            };
            this.#banner.addBanner(formattedBanner);
        }
        if (!res)
            throw new Error('portfolio controller: no res, should never happen');
        const rewardsTokens = [
            res.data.rewards.stkWalletClaimableBalance || [],
            res.data.rewards.walletClaimableBalance || []
        ]
            .flat()
            .map((t) => ({
            ...t,
            chainId: BigInt(t.chainId || 1),
            amount: BigInt(t.amount || 0),
            symbol: t.address === addresses_1.STK_WALLET ? 'stkWALLET' : t.symbol,
            flags: (0, tokenProcessing_1.getFlags)(res.data.rewards, 'rewards', t.chainId, t.address, t.name, t.symbol)
        }));
        accountState.rewards = {
            isReady: true,
            isLoading: false,
            errors: [],
            lastSuccessfulUpdate: Date.now(),
            result: {
                ...res.data.rewards,
                updateStarted: start,
                tokens: rewardsTokens,
                total: (0, helpers_1.getTotal)(rewardsTokens, null)
            }
        };
        const gasTankTokens = res.data.gasTank.balance.map((t) => ({
            ...t,
            amount: BigInt(t.amount || 0),
            chainId: BigInt(t.chainId || 1),
            availableAmount: BigInt(t.availableAmount || 0),
            flags: (0, tokenProcessing_1.getFlags)(res.data, 'gasTank', t.chainId, t.address, t.name, t.symbol),
            marketDataIn: []
        }));
        accountState.gasTank = {
            isReady: true,
            isLoading: false,
            errors: [],
            lastSuccessfulUpdate: Date.now(),
            result: {
                updateStarted: start,
                tokens: [],
                gasTankTokens,
                total: (0, helpers_1.getTotal)(gasTankTokens, null)
            }
        };
        if (res.data.mobileInviteKey) {
            this.#mobileInviteKeys[accountId] = res.data.mobileInviteKey;
        }
        else {
            delete this.#mobileInviteKeys[accountId];
        }
        this.emitUpdate();
    }
    /**
     * How many blocks behind the stored result a freshly fetched one is.
     */
    static #getBlocksBehind(networkState, newBlockNumber, rpcUrl) {
        const storedBlockNumber = networkState?.result?.blockNumber;
        if (!storedBlockNumber || networkState?.rpcInfo?.url !== rpcUrl)
            return 0;
        return Math.max(storedBlockNumber - newBlockNumber, 0);
    }
    /**
     * Records how far behind the RPC is after an update was rejected for being older than
     * the one already displayed, and reports our own RPC falling behind once per episode.
     */
    #onStaleRpcBlock(accountId, network, error) {
        const state = this.#state[accountId]?.[network.chainId.toString()];
        if (!state)
            return;
        const rpcUrl = network.selectedRpcUrl;
        const isFirstRejection = !state.rpcInfo?.since;
        state.rpcInfo = {
            url: rpcUrl,
            behindBy: error.blocksBehind,
            since: state.rpcInfo?.since ?? Date.now()
        };
        this.debugLog('update', `${network.chainId.toString()} update rejected for ${accountId}`, () => ({
            rpcUrl,
            receivedBlockNumber: error.receivedBlockNumber,
            blocksBehind: error.blocksBehind
        }));
        const message = '[PORTFOLIO_STALE_RPC_BLOCK] The RPC returned the state of an older block';
        const reportedError = new Error(message);
        reportedError.debugInfo = {
            accountId,
            chainId: network.chainId.toString(),
            rpcUrl,
            receivedBlockNumber: error.receivedBlockNumber,
            storedBlockNumber: error.receivedBlockNumber + error.blocksBehind,
            blocksBehind: error.blocksBehind
        };
        this.emitError({
            level: 'silent',
            sendCrashReport: isFirstRejection && rpcUrl.includes(networks_1.INVICTUS_RPC_URL_IDENTIFIER),
            message,
            error: reportedError
        });
    }
    static #getCanSkipUpdate(networkState, maxDataAgeMs) {
        const hasImportantErrors = networkState?.errors.some((e) => e.level === 'critical');
        if (!maxDataAgeMs || !networkState || networkState.criticalError || hasImportantErrors)
            return false;
        const updateStarted = networkState.result && 'updateStarted' in networkState.result
            ? networkState.result?.updateStarted || 0
            : 0;
        const isWithinMinUpdateInterval = !!updateStarted && Date.now() - updateStarted < maxDataAgeMs;
        return isWithinMinUpdateInterval || networkState.isLoading;
    }
    /**
     * Fetches portfolio asset hints and defi positions from the external API (Velcro)
     * and formats the response. If both hints and defi positions can be skipped, returns null data.
     * If the defi position update can be skipped, but hints have to be refetched it makes a request
     * to Velcro but passes a flag to signal to the server that it can returned cached defi data.
     */
    async getPortfolioFromApiDiscovery(opts) {
        const discoveryStart = Date.now();
        if (!this.#featureFlags.isFeatureEnabled('tokenAndDefiAutoDiscovery'))
            return null;
        const errors = [];
        const { chainId, account, baseCurrency, defiMaxDataAgeMs, hasKeys, externalApiHintsResponse, isManualUpdate, bypassServerSideCache } = opts;
        const defiState = this.#state[account.addr]?.[chainId.toString()]?.result?.defiPositions;
        const canSkipExternalApiHintsUpdate = !!externalApiHintsResponse &&
            !isManualUpdate &&
            Date.now() - externalApiHintsResponse.lastUpdate <
                EXTERNAL_API_HINTS_TTL[!externalApiHintsResponse.hasHints ? 'static' : 'dynamic'];
        const hasNonceChangedSinceLastUpdate = (0, defiPositions_1.getHasNonceChangedSinceLastUpdate)(defiState, this.#getNonceId(account, chainId));
        // Used by getShouldBypassServerSideCache to avoid spending the server-side bypass budget
        // before the scheduled update fires (the server has a per-account cooldown)
        const hasScheduledUpdate = !!this.#scheduledUpdates[account.addr]?.find((update) => update.chainId === chainId && update.bypassServerSideCache);
        const defiUpdateMode = (0, defiPositions_1.getDefiUpdateMode)({
            previousState: defiState,
            bypassServerSideCache: !!bypassServerSideCache,
            isManualUpdate: !!isManualUpdate,
            hasKeys,
            sessionIds: this.#defiSessionIds,
            hasNonceChangedSinceLastUpdate,
            hasScheduledUpdate,
            maxDataAgeMs: defiMaxDataAgeMs
        });
        const canSkipDefiUpdate = defiUpdateMode === defiPositions_1.DefiUpdateMode.Cache;
        // Request can be skipped altogether
        if (canSkipExternalApiHintsUpdate && canSkipDefiUpdate) {
            this.debugLog('discovery', `${chainId.toString()}: Skipping portfolio discovery for ${account.addr}`, () => ({
                lastUpdate: externalApiHintsResponse?.lastUpdate,
                hasHints: externalApiHintsResponse?.hasHints,
                isManualUpdate,
                bypassServerSideCache,
                hasNonceChangedSinceLastUpdate
            }));
            return null;
        }
        let response = null;
        try {
            response = await this.batchedPortfolioDiscovery({
                chainId,
                accountAddr: account.addr,
                baseCurrency,
                defiUpdateMode
            });
            // Throw the error after assigning the response so we can still use the returned hints
            if (response && 'errorState' in response.defi)
                throw new Error(`Defi discovery failed. Error: ${'errorState' in response.defi
                    ? response.defi.errorState[0]?.message || 'Unknown error (2)'
                    : 'Unknown error'}`);
        }
        catch (error) {
            this.emitError({
                level: 'silent',
                message: `Error while fetching portfolio discovery data from Velcro for account ${account.addr} on chainId ${chainId}.`,
                error
            });
            // Add errors only if the respective updates could not be skipped. As if the user
            // is not expecting a defi update and it fails, it should not be reported.
            if (!canSkipDefiUpdate) {
                const defiError = {
                    name: portfolio_3.PORTFOLIO_LIB_ERROR_NAMES.DefiDiscoveryError,
                    message: error.message,
                    level: 'critical'
                };
                errors.push(defiError);
            }
            // An error is added only if there is no response
            if (!canSkipExternalApiHintsUpdate && !response) {
                const hintsError = (0, helpers_1.getHintsError)(error.message, externalApiHintsResponse);
                errors.push(hintsError);
            }
        }
        const discoveryTime = Date.now() - discoveryStart;
        if (!response)
            return {
                data: null,
                discoveryTime,
                errors
            };
        // Update the price cache so the lib can use the latest prices from velcro
        if (response.prices) {
            const networkTokenDataCache = this.tokenDataCache[chainId.toString()] || new Map();
            for (const [key, priceData] of Object.entries(response.prices)) {
                if (!priceData || !('price' in priceData) || !('baseCurrency' in priceData))
                    continue;
                networkTokenDataCache.set((0, helpers_1.getTokenDataCacheKey)(key), [
                    Date.now(),
                    (0, helpers_1.convertApiTokenDataToTokenDataCache)(priceData)
                ]);
            }
            this.tokenDataCache[chainId.toString()] = networkTokenDataCache;
        }
        response.lastUpdate = Date.now();
        return {
            data: {
                defi: response.defi && !('errorState' in response.defi)
                    ? {
                        updatedAt: response.defi.updatedAt,
                        positions: (0, defiPositions_1.getFormattedApiPositions)(response.defi.positions),
                        isForceUpdate: defiUpdateMode === defiPositions_1.DefiUpdateMode.Force
                    }
                    : null,
                otherNetworksDefiCounts: response.otherNetworksDefiCounts,
                hints: response ? (0, helpers_1.formatExternalHintsAPIResponse)(response) : null
            },
            discoveryTime,
            errors
        };
    }
    // By our convention, we always stick with private (#) instead of protected methods.
    // However, we made a compromise here to allow Jest tests to mock updatePortfolioState.
    async updatePortfolioState(account, network, portfolioLib, portfolioProps) {
        const { maxDataAgeMs, isManualUpdate, defiMaxDataAgeMs, bypassServerSideCache } = portfolioProps;
        const accountState = this.#state[account.addr];
        // Can occur if the account is removed while updateSelectedAccount is in progress
        if (!accountState)
            return [false, null];
        if (!accountState[network.chainId.toString()]) {
            // isLoading must be false here, otherwise canSkipUpdate will return true
            // and portfolio will not be updated
            accountState[network.chainId.toString()] = { isLoading: false, isReady: false, errors: [] };
        }
        const canSkipUpdate = PortfolioController.#getCanSkipUpdate(accountState[network.chainId.toString()], maxDataAgeMs);
        if (canSkipUpdate) {
            this.debugLog('update', `${network.chainId.toString()} update skipped for ${account.addr}`, () => ({
                lastSuccessfulUpdate: accountState[network.chainId.toString()]?.lastSuccessfulUpdate,
                maxDataAgeMs,
                isManualUpdate,
                isLoading: accountState[network.chainId.toString()]?.isLoading
            }));
            return [true, null];
        }
        this.#setNetworkLoading(account.addr, network.chainId.toString(), true);
        const state = accountState[network.chainId.toString()];
        if (isManualUpdate)
            state.criticalError = undefined;
        this.emitUpdate();
        const hasNonZeroTokens = !!Object.values(this.#networksWithAssetsByAccounts?.[account.addr] || {}).some(Boolean);
        try {
            if (!portfolioLib)
                throw new Error(`a portfolio library is not initialized for ${network.name} (${network.chainId})`);
            const networkTokenDataCache = this.tokenDataCache[network.chainId.toString()] || new Map();
            const hintsResponse = this.#state[account.addr]?.[network.chainId.toString()]?.result?.lastExternalApiUpdateData;
            const discoveryData = await this.getPortfolioFromApiDiscovery({
                chainId: network.chainId,
                account,
                baseCurrency: 'usd',
                externalApiHintsResponse: hintsResponse || null,
                isManualUpdate,
                bypassServerSideCache,
                defiMaxDataAgeMs,
                hasKeys: portfolioProps.hasKeys
            });
            await (0, scheduler_1.yieldToMain)();
            const allHints = this.hints.getAllHints(account.addr, network.chainId, this.#state[account.addr]?.[network.chainId.toString()]?.result?.defiPositions, isManualUpdate, discoveryData?.data?.hints);
            const shouldVerifyPortfolio = !!network.isColibriEnabled && !portfolioProps.simulation;
            // Colibri verification runs off the critical path (see below). Show a
            // loading badge immediately so the UI reflects that a verification is pending.
            const verification = shouldVerifyPortfolio
                ? { provider: 'colibri', status: 'loading', updatedAt: Date.now() }
                : undefined;
            if (shouldVerifyPortfolio) {
                state.verification = verification;
                this.emitUpdate();
            }
            else {
                delete state.verification;
            }
            // Fetch the portfolio and custom defi positions in parallel
            const [portfolioResult, customPositionsResult] = await Promise.all([
                portfolioLib.get(account.addr, {
                    tokenDataRecency: 60000 * 5,
                    tokenDataCache: networkTokenDataCache,
                    knownTokenMetadata: this.hints.getKnownTokenMetadata(network.chainId),
                    knownCollectionMetadata: this.hints.getKnownCollectionMetadata(network.chainId),
                    fetchPinned: !hasNonZeroTokens,
                    ...allHints,
                    ...portfolioProps,
                    blockTag: 'both',
                    disableAutoDiscovery: true,
                    blacklist: this.#blacklist
                }),
                (0, defiPositions_1.getCustomProviderPositions)(account.addr, portfolioLib.provider, network, this.#fetch, state.result?.defiPositions.positionsByProvider || [], discoveryData?.data?.defi?.positions, (0, defiPositions_1.getIsExternalApiDefiPositionsCallSuccessful)(discoveryData), this.#featureFlags.isFeatureEnabled('tokenPrices'))
            ]);
            const stkWalletToken = portfolioResult.tokens.find((t) => t.chainId === 1n &&
                t.address === '0xE575cC6EC0B5d176127ac61aD2D3d9d19d1aa4a0' &&
                !t.flags.rewardsType) ?? null;
            await (0, scheduler_1.yieldToMain)();
            const newDefiState = (0, defiPositions_1.getNewDefiState)(state.result, discoveryData, customPositionsResult.positionsByProvider, customPositionsResult.error || null, customPositionsResult.providerErrors, stkWalletToken, this.#getNonceId(account, network.chainId));
            const combinedTokens = (0, defiPositions_1.enhancePortfolioTokensWithDefiPositions)(portfolioResult.tokens, newDefiState);
            const combinedErrors = [...portfolioResult.errors, ...(discoveryData?.errors || [])];
            this.tokenDataCache[network.chainId.toString()] = portfolioResult.tokenDataCache;
            const rpcUrl = network.selectedRpcUrl;
            const blocksBehind = PortfolioController.#getBlocksBehind(accountState[network.chainId.toString()], portfolioResult.blockNumber, rpcUrl);
            // A lagging RPC returns the state of an older block, which would take the portfolio
            // backwards - outdated balances and an outdated nonce for the simulation. Keep what
            // is already displayed until the RPC catches up.
            const staleBlockThreshold = network.chainId === networks_1.ETHEREUM_CHAIN_ID
                ? portfolio_1.ETHEREUM_STALE_RPC_BLOCK_THRESHOLD
                : portfolio_1.DEFAULT_STALE_RPC_BLOCK_THRESHOLD;
            if (blocksBehind > staleBlockThreshold) {
                throw new StaleRpcBlockError_1.StaleRpcBlockError({
                    receivedBlockNumber: portfolioResult.blockNumber,
                    blocksBehind
                });
            }
            const hasError = combinedErrors.some((e) => e.level !== 'silent');
            let lastSuccessfulUpdate = accountState[network.chainId.toString()]?.lastSuccessfulUpdate || 0;
            // Reset lastSuccessfulUpdate on isManualUpdate in case of critical errors as the user
            // is likely expecting a change in the portfolio.
            if (isManualUpdate && hasError) {
                lastSuccessfulUpdate = 0;
            }
            else if (!hasError) {
                // Update the last successful update only if there are no critical errors.
                lastSuccessfulUpdate = Date.now();
            }
            accountState[network.chainId.toString()] = {
                accountOps: portfolioProps?.simulation?.accountOps,
                isReady: true,
                isLoading: false,
                errors: combinedErrors,
                lastSuccessfulUpdate,
                verification,
                rpcInfo: { url: rpcUrl },
                result: {
                    ...portfolioResult,
                    // Overwrite the discovery time from the portfolio lib
                    // as the request is made in the controller
                    discoveryTime: discoveryData?.discoveryTime || 0,
                    lastExternalApiUpdateData: discoveryData?.data?.hints
                        ? {
                            hasHints: discoveryData.data.hints.hasHints,
                            lastUpdate: discoveryData.data.hints.lastUpdate
                        }
                        : (state.result?.lastExternalApiUpdateData ?? null),
                    tokens: combinedTokens,
                    total: (0, helpers_1.getTotal)(combinedTokens, newDefiState),
                    defiPositions: newDefiState,
                    ...(state.result?.walletStaking && { walletStaking: state.result.walletStaking })
                }
            };
            const verifiedState = accountState[network.chainId.toString()];
            this.emitUpdate();
            if (verifiedState) {
                void (0, shareValue_1.getWalletStakingShareValue)({
                    chainId: network.chainId,
                    tokens: combinedTokens,
                    provider: portfolioLib.provider,
                    accountAddr: account.addr,
                    onError: (error) => this.emitError(error)
                })
                    .then((walletStaking) => {
                    if (!walletStaking ||
                        this.#state[account.addr]?.[network.chainId.toString()] !== verifiedState ||
                        !verifiedState.result) {
                        return;
                    }
                    verifiedState.result.walletStaking = walletStaking;
                    this.emitUpdate();
                })
                    .catch((error) => {
                    const walletStakingError = error instanceof Error
                        ? error
                        : new Error('Unable to update the WALLET staking conversion rate.');
                    this.emitError({
                        level: 'silent',
                        message: 'Unable to update the WALLET staking conversion rate.',
                        error: walletStakingError
                    });
                });
            }
            // Fire-and-forget: verify the just-fetched balances against Colibri without
            // blocking the portfolio update (balances are already emitted above). The
            // verdict is written back only if this exact state slot is still current,
            // guarding against a newer update having replaced it in the meantime.
            if (shouldVerifyPortfolio && verifiedState && this.#verification) {
                this.#verification
                    .verifyPortfolio({
                    account,
                    network,
                    rpcResult: portfolioResult,
                    getOptions: {
                        tokenDataRecency: 60000 * 5,
                        fetchPinned: !hasNonZeroTokens,
                        ...allHints,
                        ...portfolioProps,
                        blacklist: this.#blacklist
                    },
                    tokenDataCache: portfolioResult.tokenDataCache
                })
                    .then((verificationResult) => {
                    if (this.#state[account.addr]?.[network.chainId.toString()] !== verifiedState)
                        return;
                    verifiedState.verification = verificationResult;
                    this.emitUpdate();
                })
                    .catch((error) => {
                    this.emitError({
                        level: 'silent',
                        message: `Unexpected error while verifying portfolio through Colibri on ${network.name} (${network.chainId}).`,
                        error
                    });
                    if (this.#state[account.addr]?.[network.chainId.toString()] !== verifiedState)
                        return;
                    verifiedState.verification = {
                        provider: 'colibri',
                        status: 'warning',
                        error: 'Colibri could not verify portfolio balances',
                        updatedAt: Date.now()
                    };
                    this.emitUpdate();
                });
            }
            return [true, discoveryData];
        }
        catch (e) {
            if (e instanceof StaleRpcBlockError_1.StaleRpcBlockError) {
                this.#onStaleRpcBlock(account.addr, network, e);
            }
            else {
                this.emitError({
                    level: 'silent',
                    message: `Error while executing the 'get' function in the portfolio library on ${network.name} (${network.chainId})`,
                    error: e
                });
            }
            state.accountOps = portfolioProps?.simulation?.accountOps;
            state.isLoading = false;
            if (state.verification?.status === 'loading') {
                state.verification = {
                    provider: 'colibri',
                    status: 'warning',
                    error: e?.message || 'Portfolio failed before Colibri verification completed',
                    updatedAt: Date.now()
                };
            }
            // Convert the error to an object because the portfolio state is cloned
            // using structuredClone() which doesn't preserve custom error properties
            // like simulationErrorMsg
            state.criticalError = {
                message: e?.message || 'Error while executing the get function in the portfolio library.',
                simulationErrorMsg: e?.simulationErrorMsg,
                stack: e?.stack,
                name: e?.name
            };
            if (isManualUpdate && state.result) {
                // Reset lastSuccessfulUpdate on forceUpdate in case of a critical error as the user
                // is likely expecting a change in the portfolio.
                state.lastSuccessfulUpdate = 0;
            }
            this.emitUpdate();
            return [false, null];
        }
    }
    /**
     * Most defi positions are fetched from the external API per network, but there are some
     * "app" defi positions that have to be fetched separately, because they are not linked to a specific
     * network and have a slightly different structure (no addresses for assets).
     *
     * @example - Fetches Polymarket and Hyperliquid positions (among other)
     */
    async updateDefiAppsState(account, portfolioProps) {
        if (!this.#featureFlags.isFeatureEnabled('tokenAndDefiAutoDiscovery'))
            return;
        const defiMaxDataAgeMs = portfolioProps.isManualUpdate ? 0 : portfolioProps.defiMaxDataAgeMs;
        const accountState = this.#state[account.addr] ?? (this.#state[account.addr] = {});
        const canSkipUpdate = !portfolioProps.bypassServerSideCache &&
            PortfolioController.#getCanSkipUpdate(accountState['defiApps'], defiMaxDataAgeMs);
        if (canSkipUpdate) {
            this.debugLog('defi', 'Skipping DeFi apps update for account', () => ({
                account: account.addr,
                lastSuccessfulUpdate: accountState['defiApps']?.lastSuccessfulUpdate,
                defiMaxDataAgeMs
            }));
            return;
        }
        const updateStarted = Date.now();
        this.#setNetworkLoading(account.addr, 'defiApps', true);
        this.emitUpdate();
        try {
            const response = await this.batchedPortfolioDiscovery({
                chainId: 'customAppChain',
                accountAddr: account.addr,
                baseCurrency: 'usd'
                // forceUpdateDefi is not needed here as defi apps are updated together with at least one network
                // thus if that network requires a forced update, defi apps will be updated as well (due to the batcher)
                // The only thing we have to keep in mind is that the update MUST not be skipped if we wish to batch them
            });
            const defi = response.defi;
            // Throw the error after assigning the response so we can still use the returned hints
            if (!defi || 'errorState' in defi)
                throw new Error(`Defi discovery failed. Error: ${defi && 'errorState' in defi
                    ? defi.errorState[0]?.message || 'Unknown error (2)'
                    : 'Unknown error'}`);
            // An account with no positions in any DeFi app gets an empty object back, not an error
            const positions = 'positions' in defi ? defi.positions || [] : [];
            // Used only to sort assets and positions
            const positionsByProvider = (0, defiPositions_1.getUniqueMergedPositions)((0, defiPositions_1.getFormattedApiPositions)(positions), [], null);
            accountState.defiApps = {
                isReady: true,
                isLoading: false,
                errors: [],
                result: {
                    defiPositions: {
                        positionsByProvider,
                        lastSuccessfulUpdate: Date.now()
                    },
                    updateStarted,
                    tokens: [],
                    total: (0, helpers_1.getTotal)([], {
                        positionsByProvider
                    })
                },
                lastSuccessfulUpdate: Date.now()
            };
            this.#setNetworkLoading(account.addr, 'defiApps', false);
        }
        catch (e) {
            this.emitError({
                level: 'silent',
                message: `Error while fetching DeFi apps data from Velcro for account ${account.addr}.`,
                error: e
            });
            this.#setNetworkLoading(account.addr, 'defiApps', false, e);
        }
    }
    #getNonceId(acc, chainId) {
        if (!this.#accounts.accountStates)
            return undefined;
        if (!this.#accounts.accountStates[acc.addr])
            return undefined;
        const networkState = this.#accounts.accountStates[acc.addr]?.[chainId.toString()];
        if (!networkState)
            return undefined;
        const network = this.#networks.allNetworks.find((net) => net.chainId === chainId);
        if (!network)
            return undefined;
        const baseAcc = (0, getBaseAccount_1.getBaseAccount)(acc, networkState, network, this.#featureFlags.isFeatureEnabled('erc4337'), this.#featureFlags.isFeatureEnabled('eip7702'));
        return baseAcc.getNonceId();
    }
    /**
     * Returns the maxDataAgeMs to be used for portfolio updates on a specific network,
     * based on whether the account ops have changed and the user has assets on that network.
     */
    #getMaxDataAgeMs(accountId, chainId, isSimulating, maxDataAgeMs, maxDataAgeUnused) {
        if (isSimulating)
            return undefined;
        // maxDataAgeMsUnused is optional so we fall back to maxDataAgeMs if not provided
        if (typeof maxDataAgeUnused !== 'number')
            return maxDataAgeMs;
        const networksWithAssets = this.getNetworksWithAssets(accountId);
        const stringChainId = chainId.toString();
        // If we don't know about the network we assume it has assets
        if (!(stringChainId in (networksWithAssets || {})))
            return maxDataAgeMs;
        const hasAssetsOnNetwork = typeof networksWithAssets === 'object' && networksWithAssets !== null
            ? networksWithAssets[stringChainId]
            : false;
        return hasAssetsOnNetwork ? maxDataAgeMs : maxDataAgeUnused;
    }
    // The recommended behavior of the application that this API encourages is:
    // 1) when the user selects an account, update it's portfolio on all networks by calling updateSelectedAccount
    // 2) every time the user has a change in their pending (to be signed or to be mined) bundle(s) on a
    // certain network, call updateSelectedAccount again with those bundles; it will update the portfolio balance
    // on each network where there are bundles, and it will update the state on said networks
    // it will also use a high `priceRecency` to make sure we don't lose time in updating prices (since we care about running the simulations)
    // the purpose of this function is to call it when an account is selected or the queue of accountOps changes
    /**
     * Updates the portfolio of the passed account on the specified networks, or on all networks if none is specified.
     * If a simulation object is passed, it will be used to perform the update.
     *
     * @param accountId - the account for which the portfolio should be updated
     * @param networks - update only for these networks. If not passed, the portfolio will be updated for all networks in the wallet
     * @param simulation - simulation data. If not passed the portfolio will use the last passed simulation data
     * until it's overwritten by a new one or discarded using `discardSimulation(op)`
     * @param opts
     */
    async updateSelectedAccount(accountId, networks, simulation, opts) {
        const { maxDataAgeMs: paramsMaxDataAgeMs = 0, maxDataAgeMsUnused: paramsMaxDataAgeMsUnused, 
        // Set to -1 by default, which means no update. That is because we are making a lot of
        // portfolio updates, most of which shouldn't update the defi positions.
        defiMaxDataAgeMs = -1, isManualUpdate, bypassServerSideCache, accountOpIdsToDiscard } = opts || {};
        await this.initialLoadPromise;
        const selectedAccount = this.#accounts.accounts.find((x) => x.addr === accountId);
        if (!selectedAccount)
            throw new Error(`${accountId} is not found in accounts. Account count: ${this.#accounts.accounts.length}`);
        if (!this.#state[accountId])
            this.#state[accountId] = {};
        const accountState = this.#state[accountId];
        const networksToUpdate = networks || this.#networks.networks;
        this.debugLog('update', `Update queued for ${accountId}`, () => ({
            chainIds: networksToUpdate.map((n) => n.chainId.toString()),
            hasSimulation: !!simulation,
            opts
        }));
        await Promise.all([
            this.#getAdditionalPortfolio(accountId, paramsMaxDataAgeMs),
            ...networksToUpdate.map(async (network) => {
                const key = `${network.chainId}:${accountId}`;
                const portfolioLib = this.initializePortfolioLibIfNeeded(accountId, network.chainId, network);
                const currentAccountOps = simulation?.accountOps[network.chainId.toString()]?.filter((op) => op.accountAddr === accountId);
                if (!this.#queue?.[accountId]?.[network.chainId.toString()])
                    this.#queue[accountId] = {
                        ...this.#queue[accountId],
                        [network.chainId.toString()]: Promise.resolve()
                    };
                const updatePromise = async () => {
                    const networkAccountState = this.#accounts.accountStates?.[accountId]?.[network.chainId.toString()];
                    const simulatedAccountOps = accountState[network.chainId.toString()]?.accountOps;
                    const accountOpIdsToDiscardOnNetwork = accountOpIdsToDiscard?.[network.chainId.toString()];
                    const accountOpIdsToDiscardSet = new Set(accountOpIdsToDiscardOnNetwork);
                    // Read and filter the latest simulation inside the queue so an older confirmed
                    // AccountOp cannot discard a newer simulation that was already queued before it.
                    // Safe accounts are refreshed even without a matching simulation, because signed
                    // Safe txns are intentionally not simulated while waiting in the Safe queue.
                    if (accountOpIdsToDiscardOnNetwork &&
                        !selectedAccount.safeCreation &&
                        !simulatedAccountOps?.some((op) => accountOpIdsToDiscardSet.has(op.id)))
                        return;
                    // currentAccountOps || simulatedAccountOps means that pendingToBeConfirmed
                    // accountOps will be discarded if a new transaction on the same network comes.
                    // We evaluated the complexity to fix this and decided it's not worth it.
                    // When a new txn comes, pendingToBeConfirmed simulations will be dropped
                    // and that's fine as you care about the simulation of your current txn
                    const accountOpsToSimulate = accountOpIdsToDiscardOnNetwork
                        ? simulatedAccountOps?.filter((op) => !accountOpIdsToDiscardSet.has(op.id))
                        : currentAccountOps || simulatedAccountOps;
                    // Even if maxDataAgeMs is set to a non-zero value, we want to force an update when the AccountOps change.
                    // We pass undefined, because setting the value to 0 would imply a manual update by the user.
                    const maxDataAgeMs = this.#getMaxDataAgeMs(accountId, network.chainId, !!currentAccountOps || !!accountOpIdsToDiscardOnNetwork, paramsMaxDataAgeMs, paramsMaxDataAgeMsUnused);
                    const state = simulation?.states?.[network.chainId.toString()] || networkAccountState;
                    const baseAcc = state
                        ? (0, getBaseAccount_1.getBaseAccount)(selectedAccount, state, network, this.#featureFlags.isFeatureEnabled('erc4337'), this.#featureFlags.isFeatureEnabled('eip7702'))
                        : null;
                    const [isSuccessful, discoveryResponse] = await this.updatePortfolioState(selectedAccount, network, portfolioLib, {
                        maxDataAgeMs,
                        isManualUpdate,
                        bypassServerSideCache,
                        blockTag: 'both',
                        defiMaxDataAgeMs,
                        ...(accountOpsToSimulate &&
                            accountOpsToSimulate.length &&
                            baseAcc &&
                            state && {
                            simulation: {
                                baseAccount: baseAcc,
                                accountOps: accountOpsToSimulate,
                                state
                            }
                        }),
                        disableAutoDiscovery: true,
                        hasKeys: this.#keystore.getAccountKeys(selectedAccount).length > 0
                    });
                    if (accountOpsToSimulate?.length)
                        this.debugLog('simulation', `${network.chainId.toString()}: Simulated ${accountOpsToSimulate.length} account op(s)`, () => ({
                            accountOpIds: accountOpsToSimulate.map((op) => op.id),
                            isSuccessful
                        }));
                    this.debugLog('update', `${network.chainId.toString()}: Portfolio updated on ${network.name}`, () => ({
                        isSuccessful
                    }));
                    // Learn tokens and nfts from the portfolio lib
                    if (isSuccessful && accountState[network.chainId.toString()]?.result) {
                        const networkResult = accountState[network.chainId.toString()].result;
                        if (networkResult) {
                            await this.hints.learnAssetsFromLibResult(key, network.chainId, accountId, networkResult);
                            this.hints.learnTokenMetadata(network.chainId, networkResult.fetchedTokenMetadata);
                            this.hints.learnCollectionMetadata(network.chainId, networkResult.fetchedCollectionMetadata);
                        }
                        // Only update this if all networks where updated so we know for sure that the user
                        // has disabled the ones in otherNetworksDefiCounts
                        if (!networks && discoveryResponse?.data) {
                            this.#defiPositionsCountOnDisabledNetworks[accountId] =
                                discoveryResponse.data.otherNetworksDefiCounts || {};
                        }
                    }
                };
                // Chain the new updatePromise to the current queue
                this.#queue[accountId][network.chainId.toString()] = this.#queue?.[accountId]?.[network.chainId.toString()].then(updatePromise).catch((error) => {
                    console.error(error);
                    return updatePromise();
                });
                // Ensure the method waits for the entire queue to resolve
                await this.#queue[accountId][network.chainId.toString()];
            }),
            this.updateDefiAppsState(selectedAccount, {
                maxDataAgeMs: paramsMaxDataAgeMs,
                defiMaxDataAgeMs: defiMaxDataAgeMs,
                isManualUpdate,
                hasKeys: this.#keystore.getAccountKeys(selectedAccount).length > 0,
                bypassServerSideCache
            })
        ]);
        await this.#updateNetworksWithAssets(accountId, accountState);
        this.emitUpdate();
    }
    // Reports to Sentry if the portfolio was not updated after an updated AccountOp.
    // We previously encountered such a case (see https://github.com/AmbireTech/ambire-app/issues/6371),
    // and this method is added to verify whether our hypothesis about the root cause is correct.
    reportMissedPortfolioUpdateAfterUpdatedAccountOp(accountId, updatedAccountsOps) {
        if (!updatedAccountsOps.length)
            return;
        const accountState = this.#state[accountId];
        if (!accountState)
            return;
        // The minimum block number that the portfolio must be updated to per chainId.
        // The portfolio block does NOT have to match this block exactly.
        // It can be higher (because other updates may have occurred in the meantime),
        // but it must be >= this value to ensure the Activity confirmation is reflected.
        const expectedMinPortfolioBlockByChainId = {};
        for (const op of updatedAccountsOps) {
            if (op.accountAddr !== accountId || !op.blockNumber)
                continue;
            const chainKey = op.chainId.toString();
            const prev = expectedMinPortfolioBlockByChainId[chainKey];
            if (prev == null || op.blockNumber > prev) {
                expectedMinPortfolioBlockByChainId[chainKey] = op.blockNumber;
            }
        }
        // We don't need the full error and its stack trace reported to Sentry
        const flatError = (e) => ({
            name: e.name,
            message: e.message,
            simulationErrorMsg: e.simulationErrorMsg
        });
        const chainIds = Object.keys(expectedMinPortfolioBlockByChainId);
        if (!chainIds.length)
            return;
        for (const chainKey of chainIds) {
            const expectedMinBlock = expectedMinPortfolioBlockByChainId[chainKey];
            // satisfies TS and is safe guard
            if (expectedMinBlock == null)
                continue;
            const networkState = accountState[chainKey];
            const portfolioBlock = networkState?.result?.blockNumber;
            const isLoading = !!networkState?.isLoading;
            const hasCriticalError = !!networkState?.criticalError;
            // Can't validate yet - no portfolio data or still loading.
            if (portfolioBlock == null)
                continue;
            if (isLoading)
                continue;
            // In case of a critical error, the portfolio won't be updated to the new block.
            // However, we already handle this on the UI level (showing a warning + an option for a manual refresh),
            // so we are not interested in reporting it.
            if (hasCriticalError)
                continue;
            if (portfolioBlock < expectedMinBlock) {
                const message = '[PORTFOLIO_ACTIVITY_BLOCK_MISMATCH] Portfolio block is behind confirmed Activity block';
                const error = new Error(message);
                error.debugInfo = {
                    accountId,
                    chainId: chainKey,
                    expectedMinBlock,
                    portfolioBlock,
                    errors: (networkState?.errors || []).map(flatError)
                };
                this.emitError({
                    level: 'silent',
                    sendCrashReport: true,
                    message,
                    error
                });
            }
        }
    }
    markSimulationAsBroadcasted(accountId, chainId) {
        const simulation = this.#state?.[accountId]?.[chainId.toString()]?.accountOps?.[0];
        if (!simulation)
            return;
        simulation.status = types_1.AccountOpStatus.BroadcastedButNotConfirmed;
        this.emitUpdate();
    }
    removeAccountData(address) {
        delete this.#state[address];
        delete this.#networksWithAssetsByAccounts[address];
        this.#networks.networks.forEach((network) => {
            const key = `${network.chainId}:${address}`;
            if (key in this.#portfolioLibs) {
                this.#portfolioLibs.delete(key);
            }
        });
        this.#storage.set('networksWithAssetsByAccount', this.#networksWithAssetsByAccounts);
        this.emitUpdate();
    }
    getAccountPortfolioState(accountAddr) {
        return this.#state[accountAddr] || {};
    }
    getIsStateWithOutdatedNetworks(accountAddr) {
        const stateNetworksCount = Object.keys(this.getAccountPortfolioState(accountAddr)).filter((key) => !(0, selectedAccount_1.isInternalChain)(key)).length;
        // Read from networks, and not allNetworks
        const networksCount = this.#networks.networks.length;
        return stateNetworksCount !== networksCount;
    }
    getNetworksWithAssets(accountAddr) {
        return this.#networksWithAssetsByAccounts[accountAddr] || {};
    }
    /**
     * Always pass account ops that belong to the same account & network
     */
    async simulateAccountOp(op) {
        const account = this.#accounts.accounts.find((acc) => acc.addr === op.accountAddr);
        const network = this.#networks.networks.find((net) => net.chainId === op.chainId);
        const accountState = await this.#accounts.getOrFetchAccountOnChainState(op.accountAddr, op.chainId);
        if (!account) {
            const message = `${op.accountAddr} is not found in accounts. Account count: ${this.#accounts.accounts.length}`;
            this.emitError({
                level: 'silent',
                message,
                error: new Error(message)
            });
            return;
        }
        if (!network) {
            const message = `Network with chainId ${op.chainId} not found`;
            this.emitError({
                level: 'silent',
                message,
                error: new Error(message)
            });
            return;
        }
        const noSimulation = !accountState || ((0, account_1.isBasicAccount)(account, accountState) && network.rpcNoStateOverride);
        const simulation = !noSimulation
            ? {
                accountOps: { [network.chainId.toString()]: [op] },
                states: { [network.chainId.toString()]: accountState }
            }
            : undefined;
        return this.updateSelectedAccount(op.accountAddr, [network], simulation);
    }
    async updateNetworksWithDefiPositions(accountId, accountState, providers) {
        this.#networksWithPositionsByAccounts[accountId] = (0, defiPositions_1.getAccountNetworksWithPositions)(accountId, accountState, this.#networksWithPositionsByAccounts, providers);
        await this.#storage.set('networksWithPositionsByAccounts', this.#networksWithPositionsByAccounts);
    }
    getNetworksWithDefiPositions(accountAddr) {
        return this.#networksWithPositionsByAccounts[accountAddr] || {};
    }
    addDefiSession(sessionId) {
        this.#defiSessionIds = [...new Set([...this.#defiSessionIds, sessionId])];
    }
    removeDefiSession(sessionId) {
        this.#defiSessionIds = this.#defiSessionIds.filter((id) => id !== sessionId);
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            customTokens: this.customTokens,
            tokenPreferences: this.tokenPreferences,
            scheduledUpdateChainIds: this.scheduledUpdateChainIds,
            // Left out of the UI state. The hints already reach it through customTokens and
            // tokenPreferences, and the UI never reads the token data cache
            hints: undefined,
            tokenDataCache: undefined
        };
    }
}
exports.PortfolioController = PortfolioController;
//# sourceMappingURL=portfolio.js.map