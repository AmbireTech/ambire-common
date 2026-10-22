"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworksController = exports.STATUS_WRAPPED_METHODS = void 0;
const tslib_1 = require("tslib");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const recurringTimeout_1 = require("../../classes/recurringTimeout/recurringTimeout");
const intervals_1 = require("../../consts/intervals");
const networks_1 = require("../../consts/networks");
const testnetNetworks_1 = require("../../consts/testnetNetworks");
const networks_2 = require("../../libs/networks/networks");
const relayerCall_1 = require("../../libs/relayerCall/relayerCall");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
exports.STATUS_WRAPPED_METHODS = {
    addNetwork: 'INITIAL',
    updateNetwork: 'INITIAL'
};
/**
 * The NetworksController is responsible for managing networks. It handles both predefined networks and those
 * that users can add either through a dApp request or manually via the UI. This controller provides functions
 * for adding, updating, and removing networks.
 */
class NetworksController extends eventEmitter_1.default {
    // To enable testnet-only mode, pass defaultNetworksMode = 'testnet' when constructing the NetworksController in the MainController.
    // On a fresh installation of the extension, the testnetNetworks constants will be used to initialize the NetworksController.
    // Adding custom networks remains possible in testnet mode, as no network filtering is applied.
    defaultNetworksMode = 'mainnet';
    #storage;
    #fetch;
    #callRelayer;
    #featureFlags;
    #networks = {};
    statuses = exports.STATUS_WRAPPED_METHODS;
    networkToAddOrUpdate = null;
    // Prevents race conditions in setNetworkToAddOrUpdate
    #networkToAddOrUpdateRequestId = 0;
    areNetworksFetchingFromRelayer = false;
    #useTempProvider;
    /** Callback that gets called when adding or updating network */
    #onAddOrUpdateNetworks;
    #onReady;
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    #updateWithRelayerNetworksInterval;
    constructor({ eventEmitterRegistry, defaultNetworksMode, storage, fetch, relayerUrl, useTempProvider, onAddOrUpdateNetworks, onReady, featureFlags }) {
        super(eventEmitterRegistry);
        if (defaultNetworksMode)
            this.defaultNetworksMode = defaultNetworksMode;
        this.#storage = storage;
        this.#fetch = fetch;
        this.#callRelayer = relayerCall_1.relayerCall.bind({ url: relayerUrl, fetch });
        this.#useTempProvider = useTempProvider;
        this.#onAddOrUpdateNetworks = onAddOrUpdateNetworks;
        this.#onReady = onReady;
        this.#featureFlags = featureFlags;
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
        /**
         * Schedules periodic network synchronization.
         *
         * This function ensures that the `synchronizeNetworks` method runs every 8 hours
         * to periodically refetch networks in case there are updates,
         * since the extension relies on the config from relayer.
         */
        this.#updateWithRelayerNetworksInterval = new recurringTimeout_1.RecurringTimeout(this.synchronizeNetworks.bind(this), intervals_1.NETWORKS_UPDATE_INTERVAL, this.emitError.bind(this));
        if (this.defaultNetworksMode === 'mainnet') {
            this.#updateWithRelayerNetworksInterval.start();
        }
    }
    get isInitialized() {
        return !!Object.keys(this.#networks).length;
    }
    get allNetworks() {
        if (!Object.keys(this.#networks).length) {
            return this.defaultNetworksMode === 'mainnet' ? networks_1.networks : testnetNetworks_1.testnetNetworks;
        }
        const uniqueNetworksByChainId = Object.values(this.#networks)
            .sort((a, b) => +b.predefined - +a.predefined) // first predefined
            .filter((item, index, self) => self.findIndex((i) => i.chainId === item.chainId) === index); // unique by chainId (predefined with priority)
        return uniqueNetworksByChainId.map((network) => {
            network.features = (0, networks_2.getFeaturesByNetworkProperties)({
                isSAEnabled: network.isSAEnabled,
                isOptimistic: network.isOptimistic ?? false,
                rpcNoStateOverride: network.rpcNoStateOverride,
                erc4337: network.erc4337,
                areContractsDeployed: network.areContractsDeployed,
                feeOptions: network.feeOptions,
                platformId: network.platformId,
                nativeAssetId: network.nativeAssetId,
                flagged: network.flagged ?? false,
                chainId: network.chainId,
                hasSingleton: network.hasSingleton
            }, network);
            return network;
        });
    }
    get networks() {
        return this.allNetworks.filter((network) => !network.disabled);
    }
    get disabledNetworks() {
        return this.allNetworks.filter((network) => network.disabled);
    }
    async getNetworksInStorage() {
        const rawNetworksInStorage = await this.#storage.get('networks', {});
        return (0, networks_2.getValidNetworks)(rawNetworksInStorage);
    }
    /**
     * Loads the network configurations for the initial load.
     *
     * This method performs the following steps:
     * 1. Retrieves the latest network configurations from storage.
     * 2. Seeds the networks from storage, or from the predefined networks on a fresh
     *    install (instantiating the RPC providers via `#onReady` in that case).
     * 3. Persists the seeded networks and updates network features asynchronously.
     * 4. Triggers `synchronizeNetworks` in the BACKGROUND (not awaited) to merge the
     *    latest configuration from the Relayer.
     *
     * The relayer merge is intentionally not awaited so that `initialLoadPromise`
     * resolves with the stored networks immediately — keeping the relayer fetch off
     * the critical path of controllers that gate the mobile splash hide. The merge,
     * provider swap and portfolio reload for any changed networks all happen in
     * `synchronizeNetworks`.
     */
    async #load() {
        await this.#featureFlags?.initialLoadPromise;
        // Step 1. Get latest storage (networksInStorage) and validate/normalize
        const networksInStorage = await this.getNetworksInStorage();
        // Step 2. Seed the networks from storage (or predefined on a fresh install).
        // The relayer refresh is intentionally NOT awaited here (see Step 4) so that
        // the initial load resolves immediately with the stored networks. This keeps
        // the relayer fetch (/v2/config/networks, up to a 5s timeout) off the critical
        // path of controllers that await `initialLoadPromise` (accounts →
        // selectedAccount), which on mobile gate the splash hide.
        if (!Object.keys(networksInStorage).length) {
            const defaultNetworks = this.defaultNetworksMode === 'mainnet' ? networks_1.networks : testnetNetworks_1.testnetNetworks;
            this.#networks = defaultNetworks.reduce((acc, network) => {
                acc[network.chainId.toString()] = network;
                return acc;
            }, {});
            // Instantiate the RPC providers from the seeded networks before resolving.
            await this.#onReady();
        }
        else {
            this.#networks = Object.fromEntries(Object.values(networksInStorage).map((network) => [network.chainId.toString(), network]));
        }
        this.emitUpdate();
        await this.#storage.set('networks', this.#networks);
        // Step 3: Update networks features asynchronously
        this.#updateNetworkFeatures(this.#networks);
        // Step 4: Refresh from the Relayer in the background (RPC URLs may have
        // changed). `synchronizeNetworks` merges the relayer config, swaps providers
        // and reloads the portfolio for any changed networks, and toggles
        // `areNetworksFetchingFromRelayer` so the dashboard can hold the balance in a
        // loading state until the fresh data lands. Not awaited so `initialLoadPromise`
        // resolves now. (Skipped in testnet mode by `synchronizeNetworks` itself.)
        this.synchronizeNetworks().catch((error) => this.emitError({
            level: 'silent',
            message: 'Failed to refresh the networks configuration from the Relayer.',
            error
        }));
    }
    /**
     * Processes network updates, finalizes changes, and updates network features asynchronously.
     * Used for periodically network synchronization.
     */
    async synchronizeNetworks() {
        if (this.defaultNetworksMode === 'testnet')
            return;
        if (this.#featureFlags?.isFeatureEnabled('networkConfig') === false)
            return;
        this.areNetworksFetchingFromRelayer = true;
        this.emitUpdate();
        try {
            // Process updates (merge Relayer data and apply rules)
            const { mergedNetworks, updatedNetworkChainIds } = await this.mergeRelayerNetworks(this.#networks);
            // Finalize updates
            this.#networks = mergedNetworks;
            this.emitUpdate();
            await this.#storage.set('networks', this.#networks);
            // We must call this after merging the local networks with the ones from the Relayer
            // to ensure that RPC providers of newly enabled networks are instantiated.
            // Awaited so `areNetworksFetchingFromRelayer` stays true until the portfolio
            // reload triggered by the updated RPCs has finished — otherwise the flag would
            // flip to false before the reload re-enters its loading state, briefly exposing
            // a balance (and warnings) computed from the old RPCs that were potentially being replaced.
            if (updatedNetworkChainIds.length) {
                await this.#onAddOrUpdateNetworks(this.allNetworks.filter((n) => updatedNetworkChainIds.includes(n.chainId)));
            }
            // Asynchronously update network features
            this.#updateNetworkFeatures(mergedNetworks);
        }
        finally {
            this.areNetworksFetchingFromRelayer = false;
            this.emitUpdate();
        }
    }
    /**
     * Merges locally stored networks with those fetched from the Relayer.
     *
     * This function ensures that networks retrieved from the Relayer are properly merged
     * with existing stored networks, keeping track of configuration versions and handling
     * predefined networks appropriately. It also ensures that the latest RPC URLs are
     * maintained and applies special-case handling where needed.
     *
     * ### Functionality:
     * 1. Fetches the latest network configurations from the Relayer.
     * 2. Maps and merges the fetched networks with those stored locally.
     * 3. If a network does not exist in storage, it is added from the Relayer.
     * 4. If a network is predefined but has an outdated configuration, it is updated.
     * 5. Ensures RPC URLs are combined uniquely across sources.
     * 6. Removes predefined flags if a predefined network is removed by the Relayer.
     * 7. Applies special handling for networks like Odyssey.
     *
     */
    async mergeRelayerNetworks(currentNetworks) {
        if (this.#featureFlags?.isFeatureEnabled('networkConfig') === false) {
            return { mergedNetworks: currentNetworks, updatedNetworkChainIds: [] };
        }
        let relayerNetworks = {};
        try {
            const res = await Promise.race([
                this.#callRelayer('/v2/config/networks'),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Relayer call to /v2/config/networks timed out after 5000ms')), 5000);
                })
            ]);
            relayerNetworks = res.data.extensionConfigNetworks;
            return (0, networks_2.getNetworksUpdatedWithRelayerNetworks)(currentNetworks, relayerNetworks);
        }
        catch (e) {
            console.error('Failed to fetch networks from the Relayer', e);
        }
        return {
            mergedNetworks: currentNetworks,
            updatedNetworkChainIds: []
        };
    }
    /**
     * Updates network features asynchronously if needed.
     */
    async #updateNetworkFeatures(finalNetworks) {
        const updatePromises = Object.values(finalNetworks).map(async (network) => {
            if (network.isSAEnabled)
                return;
            if (network.lastUpdatedNetworkInfo &&
                Date.now() - network.lastUpdatedNetworkInfo <= 24 * 60 * 60 * 1000)
                return;
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            this.#useTempProvider({
                chainId: network.chainId,
                rpcUrl: network.selectedRpcUrl
            }, async (provider) => {
                await (0, networks_2.getNetworkInfo)(this.#fetch, network.chainId, provider, async (info) => {
                    if ((0, networks_2.isNetworkInfoPending)(info))
                        return;
                    // If RPC is flagged there might be an issue with the RPC
                    // this information will fail to return
                    // and we dont want to update lastUpdatedNetworkInfo
                    const chainId = network.chainId.toString();
                    if (info.flagged || !this.#networks[chainId])
                        return;
                    this.#networks[chainId] = {
                        ...this.#networks[chainId],
                        ...info,
                        lastUpdatedNetworkInfo: Date.now()
                    };
                    await this.#storage.set('networks', this.#networks);
                    this.emitUpdate();
                }, network);
            });
        });
        await Promise.all(updatePromises);
    }
    async setNetworkToAddOrUpdate(networkToAddOrUpdate = null) {
        this.#networkToAddOrUpdateRequestId += 1;
        const requestId = this.#networkToAddOrUpdateRequestId;
        if (!networkToAddOrUpdate) {
            this.networkToAddOrUpdate = null;
            this.emitUpdate();
            return;
        }
        // Seeded so the very first emission already carries the loading shape, instead of the
        // UI rendering a frame of "?" rows before the probes report in.
        this.networkToAddOrUpdate = {
            ...networkToAddOrUpdate,
            info: (0, networks_2.getLoadingNetworkInfo)(networkToAddOrUpdate.chainId)
        };
        this.emitUpdate();
        await this.initialLoadPromise;
        await this.#useTempProvider({ chainId: networkToAddOrUpdate.chainId, rpcUrl: networkToAddOrUpdate.rpcUrl }, async (provider) => {
            await (0, networks_2.getNetworkInfo)(this.#fetch, networkToAddOrUpdate.chainId, provider, (info) => {
                if (requestId !== this.#networkToAddOrUpdateRequestId)
                    return;
                if (!this.networkToAddOrUpdate)
                    return;
                this.networkToAddOrUpdate = { ...this.networkToAddOrUpdate, info };
                this.emitUpdate();
            }, this.#networks[networkToAddOrUpdate.chainId.toString()]);
        });
    }
    async #addNetwork(network) {
        await this.initialLoadPromise;
        // The redundant-looking `info` check is what narrows `networkToAddOrUpdate` below
        if (!this.networkToAddOrUpdate?.info || (0, networks_2.isNetworkInfoPending)(this.networkToAddOrUpdate.info)) {
            throw new EmittableError_1.default({
                message: "We're still checking this network. Please wait a moment and try again.",
                level: 'expected',
                error: new Error('settings: addNetwork called before the network info was resolved')
            });
        }
        const chainIds = this.allNetworks.map((net) => net.chainId);
        // make sure the id and chainId of the network are unique
        if (chainIds.indexOf(BigInt(network.chainId)) !== -1) {
            throw new EmittableError_1.default({
                message: 'The network you are trying to add has already been added.',
                level: 'expected',
                error: new Error('settings: addNetwork chain already added (duplicate id/chainId)')
            });
        }
        const info = { ...this.networkToAddOrUpdate.info };
        const { feeOptions } = info;
        // @ts-ignore
        delete info.feeOptions;
        this.#networks[network.chainId.toString()] = {
            ...network,
            ...info,
            feeOptions,
            features: (0, networks_2.getFeaturesByNetworkProperties)(info, undefined),
            hasRelayer: false,
            predefined: false,
            has7702: false
        };
        void this.#onAddOrUpdateNetworks([this.#networks[network.chainId.toString()]]);
        await this.#storage.set('networks', this.#networks);
        this.networkToAddOrUpdate = null;
        this.emitUpdate();
    }
    async addNetwork(network) {
        await this.withStatus('addNetwork', () => this.#addNetwork(network));
    }
    async #updateNetwork(network, chainId, skipUpdate) {
        await this.initialLoadPromise;
        if (!Object.keys(network).length)
            return;
        const networkData = this.allNetworks.find((n) => n.chainId === chainId);
        const changedNetwork = Object.keys(network).reduce((acc, key) => {
            if (!networkData)
                return acc;
            // No need to save unchanged networks. Here we filter the networks that are the same as the ones in the storage.
            if (network[key] === networkData[key])
                return acc;
            return { ...acc, [key]: network[key] };
        }, {});
        // Update the networks with the incoming new values
        this.#networks[chainId.toString()] = {
            ...networkData,
            ...changedNetwork
        };
        await this.#storage.set('networks', this.#networks);
        if (!skipUpdate)
            void this.#onAddOrUpdateNetworks([this.#networks[chainId.toString()]]);
        const checkRPC = async (networkToAddOrUpdate) => {
            if (changedNetwork.selectedRpcUrl) {
                const stringChainId = chainId.toString();
                if (!this.#networks[stringChainId])
                    return;
                if (networkToAddOrUpdate?.info &&
                    Object.values(networkToAddOrUpdate.info).every((prop) => prop !== 'LOADING')) {
                    const info = { ...networkToAddOrUpdate.info };
                    const { feeOptions } = info;
                    delete info.feeOptions;
                    this.#networks[stringChainId] = {
                        ...this.#networks[stringChainId],
                        ...info,
                        ...feeOptions
                    };
                    await this.#storage.set('networks', this.#networks);
                    this.emitUpdate();
                    return;
                }
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                this.#useTempProvider({
                    chainId,
                    rpcUrl: changedNetwork.selectedRpcUrl
                }, async (provider) => {
                    await (0, networks_2.getNetworkInfo)(this.#fetch, chainId, provider, async (info) => {
                        if ((0, networks_2.isNetworkInfoPending)(info))
                            return;
                        const { feeOptions } = info;
                        delete info.feeOptions;
                        this.#networks[stringChainId] = {
                            ...this.#networks[stringChainId],
                            ...info,
                            ...feeOptions
                        };
                        await this.#storage.set('networks', this.#networks);
                        this.emitUpdate();
                    }, this.#networks[stringChainId]);
                });
            }
        };
        // Do not wait the rpc validation in order to complete the execution of updateNetwork
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        checkRPC(this.networkToAddOrUpdate);
        this.networkToAddOrUpdate = null;
        if (!skipUpdate)
            this.emitUpdate();
    }
    async updateNetwork(network, chainId) {
        await this.withStatus('updateNetwork', () => this.#updateNetwork(network, chainId));
    }
    async #updateNetworks(network, chainIds) {
        await Promise.all(chainIds.map((chainId) => this.#updateNetwork(network, chainId, true)));
        void this.#onAddOrUpdateNetworks(this.allNetworks.filter((n) => chainIds.includes(n.chainId)));
        this.emitUpdate();
    }
    async updateNetworks(network, chainIds) {
        await this.withStatus('updateNetwork', () => this.#updateNetworks(network, chainIds));
    }
    /**
     * Bulk-adds networks coming from another device. A network whose chainId is already
     * here gets overridden, the rest of the networks stay untouched.
     */
    async mergeNetworks(networks) {
        await this.initialLoadPromise;
        if (!networks.length)
            return;
        networks.forEach((network) => {
            this.#networks[network.chainId.toString()] = network;
        });
        await this.#storage.set('networks', this.#networks);
        const mergedChainIds = networks.map((network) => network.chainId);
        void this.#onAddOrUpdateNetworks(this.allNetworks.filter((network) => mergedChainIds.includes(network.chainId)));
        this.emitUpdate();
    }
    /**
     * @deprecated - users can no longer remove networks from the UI
     */
    async removeNetwork(chainId) {
        await this.initialLoadPromise;
        if (!this.#networks[chainId.toString()])
            return;
        delete this.#networks[chainId.toString()];
        await this.#storage.set('networks', this.#networks);
        this.emitUpdate();
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            isInitialized: this.isInitialized,
            networks: this.networks,
            disabledNetworks: this.disabledNetworks,
            allNetworks: this.allNetworks
        };
    }
}
exports.NetworksController = NetworksController;
//# sourceMappingURL=networks.js.map