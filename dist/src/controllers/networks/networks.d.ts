import { Fetch } from '../../interfaces/fetch';
import { AddNetworkRequestParams, Network, NetworkId, NetworkInfo, NetworkInfoLoading } from '../../interfaces/network';
import { Storage } from '../../interfaces/storage';
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter';
declare const STATUS_WRAPPED_METHODS: {
    readonly addNetwork: "INITIAL";
    readonly updateNetwork: "INITIAL";
};
/**
 * The NetworksController is responsible for managing networks. It handles both predefined networks and those
 * that users can add either through a dApp request or manually via the UI. This controller provides functions
 * for adding, updating, and removing networks.
 */
export declare class NetworksController extends EventEmitter {
    #private;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    networkToAddOrUpdate: {
        chainId: Network['chainId'];
        rpcUrl: string;
        info?: NetworkInfoLoading<NetworkInfo>;
    } | null;
    initialLoadPromise: Promise<void>;
    constructor(storage: Storage, fetch: Fetch, onAddOrUpdateNetwork: (network: Network) => void, onRemoveNetwork: (id: NetworkId) => void);
    get isInitialized(): boolean;
    get networks(): Network[];
    setNetworkToAddOrUpdate(networkToAddOrUpdate?: {
        chainId: Network['chainId'];
        rpcUrl: string;
        force4337?: boolean;
    } | null): Promise<void>;
    addNetwork(network: AddNetworkRequestParams): Promise<void>;
    updateNetwork(network: Partial<Network>, networkId: NetworkId): Promise<void>;
    removeNetwork(id: NetworkId): Promise<void>;
    toJSON(): this & {
        isInitialized: boolean;
        networks: Network[];
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=networks.d.ts.map