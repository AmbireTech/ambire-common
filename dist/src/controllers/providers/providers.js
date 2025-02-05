"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProvidersController = void 0;
const tslib_1 = require("tslib");
const provider_1 = require("../../services/provider");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
/**
 * The ProvidersController manages RPC providers, enabling the extension to communicate with the blockchain.
 * Each network requires an initialized JsonRpcProvider, and the provider must be reinitialized whenever network.selectedRpcUrl changes.
 */
class ProvidersController extends eventEmitter_1.default {
    #networks;
    providers = {};
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    constructor(networks) {
        super();
        this.#networks = networks;
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.initialLoadPromise = this.#load();
    }
    get isInitialized() {
        return this.#networks.isInitialized && !!Object.keys(this.providers).length;
    }
    async #load() {
        await this.#networks.initialLoadPromise;
        this.#networks.networks.forEach((n) => this.setProvider(n));
        this.emitUpdate();
    }
    setProvider(network) {
        const provider = this.providers[network.id];
        // Only update the RPC if the new RPC is different from the current one or if there is no RPC for this network yet.
        if (!provider || provider?._getConnection().url !== network.selectedRpcUrl) {
            const oldRPC = this.providers[network.id];
            // If an RPC fails once it will try to reconnect every second. If we don't destroy the old RPC it will keep trying to reconnect forever.
            if (oldRPC)
                oldRPC.destroy();
            this.providers[network.id] = (0, provider_1.getRpcProvider)(network.rpcUrls, network.chainId, network.selectedRpcUrl);
        }
    }
    updateProviderIsWorking(networkId, isWorking) {
        if (!this.providers[networkId])
            return;
        if (this.providers[networkId].isWorking === isWorking)
            return;
        this.providers[networkId].isWorking = isWorking;
        this.emitUpdate();
    }
    removeProvider(networkId) {
        if (!this.providers[networkId])
            return;
        this.providers[networkId]?.destroy();
        delete this.providers[networkId];
        this.emitUpdate();
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            isInitialized: this.isInitialized
        };
    }
}
exports.ProvidersController = ProvidersController;
//# sourceMappingURL=providers.js.map