import { Hex } from '../interfaces/hex'
import { PrivacyPoolsAsset, PrivacyPoolsChainConfig } from '../interfaces/privacyPools'
import { ZERO_ADDRESS } from '../services/socket/constants'

/**
 * The SDK's native ETH sentinel. Native travels as `{ __type: 'erc20', contract: E_ADDRESS }`,
 * since `prepareUnshield` refuses the `native` asset kind. Never leaves the controller - see
 * `fromPrivacyPoolsAssetAddress`.
 */
export const PRIVACY_POOLS_NATIVE_ASSET_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

/**
 * Privacy Pools' BIP-32 prefix, from the SDK's `SecretManager`:
 * `m/28784'/1'/<account>'/<salt|nullifier>'/<deposit>'/<secret>'`.
 *
 * Security boundary: `KeystoreController.derivePrivacyPoolsKey` refuses any path outside it, since
 * the unaudited plugin asks for arbitrary paths and could otherwise reach the user's EVM keys.
 */
export const PRIVACY_POOLS_DERIVATION_PATH_PREFIX = "m/28784'/1'/"

/**
 * Fixed so a phrase alone recovers its notes, at the cost of one identity per phrase. Never infer
 * another index: a wrong one points the wallet at an empty set of notes.
 */
export const PRIVACY_POOLS_ACCOUNT_INDEX = 0

/**
 * fatlabs' CDN of the pools' event history as signed, content-addressed files: one request and
 * about a second per pool, against thousands of `eth_getLogs` calls. Only Ethereum's pools are
 * published, not the entrypoint. Every file is checked against the signed manifest before use.
 */
export const PRIVACY_POOLS_SAGA_SYNC_URL = 'https://saga.fatsolutions.xyz'

/**
 * Ethereum only: Sepolia has no paymaster, so nothing could be withdrawn there. Other chains
 * (Optimism, BSC, Arbitrum) use a different entrypoint, so adding them takes more than an entry.
 */
export const PRIVACY_POOLS_CHAINS: { [chainId: string]: PrivacyPoolsChainConfig } = {
  '1': {
    chainId: 1n,
    entrypointAddress: '0x6818809EefCe719E480a7526D76bD3e561526b46',
    deploymentBlock: 22153713n,
    aspUrl: 'https://api.0xbow.io',
    sagaSyncUrl: PRIVACY_POOLS_SAGA_SYNC_URL,
    paymaster: {
      entryPointAddress: '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
      paymasterAddress: '0xe06CB96C57D2442f8F60F5017354BC08F7e91308',
      poolAdapters: {
        // ETH pool -> privacypools_simple_eth adapter
        '0xf241d57c6debae225c0f2e6ea1529373c9a9c9fb': '0x0a230D83f16209E2692494a0ae139aAD8C96bde9',
        // USDT pool -> privacypools_complex_usdt_100 adapter
        '0xe859c0bd25f260baee534fb52e307d3b64d24572': '0xFcA5515D05f372Db8E03Bcc6b1a96BF4aC006f33',
        // USDC pool -> privacypools_complex_usdc_100 adapter
        '0xb419c2867ab3cbc78921660cb95150d95a94ce86': '0x16B7d484c634985FbafaaaC6f3ee14e9eFDa4889'
      }
    },
    assets: [
      {
        address: ZERO_ADDRESS as Hex,
        symbol: 'ETH',
        decimals: 18,
        isNative: true,
        maxDeposit: 10_000n * 10n ** 18n,
        isWithdrawable: true
      },
      {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        decimals: 6,
        isNative: false,
        maxDeposit: 1_000_000n * 10n ** 6n,
        isWithdrawable: true
      },
      {
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        symbol: 'USDT',
        decimals: 6,
        isNative: false,
        maxDeposit: 1_000_000n * 10n ** 6n,
        isWithdrawable: true
      },
      {
        address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        symbol: 'DAI',
        decimals: 18,
        isNative: false,
        maxDeposit: 1_000_000n * 10n ** 18n,
        isWithdrawable: false
      },
      {
        address: '0xdC035D45d973E3EC169d2276DDab16f1e407384F',
        symbol: 'USDS',
        decimals: 18,
        isNative: false,
        maxDeposit: 1_000_000n * 10n ** 18n,
        isWithdrawable: false
      },
      {
        address: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
        symbol: 'sUSDS',
        decimals: 18,
        isNative: false,
        maxDeposit: 1_000_000n * 10n ** 18n,
        isWithdrawable: false
      },
      {
        address: '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3',
        symbol: 'USDe',
        decimals: 18,
        isNative: false,
        maxDeposit: 1_000_000n * 10n ** 18n,
        isWithdrawable: false
      },
      {
        address: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d',
        symbol: 'USD1',
        decimals: 18,
        isNative: false,
        maxDeposit: 1_000_000n * 10n ** 18n,
        isWithdrawable: false
      },
      {
        address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
        symbol: 'wstETH',
        decimals: 18,
        isNative: false,
        maxDeposit: 100_000n * 10n ** 18n,
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
}

export const PRIVACY_POOLS_SUPPORTED_CHAIN_IDS = Object.values(PRIVACY_POOLS_CHAINS).map(
  ({ chainId }) => chainId
)

/**
 * The bundler for withdrawals. Always Pimlico, as the SDK prices the userOp with
 * `pimlico_getUserOperationGasPrice`. Uses our key when present to avoid the public rate limit.
 */
export const getPrivacyPoolsBundlerUrl = (chainId: bigint): string => {
  const apiKey = process.env.REACT_APP_PIMLICO_API_KEY

  return apiKey
    ? `https://api.pimlico.io/v2/${chainId.toString()}/rpc?apikey=${apiKey}`
    : `https://public.pimlico.io/v2/${chainId.toString()}/rpc`
}

/**
 * Circuit artifact paths, relative to the same-origin base the host supplies (see the extension's
 * webpack copy step). Why not the SDK's default: see `createProverFactory`.
 */
export const PRIVACY_POOLS_CIRCUIT_PATHS = {
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
} as const

/** Storage key of the local operation log. */
export const PRIVACY_POOLS_ACTIVITY_STORAGE_KEY = 'privacyPoolsActivity'

/** Storage key holding the wallet's Privacy Pools accounts. */
export const PRIVACY_POOLS_ACCOUNTS_STORAGE_KEY = 'privacyPoolsAccounts'

export const getPrivacyPoolsChainConfig = (chainId: bigint): PrivacyPoolsChainConfig | undefined =>
  PRIVACY_POOLS_CHAINS[chainId.toString()]

/**
 * The plugin's storage key for a chain's history, mirrored as the SDK does not export it. Needed
 * before a plugin exists: to seed its starting state and tell whether the chain has history yet.
 */
export const getPrivacyPoolsStoreKey = ({
  chainId,
  entrypointAddress
}: PrivacyPoolsChainConfig): string =>
  `privacy-pool-state-${chainId.toString()}-${BigInt(entrypointAddress).toString()}`

/** Whether the address is the wallet's native token address (`ZERO_ADDRESS`). */
export const isPrivacyPoolsNativeAsset = (address: string): boolean =>
  address.toLowerCase() === ZERO_ADDRESS

/** Looks up a configured asset (see `PrivacyPoolsAsset`) by the wallet's address for it. */
export const getPrivacyPoolsAsset = (
  chainId: bigint,
  address: string
): PrivacyPoolsAsset | undefined =>
  getPrivacyPoolsChainConfig(chainId)?.assets.find(
    (asset) => asset.address.toLowerCase() === address.toLowerCase()
  )

/** The asset, if it can be deposited - see `PrivacyPoolsAsset.isWithdrawable`. */
export const getPrivacyPoolsDepositAsset = (
  chainId: bigint,
  address: string
): PrivacyPoolsAsset | undefined => {
  const asset = getPrivacyPoolsAsset(chainId, address)

  return asset?.isWithdrawable ? asset : undefined
}

/** Translates an address into the sentinel the SDK expects for native. */
export const toPrivacyPoolsAssetAddress = (address: string): Hex =>
  (isPrivacyPoolsNativeAsset(address)
    ? PRIVACY_POOLS_NATIVE_ASSET_ADDRESS
    : address.toLowerCase()) as Hex

/** Translates an SDK address (often a bigint) into the wallet's convention for native. */
export const fromPrivacyPoolsAssetAddress = (address: bigint | string): Hex => {
  const hex =
    typeof address === 'bigint'
      ? `0x${address.toString(16).padStart(40, '0')}`
      : address.toLowerCase()

  return (hex.toLowerCase() === PRIVACY_POOLS_NATIVE_ASSET_ADDRESS ? ZERO_ADDRESS : hex) as Hex
}
