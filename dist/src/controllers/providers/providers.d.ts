import { Network, NetworkId } from '../../interfaces/network';
import { RPCProviders } from '../../interfaces/provider';
import EventEmitter from '../eventEmitter/eventEmitter';
import { NetworksController } from '../networks/networks';
/**
 * The ProvidersController manages RPC providers, enabling the extension to communicate with the blockchain.
 * Each network requires an initialized JsonRpcProvider, and the provider must be reinitialized whenever network.selectedRpcUrl changes.
 */
export declare class ProvidersController extends EventEmitter {
    #private;
    providers: RPCProviders;
    initialLoadPromise: Promise<void>;
    constructor(networks: NetworksController);
    get isInitialized(): boolean;
    setProvider(network: Network): void;
    updateProviderIsWorking(networkId: NetworkId, isWorking: boolean): void;
    removeProvider(networkId: NetworkId): void;
    toJSON(): this & {
        isInitialized: boolean;
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=providers.d.ts.map