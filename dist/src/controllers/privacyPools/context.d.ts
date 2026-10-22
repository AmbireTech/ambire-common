import { JsonRpcProvider } from 'ethers';
import type { Storage } from '@kohaku-eth/plugins';
import { ErrorRef } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Fetch } from '../../interfaces/fetch';
import { IKeystoreController } from '../../interfaces/keystore';
import { INetworksController } from '../../interfaces/network';
import { PrivacyPoolsChainConfig } from '../../interfaces/privacyPools';
import { IProvidersController } from '../../interfaces/provider';
/** Bumped on every lock, so a sync that cannot be aborted does not write back wiped notes. */
export declare class LockGeneration {
    #private;
    get current(): number;
    bump(): void;
    isCurrent(generation: number): boolean;
}
/**
 * What every Privacy Pools module gets from `PrivacyPoolsController` - never the controller itself.
 * The controller stays the only `EventEmitter`, so updates and errors keep a single path to the UI.
 */
export type PrivacyPoolsContext = {
    keystore: IKeystoreController;
    featureFlags: IFeatureFlagsController;
    networks: INetworksController;
    providers: IProvidersController;
    fetch: Fetch;
    /**
     * Shared by all plugins: the adapter caches the whole blob and rewrites it on every save, so
     * per-plugin adapters (two phrases) would overwrite each other's progress.
     */
    kohakuStorage: Storage;
    lock: LockGeneration;
    hasAccount: (seedId: string) => boolean;
    /** USD price of a pool's asset, or null when unknown - see `PrivacyPoolsController.prices`. */
    getTokenPrice: (chainId: string, tokenAddress: string) => number | null;
    /**
     * Called by a module where its own flow changes what the UI shows. What the controller calls
     * from a subscription, or together with other changes, does not emit - at most it returns
     * whether it changed anything - and the controller emits once.
     */
    emitUpdate: () => void;
    emitError: (error: ErrorRef) => void;
};
/**
 * A module holding state derived from a recovery phrase, none of which may outlive a lock or the
 * phrase's account: `PrivacyPoolsController` clears every module on lock and forgets a removed
 * account in each.
 */
export interface PhraseScopedModule {
    hasPhraseDerivedState(): boolean;
    forgetSeed(seedId: string): void;
    clear(): void;
}
/**
 * A token by its wallet address - `ZERO_ADDRESS` for native. Nativeness is derived from it, not
 * passed alongside, so the two can never disagree.
 */
export type AssetRef = {
    tokenAddress: string;
};
/** The Privacy Pools deployment on a chain. Throws on a chain without one. */
export declare const getChainConfig: (chainId: string) => PrivacyPoolsChainConfig;
/** The chain's provider from `ProvidersController`. Throws on a chain without one. */
export declare const getChainProvider: (providers: IProvidersController, chainId: string) => JsonRpcProvider;
//# sourceMappingURL=context.d.ts.map