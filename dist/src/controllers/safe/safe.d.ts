import { IAccountsController, SafeAccountCreation } from '../../interfaces/account';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { Hex } from '../../interfaces/hex';
import { IKeystoreController } from '../../interfaces/keystore';
import { INetworksController } from '../../interfaces/network';
import { IProvidersController } from '../../interfaces/provider';
import { ISafeController, SafeAccountByOwner } from '../../interfaces/safe';
import { IStorageController } from '../../interfaces/storage';
import { ExtendedSafeMessage, SafeResults } from '../../libs/safe/safe';
import EventEmitter from '../eventEmitter/eventEmitter';
import type { SafeMessage } from '@safe-global/api-kit';
import type { SafeMultisigConfirmationResponse } from '@safe-global/types-kit';
export declare const STATUS_WRAPPED_METHODS: {
    readonly findSafe: "INITIAL";
};
type SafeOwnerSearch = {
    owner: Hex;
    accounts: SafeAccountByOwner[];
    searchedNetworks: bigint[];
    failedNetworks: bigint[];
    updatedAt: number;
    status: 'LOADING' | 'DONE';
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
        address: Hex;
        owners: Hex[];
        requiresModules: boolean;
    };
    ownerCurrentlyDisplayingFor?: Hex;
    safeOwnerSearches: Record<Hex, SafeOwnerSearch>;
    /**
     * How many txns and messages wait for more owners' signatures, per Safe and chain id. Kept
     * for all of the user's Safes, so the ones that are not selected have a pending count
     * without a signing request being built for each of their txns.
     */
    pendingCountBySafe: Record<string, Record<string, number>>;
    constructor({ eventEmitterRegistry, networks, providers, storage, accounts, keystore }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        networks: INetworksController;
        providers: IProvidersController;
        storage: IStorageController;
        accounts: IAccountsController;
        keystore: IKeystoreController;
    });
    findSafe(safeAddr: string): Promise<void>;
    resetFind(): Promise<void>;
    resetSearchByOwner(): void;
    findSafesByOwner(ownerAddress: string): Promise<void>;
    getMessageId(msg: SafeMessage): string;
    shouldSkipFetchPending(safeAddr: string, maxAge?: number): boolean;
    fetchPending(safeAddr: Hex, networks: {
        chainId: bigint;
        threshold: number;
    }[]): Promise<SafeResults | null>;
    /**
     * Refreshes the pending counts of the user's Safes other than the selected one, whose
     * pending txns `MainController.fetchSafeTxns` turns into requests instead. A Safe is
     * skipped while its counts are younger than `FETCH_OTHER_SAFES_PENDING`, and until at least
     * one of its owners is imported, as without one the user cannot sign what is pending. The
     * counts of a Safe whose owners were all removed are cleared.
     */
    updateOtherSafesPendingCounts(selectedAccountAddr?: string): Promise<void>;
    fetchExecuted(safeAddr: Hex, chains: {
        chainId: bigint;
        minNonce: number;
    }[]): Promise<{
        safeTxnHash: Hex;
        nonce: string;
        transactionHash?: Hex;
        confirmations?: SafeMultisigConfirmationResponse[];
    }[]>;
    rejectTxnId(safeTxnIds: string[]): Promise<void>;
    restoreTxnId(safeTxnIds: string[]): Promise<void>;
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
export {};
//# sourceMappingURL=safe.d.ts.map