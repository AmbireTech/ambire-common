import { Contract } from 'ethers';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { Network } from '../../interfaces/network';
import { IProvidersController, RPCProvider, RPCProviders } from '../../interfaces/provider';
import { IStorageController } from '../../interfaces/storage';
import type { BalanceChangesReceipt } from '../../libs/accountOp/balanceChanges';
import { TokenResult } from '../../libs/portfolio';
import EventEmitter from '../eventEmitter/eventEmitter';
declare const STATUS_WRAPPED_METHODS: {
    readonly toggleBatching: "INITIAL";
};
/**
 * The ProvidersController manages RPC providers, enabling the extension to communicate with the blockchain.
 * Each network requires an initialized JsonRpcProvider, and the provider must be reinitialized whenever network.selectedRpcUrl changes.
 */
export declare class ProvidersController extends EventEmitter implements IProvidersController {
    #private;
    initialLoadPromise?: Promise<void>;
    isBatchingEnabled: boolean;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    constructor({ storage, getNetworks, sendUiMessage, eventEmitterRegistry }: {
        storage: IStorageController;
        getNetworks: () => Network[];
        sendUiMessage: (params: {}) => void;
        eventEmitterRegistry?: IEventEmitterRegistryController;
    });
    get providers(): RPCProviders;
    init({ networks }: {
        networks: Network[];
    }): Promise<void>;
    setProvider(network: Network, opts?: {
        forceUpdate: boolean;
    }): void;
    updateProviderIsWorking(chainId: bigint, isWorking: boolean): void;
    removeProvider(chainId: bigint): void;
    toggleBatching(): Promise<void>;
    useTempProvider({ rpcUrl, chainId }: {
        rpcUrl: string;
        chainId: bigint;
    }, callback: (provider: RPCProvider) => Promise<void>): Promise<void>;
    callProviderAndSendResToUi({ chainId, method, args }: {
        chainId: bigint;
        method: keyof RPCProvider;
        args: unknown[];
    }, requestId: string): Promise<void>;
    callContractAndSendResToUi({ chainId, address, abi, method, args }: {
        chainId: bigint;
        address: string;
        abi: string;
        method: keyof Contract;
        args: unknown[];
    }, requestId: string): Promise<void>;
    /**
     * Use this to communicate balanche changes for a transaction
     * to the external benzin
     */
    getTokenBalancesOnBlockAndSendResToUi({ accountId, chainId, tokenAddrs, blockTag, accountAddr, receipts }: {
        accountId: string;
        chainId: bigint;
        tokenAddrs: string[];
        blockTag: number;
        accountAddr?: string;
        receipts?: BalanceChangesReceipt[];
    }, requestId: string): Promise<void>;
    /**
     * Resolves symbol and decimals for tokens or name for nfts.
     */
    resolveAssetInfo(address: string, network: Network, callback: (arg: {
        tokenInfo?: TokenResult;
        nftInfo?: {
            name: string;
        };
    }) => void): Promise<void>;
    resolveAssetInfoAndSendResToUi({ requestId, address, network }: {
        requestId: string;
        address: string;
        network: Network;
    }): Promise<void>;
    toJSON(): this & {
        providers: RPCProviders;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=providers.d.ts.map