import { Hex } from '../interfaces/hex';
import { PrivacyPoolsAsset, PrivacyPoolsChainConfig } from '../interfaces/privacyPools';
/**
 * The SDK's native ETH sentinel. Native travels as `{ __type: 'erc20', contract: E_ADDRESS }`,
 * since `prepareUnshield` refuses the `native` asset kind. Never leaves the controller - see
 * `fromPrivacyPoolsAssetAddress`.
 */
export declare const PRIVACY_POOLS_NATIVE_ASSET_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
/**
 * Fixed so a phrase alone recovers its notes, at the cost of one identity per phrase. Never infer
 * another index: a wrong one points the wallet at an empty set of notes.
 */
export declare const PRIVACY_POOLS_ACCOUNT_INDEX = 0;
/**
 * The one key Privacy Pools needs per phrase, from the SDK's `SignatureSecretManager`: every note's
 * nullifier, salt and paymaster withdrawal signer are derived from this key's EIP-712 signature of
 * the note, `PrivacyPoolNote(depositIndex, secretIndex)`.
 *
 * Security boundary: `KeystoreController.derivePrivacyPoolsKey` refuses any other path, since the
 * plugin asks for arbitrary paths and could otherwise reach the user's EVM keys.
 */
export declare const PRIVACY_POOLS_SIGNING_KEY_PATH = "m/28784'/1'/0'";
/**
 * fatlabs' CDN of the entrypoint's and the pools' event history as signed, content-addressed
 * files, against thousands of `eth_getLogs` calls: a chain's first read takes about 18 s. Only
 * Ethereum is published. Every file is checked against the signed manifest before use.
 */
export declare const PRIVACY_POOLS_SAGA_SYNC_URL = "https://saga.fatsolutions.xyz";
/**
 * Ethereum only: Sepolia has no paymaster, so nothing could be withdrawn there. Other chains
 * (Optimism, BSC, Arbitrum) use a different entrypoint, so adding them takes more than an entry.
 */
export declare const PRIVACY_POOLS_CHAINS: {
    [chainId: string]: PrivacyPoolsChainConfig;
};
export declare const PRIVACY_POOLS_SUPPORTED_CHAIN_IDS: bigint[];
/**
 * The bundler for withdrawals. Always Pimlico, as the SDK prices the userOp with
 * `pimlico_getUserOperationGasPrice`. Throws without our key, like the wallet's Pimlico bundler.
 */
export declare const getPrivacyPoolsBundlerUrl: (chainId: bigint) => string;
/**
 * Circuit artifact paths, relative to the same-origin base the host supplies (see the extension's
 * webpack copy step). Why not the SDK's default: see `createProverFactory`.
 */
export declare const PRIVACY_POOLS_CIRCUIT_PATHS: {
    readonly withdraw: {
        readonly wasm: "withdraw.wasm";
        readonly vkey: "withdraw.vkey";
        readonly zkey: "withdraw.zkey";
    };
    readonly commitment: {
        readonly wasm: "commitment.wasm";
        readonly vkey: "commitment.vkey";
        readonly zkey: "commitment.zkey";
    };
};
/** Storage key holding the wallet's Privacy Pools accounts. */
export declare const PRIVACY_POOLS_ACCOUNTS_STORAGE_KEY = "privacyPoolsAccounts";
export declare const getPrivacyPoolsChainConfig: (chainId: bigint) => PrivacyPoolsChainConfig | undefined;
/**
 * The plugin's storage key for a chain's history, mirrored as the SDK does not export it. Needed
 * before a plugin exists: to seed its starting state and tell whether the chain has history yet.
 */
export declare const getPrivacyPoolsStoreKey: ({ chainId, entrypointAddress }: PrivacyPoolsChainConfig) => string;
/** Whether the address is the wallet's native token address (`ZERO_ADDRESS`). */
export declare const isPrivacyPoolsNativeAsset: (address: string) => boolean;
/**
 * Identifies a token of the Send form. Includes the chain, as the same token on two chains has
 * different pools and must not collide.
 */
export declare const getPrivacyPoolsTokenId: (chainId: string, tokenAddress: string) => string;
/** Looks up a configured asset (see `PrivacyPoolsAsset`) by the wallet's address for it. */
export declare const getPrivacyPoolsAsset: (chainId: bigint, address: string) => PrivacyPoolsAsset | undefined;
/** The asset, if it can be deposited - see `PrivacyPoolsAsset.isWithdrawable`. */
export declare const getPrivacyPoolsDepositAsset: (chainId: bigint, address: string) => PrivacyPoolsAsset | undefined;
/** Translates an address into the sentinel the SDK expects for native. */
export declare const toPrivacyPoolsAssetAddress: (address: string) => Hex;
/** Translates an SDK address (often a bigint) into the wallet's convention for native. */
export declare const fromPrivacyPoolsAssetAddress: (address: bigint | string) => Hex;
//# sourceMappingURL=privacyPools.d.ts.map