import { JsonRpcProvider } from 'ethers';
import type { Keystore, Network, Storage } from '@kohaku-eth/plugins';
import type { EthereumProvider } from '@kohaku-eth/provider';
import { Fetch } from '../../interfaces/fetch';
import { Hex } from '../../interfaces/hex';
import { IStorageController } from '../../interfaces/storage';
/**
 * Adapters for the `Host` every `@kohaku-eth/*` plugin binds against. Keep them protocol-agnostic;
 * protocol-specific code belongs in that protocol's lib.
 */
/**
 * Backs a plugin's key-value storage with one cached blob in the wallet's store, since
 * `StorageProps` is a closed map and plugins invent keys at runtime.
 *
 * Writes are awaited, not debounced: Privacy Pools persists once per sync, and a lost write would
 * cost a full rescan.
 */
export declare const createKohakuStorage: ({ storage, storageKey, onError }: {
    storage: IStorageController;
    /** Which `StorageProps` entry holds this plugin's blob. */
    storageKey: "privacyPoolsState";
    onError: (error: unknown, message?: string) => void;
}) => Storage;
/**
 * Derives plugin keys without giving the plugin the recovery phrase, unlike the SDK's
 * `MnemonicKeystore`. `deriveKey` must whitelist its paths - see
 * `KeystoreController.derivePrivacyPoolsKey`.
 *
 * Cached because the SDK asks for its signing key on every note it signs, and each derivation is a
 * pbkdf2 over the seed. Cached as a promise, so chains syncing at once share one derivation, and
 * dropped on failure, so the next call retries. Dropped with the instance, so a lock or seed
 * change clears it.
 */
export declare const createKohakuKeystore: (deriveKey: (path: string) => Promise<Hex>) => Keystore;
/** Gives plugins the app's own fetch, so platform wiring and interception stay in one place. */
export declare const createKohakuNetwork: (fetch: Fetch) => Network;
/**
 * Adapts an ethers `JsonRpcProvider` to the plugins' `EthereumProvider`. Reimplements
 * `@kohaku-eth/provider/ethers`, which the app's `moduleResolution: "node"` cannot resolve.
 */
export declare const createKohakuProvider: (provider: JsonRpcProvider) => EthereumProvider<JsonRpcProvider>;
//# sourceMappingURL=host.d.ts.map