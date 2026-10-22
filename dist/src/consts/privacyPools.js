"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fromPrivacyPoolsAssetAddress = exports.toPrivacyPoolsAssetAddress = exports.getPrivacyPoolsDepositAsset = exports.getPrivacyPoolsAsset = exports.getPrivacyPoolsTokenId = exports.isPrivacyPoolsNativeAsset = exports.getPrivacyPoolsStoreKey = exports.getPrivacyPoolsChainConfig = exports.PRIVACY_POOLS_ACCOUNTS_STORAGE_KEY = exports.PRIVACY_POOLS_CIRCUIT_PATHS = exports.getPrivacyPoolsBundlerUrl = exports.PRIVACY_POOLS_SUPPORTED_CHAIN_IDS = exports.PRIVACY_POOLS_CHAINS = exports.PRIVACY_POOLS_SAGA_SYNC_URL = exports.PRIVACY_POOLS_SIGNING_KEY_PATH = exports.PRIVACY_POOLS_ACCOUNT_INDEX = exports.PRIVACY_POOLS_NATIVE_ASSET_ADDRESS = void 0;
const constants_1 = require("../services/socket/constants");
/**
 * The SDK's native ETH sentinel. Native travels as `{ __type: 'erc20', contract: E_ADDRESS }`,
 * since `prepareUnshield` refuses the `native` asset kind. Never leaves the controller - see
 * `fromPrivacyPoolsAssetAddress`.
 */
exports.PRIVACY_POOLS_NATIVE_ASSET_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
/**
 * Fixed so a phrase alone recovers its notes, at the cost of one identity per phrase. Never infer
 * another index: a wrong one points the wallet at an empty set of notes.
 */
exports.PRIVACY_POOLS_ACCOUNT_INDEX = 0;
/**
 * The one key Privacy Pools needs per phrase, from the SDK's `SignatureSecretManager`: every note's
 * nullifier, salt and paymaster withdrawal signer are derived from this key's EIP-712 signature of
 * the note, `PrivacyPoolNote(depositIndex, secretIndex)`.
 *
 * Security boundary: `KeystoreController.derivePrivacyPoolsKey` refuses any other path, since the
 * plugin asks for arbitrary paths and could otherwise reach the user's EVM keys.
 */
exports.PRIVACY_POOLS_SIGNING_KEY_PATH = `m/28784'/1'/${exports.PRIVACY_POOLS_ACCOUNT_INDEX}'`;
/**
 * fatlabs' CDN of the entrypoint's and the pools' event history as signed, content-addressed
 * files, against thousands of `eth_getLogs` calls: a chain's first read takes about 18 s. Only
 * Ethereum is published. Every file is checked against the signed manifest before use.
 */
exports.PRIVACY_POOLS_SAGA_SYNC_URL = 'https://saga.fatsolutions.xyz';
/**
 * Ethereum only: Sepolia has no paymaster, so nothing could be withdrawn there. Other chains
 * (Optimism, BSC, Arbitrum) use a different entrypoint, so adding them takes more than an entry.
 */
exports.PRIVACY_POOLS_CHAINS = {
    '1': {
        chainId: 1n,
        entrypointAddress: '0x6818809EefCe719E480a7526D76bD3e561526b46',
        deploymentBlock: 22153713n,
        aspUrl: 'https://api.0xbow.io',
        sagaSyncUrl: exports.PRIVACY_POOLS_SAGA_SYNC_URL,
        paymaster: {
            entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
            paymasterAddress: '0xe06CB96C57D2442f8F60F5017354BC08F7e91308',
            poolAdapters: {
                // ETH pool -> privacypools_simple_eth adapter
                '0xf241d57c6debae225c0f2e6ea1529373c9a9c9fb': '0x521F578Ac6E894939364Dc27c7e6978Ecf7b7926',
                // USDT pool -> privacypools_complex_usdt_100 adapter
                '0xe859c0bd25f260baee534fb52e307d3b64d24572': '0x3B33c5cb645690E6b7Df599F58CADA8fA189C36F',
                // USDC pool -> privacypools_complex_usdc_100 adapter
                '0xb419c2867ab3cbc78921660cb95150d95a94ce86': '0x841E8F12FDbB2c55c9E054B4c6d07c2743E09cFC'
            }
        },
        assets: [
            {
                address: constants_1.ZERO_ADDRESS,
                symbol: 'ETH',
                decimals: 18,
                isNative: true,
                maxDeposit: 10000n * 10n ** 18n,
                isWithdrawable: true
            },
            {
                address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                symbol: 'USDC',
                decimals: 6,
                isNative: false,
                maxDeposit: 1000000n * 10n ** 6n,
                isWithdrawable: true
            },
            {
                address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
                symbol: 'USDT',
                decimals: 6,
                isNative: false,
                maxDeposit: 1000000n * 10n ** 6n,
                isWithdrawable: true
            },
            {
                address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
                symbol: 'DAI',
                decimals: 18,
                isNative: false,
                maxDeposit: 1000000n * 10n ** 18n,
                isWithdrawable: false
            },
            {
                address: '0xdC035D45d973E3EC169d2276DDab16f1e407384F',
                symbol: 'USDS',
                decimals: 18,
                isNative: false,
                maxDeposit: 1000000n * 10n ** 18n,
                isWithdrawable: false
            },
            {
                address: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
                symbol: 'sUSDS',
                decimals: 18,
                isNative: false,
                maxDeposit: 1000000n * 10n ** 18n,
                isWithdrawable: false
            },
            {
                address: '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3',
                symbol: 'USDe',
                decimals: 18,
                isNative: false,
                maxDeposit: 1000000n * 10n ** 18n,
                isWithdrawable: false
            },
            {
                address: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d',
                symbol: 'USD1',
                decimals: 18,
                isNative: false,
                maxDeposit: 1000000n * 10n ** 18n,
                isWithdrawable: false
            },
            {
                address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
                symbol: 'wstETH',
                decimals: 18,
                isNative: false,
                maxDeposit: 100000n * 10n ** 18n,
                isWithdrawable: false
            },
            {
                address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
                symbol: 'wBTC',
                decimals: 8,
                isNative: false,
                maxDeposit: 100n * 10n ** 8n,
                isWithdrawable: false
            }
        ]
    }
};
exports.PRIVACY_POOLS_SUPPORTED_CHAIN_IDS = Object.values(exports.PRIVACY_POOLS_CHAINS).map(({ chainId }) => chainId);
/**
 * The bundler for withdrawals. Always Pimlico, as the SDK prices the userOp with
 * `pimlico_getUserOperationGasPrice`. Throws without our key, like the wallet's Pimlico bundler.
 */
const getPrivacyPoolsBundlerUrl = (chainId) => {
    const apiKey = process.env.REACT_APP_PIMLICO_API_KEY;
    if (!apiKey)
        throw new Error('Pimlico API key is not set');
    return `https://api.pimlico.io/v2/${chainId.toString()}/rpc?apikey=${apiKey}`;
};
exports.getPrivacyPoolsBundlerUrl = getPrivacyPoolsBundlerUrl;
/**
 * Circuit artifact paths, relative to the same-origin base the host supplies (see the extension's
 * webpack copy step). Why not the SDK's default: see `createProverFactory`.
 */
exports.PRIVACY_POOLS_CIRCUIT_PATHS = {
    withdraw: {
        wasm: 'withdraw.wasm',
        vkey: 'withdraw.vkey',
        zkey: 'withdraw.zkey'
    },
    commitment: {
        wasm: 'commitment.wasm',
        vkey: 'commitment.vkey',
        zkey: 'commitment.zkey'
    }
};
/** Storage key holding the wallet's Privacy Pools accounts. */
exports.PRIVACY_POOLS_ACCOUNTS_STORAGE_KEY = 'privacyPoolsAccounts';
const getPrivacyPoolsChainConfig = (chainId) => exports.PRIVACY_POOLS_CHAINS[chainId.toString()];
exports.getPrivacyPoolsChainConfig = getPrivacyPoolsChainConfig;
/**
 * The plugin's storage key for a chain's history, mirrored as the SDK does not export it. Needed
 * before a plugin exists: to seed its starting state and tell whether the chain has history yet.
 */
const getPrivacyPoolsStoreKey = ({ chainId, entrypointAddress }) => `privacy-pool-state-${chainId.toString()}-${BigInt(entrypointAddress).toString()}`;
exports.getPrivacyPoolsStoreKey = getPrivacyPoolsStoreKey;
/** Whether the address is the wallet's native token address (`ZERO_ADDRESS`). */
const isPrivacyPoolsNativeAsset = (address) => address.toLowerCase() === constants_1.ZERO_ADDRESS;
exports.isPrivacyPoolsNativeAsset = isPrivacyPoolsNativeAsset;
/**
 * Identifies a token of the Send form. Includes the chain, as the same token on two chains has
 * different pools and must not collide.
 */
const getPrivacyPoolsTokenId = (chainId, tokenAddress) => `${chainId}:${tokenAddress.toLowerCase()}`;
exports.getPrivacyPoolsTokenId = getPrivacyPoolsTokenId;
/** Looks up a configured asset (see `PrivacyPoolsAsset`) by the wallet's address for it. */
const getPrivacyPoolsAsset = (chainId, address) => (0, exports.getPrivacyPoolsChainConfig)(chainId)?.assets.find((asset) => asset.address.toLowerCase() === address.toLowerCase());
exports.getPrivacyPoolsAsset = getPrivacyPoolsAsset;
/** The asset, if it can be deposited - see `PrivacyPoolsAsset.isWithdrawable`. */
const getPrivacyPoolsDepositAsset = (chainId, address) => {
    const asset = (0, exports.getPrivacyPoolsAsset)(chainId, address);
    return asset?.isWithdrawable ? asset : undefined;
};
exports.getPrivacyPoolsDepositAsset = getPrivacyPoolsDepositAsset;
/** Translates an address into the sentinel the SDK expects for native. */
const toPrivacyPoolsAssetAddress = (address) => ((0, exports.isPrivacyPoolsNativeAsset)(address)
    ? exports.PRIVACY_POOLS_NATIVE_ASSET_ADDRESS
    : address.toLowerCase());
exports.toPrivacyPoolsAssetAddress = toPrivacyPoolsAssetAddress;
/** Translates an SDK address (often a bigint) into the wallet's convention for native. */
const fromPrivacyPoolsAssetAddress = (address) => {
    const hex = typeof address === 'bigint'
        ? `0x${address.toString(16).padStart(40, '0')}`
        : address.toLowerCase();
    return (hex.toLowerCase() === exports.PRIVACY_POOLS_NATIVE_ASSET_ADDRESS ? constants_1.ZERO_ADDRESS : hex);
};
exports.fromPrivacyPoolsAssetAddress = fromPrivacyPoolsAssetAddress;
//# sourceMappingURL=privacyPools.js.map