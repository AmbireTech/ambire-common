"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NetworksController = void 0;
const tslib_1 = require("tslib");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const networks_1 = require("../../consts/networks");
const networks_2 = require("../../libs/networks/networks");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const STATUS_WRAPPED_METHODS = {
    addNetwork: 'INITIAL',
    updateNetwork: 'INITIAL'
};
/**
 * The NetworksController is responsible for managing networks. It handles both predefined networks and those
 * that users can add either through a dApp request or manually via the UI. This controller provides functions
 * for adding, updating, and removing networks.
 */
class NetworksController extends eventEmitter_1.default {
    #storage;
    #fetch;
    #networks = {};
    statuses = STATUS_WRAPPED_METHODS;
    networkToAddOrUpdate = null;
    #onRemoveNetwork;
    #onAddOrUpdateNetwork;
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    constructor(storage, fetch, onAddOrUpdateNetwork, onRemoveNetwork) {
        super();
        this.#storage = storage;
        this.#fetch = fetch;
        this.#onAddOrUpdateNetwork = onAddOrUpdateNetwork;
        this.#onRemoveNetwork = onRemoveNetwork;
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.initialLoadPromise = this.#load();
    }
    get isInitialized() {
        return !!Object.keys(this.#networks).length;
    }
    get networks() {
        if (!this.#networks)
            return networks_1.networks;
        const uniqueNetworksByChainId = Object.values(this.#networks)
            .sort((a, b) => +b.predefined - +a.predefined) // first predefined
            .filter((item, index, self) => self.findIndex((i) => i.chainId === item.chainId) === index); // unique by chainId (predefined with priority)
        return uniqueNetworksByChainId.map((network) => {
            // eslint-disable-next-line no-param-reassign
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
                hasSingleton: network.hasSingleton,
                force4337: network.force4337
            });
            return network;
        });
    }
    async #load() {
        const storedNetworkPreferences = await this.#storage.get('networkPreferences', undefined);
        let storedNetworks;
        storedNetworks = await this.#storage.get('networks', {});
        if (!Object.keys(storedNetworks).length && storedNetworkPreferences) {
            storedNetworks = await (0, networks_2.migrateNetworkPreferencesToNetworks)(storedNetworkPreferences);
            await this.#storage.set('networks', storedNetworks);
            await this.#storage.remove('networkPreferences');
        }
        this.#networks = storedNetworks;
        networks_1.networks.forEach((n) => {
            this.#networks[n.id] = {
                ...n,
                ...(this.#networks[n.id] || {}),
                // attributes that should take predefined priority
                feeOptions: n.feeOptions,
                hasRelayer: n.hasRelayer,
                erc4337: {
                    enabled: (0, networks_2.is4337Enabled)(!!n.erc4337.hasBundlerSupport, n, this.#networks[n.id]?.force4337),
                    hasPaymaster: n.erc4337.hasPaymaster,
                    defaultBundler: n.erc4337.defaultBundler,
                    bundlers: n.erc4337.bundlers
                },
                nativeAssetId: n.nativeAssetId,
                nativeAssetSymbol: n.nativeAssetSymbol
            };
        });
        // add predefined: false for each deleted network from predefined
        Object.keys(this.#networks).forEach((networkName) => {
            const predefinedNetwork = networks_1.networks.find((net) => net.chainId === this.#networks[networkName].chainId);
            if (!predefinedNetwork) {
                this.#networks[networkName].predefined = false;
            }
        });
        // without await to avoid performance impact on load
        // needed to keep the networks storage up to date with the latest from predefinedNetworks
        this.#storage.set('networks', this.#networks);
        this.emitUpdate();
    }
    async setNetworkToAddOrUpdate(networkToAddOrUpdate = null) {
        await this.initialLoadPromise;
        if (networkToAddOrUpdate) {
            this.networkToAddOrUpdate = networkToAddOrUpdate;
            this.emitUpdate();
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            (0, networks_2.getNetworkInfo)(this.#fetch, networkToAddOrUpdate.rpcUrl, networkToAddOrUpdate.chainId, (info) => {
                if (this.networkToAddOrUpdate) {
                    this.networkToAddOrUpdate = { ...this.networkToAddOrUpdate, info };
                    this.emitUpdate();
                }
            }, networkToAddOrUpdate.force4337 ? { force4337: networkToAddOrUpdate.force4337 } : undefined);
        }
        else {
            this.networkToAddOrUpdate = null;
            this.emitUpdate();
        }
    }
    async #addNetwork(network) {
        await this.initialLoadPromise;
        if (!this.networkToAddOrUpdate?.info ||
            Object.values(this.networkToAddOrUpdate.info).some((prop) => prop === 'LOADING')) {
            return;
        }
        const chainIds = this.networks.map((net) => net.chainId);
        const ids = this.networks.map((n) => n.id);
        const networkId = network.name.toLowerCase();
        // make sure the id and chainId of the network are unique
        if (ids.indexOf(networkId) !== -1 || chainIds.indexOf(BigInt(network.chainId)) !== -1) {
            throw new EmittableError_1.default({
                message: 'The network you are trying to add has already been added.',
                level: 'major',
                error: new Error('settings: addNetwork chain already added (duplicate id/chainId)')
            });
        }
        const info = { ...this.networkToAddOrUpdate.info };
        const { feeOptions } = info;
        // @ts-ignore
        delete info.feeOptions;
        this.#networks[networkId] = {
            id: networkId,
            ...network,
            ...info,
            feeOptions,
            features: (0, networks_2.getFeaturesByNetworkProperties)(info),
            hasRelayer: false,
            predefined: false
        };
        this.#onAddOrUpdateNetwork(this.#networks[networkId]);
        await this.#storage.set('networks', this.#networks);
        this.networkToAddOrUpdate = null;
        this.emitUpdate();
    }
    async addNetwork(network) {
        await this.withStatus('addNetwork', () => this.#addNetwork(network));
    }
    async #updateNetwork(network, networkId) {
        await this.initialLoadPromise;
        if (!Object.keys(network).length)
            return;
        const networkData = this.networks.find((n) => n.id === networkId);
        const changedNetwork = Object.keys(network).reduce((acc, key) => {
            if (!networkData)
                return acc;
            // No need to save unchanged networks. Here we filter the networks that are the same as the ones in the storage.
            if (network[key] === networkData[key])
                return acc;
            return { ...acc, [key]: network[key] };
        }, {});
        // Update the networks with the incoming new values
        this.#networks[networkId] = { ...this.#networks[networkId], ...changedNetwork };
        // if force4337 is updated, we have to update the enabled flag as well
        if ('force4337' in changedNetwork) {
            this.#networks[networkId].erc4337.enabled = (0, networks_2.is4337Enabled)(true, this.#networks[networkId], changedNetwork.force4337);
        }
        this.#onAddOrUpdateNetwork(this.#networks[networkId]);
        await this.#storage.set('networks', this.#networks);
        const checkRPC = async (networkToAddOrUpdate) => {
            if (changedNetwork.selectedRpcUrl) {
                if (networkToAddOrUpdate?.info &&
                    Object.values(networkToAddOrUpdate.info).every((prop) => prop !== 'LOADING')) {
                    const info = { ...networkToAddOrUpdate.info };
                    const { feeOptions } = info;
                    // eslint-disable-next-line no-param-reassign
                    delete info.feeOptions;
                    this.#networks[networkId] = {
                        ...this.#networks[networkId],
                        ...info,
                        ...feeOptions
                    };
                    await this.#storage.set('networks', this.#networks);
                    this.emitUpdate();
                    return;
                }
                // eslint-disable-next-line @typescript-eslint/no-floating-promises
                (0, networks_2.getNetworkInfo)(this.#fetch, changedNetwork.selectedRpcUrl, this.#networks[networkId].chainId, async (info) => {
                    if (Object.values(info).some((prop) => prop === 'LOADING')) {
                        return;
                    }
                    const { feeOptions } = info;
                    // eslint-disable-next-line no-param-reassign
                    delete info.feeOptions;
                    this.#networks[networkId] = {
                        ...this.#networks[networkId],
                        ...info,
                        ...feeOptions
                    };
                    await this.#storage.set('networks', this.#networks);
                    this.emitUpdate();
                });
            }
        };
        // Do not wait the rpc validation in order to complete the execution of updateNetwork
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        checkRPC(this.networkToAddOrUpdate);
        this.networkToAddOrUpdate = null;
        this.emitUpdate();
    }
    async updateNetwork(network, networkId) {
        await this.withStatus('updateNetwork', () => this.#updateNetwork(network, networkId));
    }
    async removeNetwork(id) {
        await this.initialLoadPromise;
        if (!this.#networks[id])
            return;
        delete this.#networks[id];
        this.#onRemoveNetwork(id);
        await this.#storage.set('networks', this.#networks);
        this.emitUpdate();
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            isInitialized: this.isInitialized,
            networks: this.networks
        };
    }
}
exports.NetworksController = NetworksController;
//# sourceMappingURL=networks.js.map