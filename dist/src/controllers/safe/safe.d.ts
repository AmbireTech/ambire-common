import { SafeMessage } from '@safe-global/api-kit';
import { SafeMultisigConfirmationResponse } from '@safe-global/types-kit';
import { IAccountsController, SafeAccountCreation } from '../../interfaces/account';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { Hex } from '../../interfaces/hex';
import { INetworksController } from '../../interfaces/network';
import { IProvidersController } from '../../interfaces/provider';
import { ISafeController } from '../../interfaces/safe';
import { IStorageController } from '../../interfaces/storage';
import { ExtendedSafeMessage, SafeResults } from '../../libs/safe/safe';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare const STATUS_WRAPPED_METHODS: {
    readonly findSafe: "INITIAL";
};
export declare class SafeController extends EventEmitter implements ISafeController {
    #private;
    initialLoadPromise?: Promise<void>;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    importError?: {
        message: string;
        address: string;
    };
    safeInfo?: SafeAccountCreation & {
        deployedOn: bigint[];
        version: string;
        address: Hex;
        owners: Hex[];
        requiresModules: boolean;
    };
    constructor({ eventEmitterRegistry, networks, providers, storage, accounts }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        networks: INetworksController;
        providers: IProvidersController;
        storage: IStorageController;
        accounts: IAccountsController;
    });
    findSafe(safeAddr: string): Promise<void>;
    resetFind(): Promise<void>;
    getMessageId(msg: SafeMessage): string;
    shouldSkipFetchPending(safeAddr: string): boolean;
    fetchPending(safeAddr: Hex, networks: {
        chainId: bigint;
        threshold: number;
    }[]): Promise<SafeResults | null>;
    fetchExecuted(txns: {
        chainId: bigint;
        safeTxnHash: Hex;
    }[]): Promise<{
        safeTxnHash: Hex;
        nonce: string;
        transactionHash?: Hex;
        confirmations?: SafeMultisigConfirmationResponse[];
    }[]>;
    rejectTxnId(safeTxnIds: string[]): Promise<void>;
    resolveTxnId(resolves: {
        txnIds: string[];
        nonce: bigint;
    }[]): Promise<void>;
    /**
     * Upon failure, unresolve all Safe txns with the same nonce
     */
    unresolve(nonce: bigint): Promise<void>;
    getMessagesByHash(data: {
        chainId: bigint;
        threshold: number;
        messageHash: Hex;
    }[]): Promise<ExtendedSafeMessage[]>;
    toJSON(): this & {
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=safe.d.ts.map