import { Fetch } from '../../interfaces/fetch';
import { AddNetworkRequestParams, ChainId, Network, NetworkInfo, NetworkInfoLoading } from '../../interfaces/network';
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter';
import { StorageController } from '../storage/storage';
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
    constructor(storage: StorageController, fetch: Fetch, relayerUrl: string, onAddOrUpdateNetwork: (network: Network) => void, onRemoveNetwork: (chainId: bigint) => void);
    get isInitialized(): boolean;
    get allNetworks(): Network[];
    get networks(): Network[];
    get disabledNetworks(): Network[];
    /**
     * Processes network updates, finalizes changes, and updates network features asynchronously.
     * Used for periodically network synchronization.
     */
    synchronizeNetworks(): Promise<void>;
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
    mergeRelayerNetworks(finalNetworks: {
        [key: string]: Network;
    }, networksInStorage: {
        [key: string]: Network;
    }): Promise<{
        [key: string]: Network;
    }>;
    setNetworkToAddOrUpdate(networkToAddOrUpdate?: {
        chainId: Network['chainId'];
        rpcUrl: string;
    } | null): Promise<void>;
    addNetwork(network: AddNetworkRequestParams): Promise<void>;
    updateNetwork(network: Partial<Network>, chainId: ChainId): Promise<void>;
    /**
     * @deprecated - users can no longer remove networks from the UI
     */
    removeNetwork(chainId: ChainId): Promise<void>;
    toJSON(): this & {
        isInitialized: boolean;
        networks: Network[];
        disabledNetworks: Network[];
        allNetworks: Network[];
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=networks.d.ts.map