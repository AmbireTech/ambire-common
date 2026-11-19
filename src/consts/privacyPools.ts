import { Hex } from '../interfaces/hex'
import {
  PrivacyPoolsAsset,
  PrivacyPoolsChainConfig,
  PrivacyPoolsLeakId
} from '../interfaces/privacyPools'
import { ZERO_ADDRESS } from '../services/socket/constants'

/**
 * The SDK's native ETH sentinel. Native travels as `{ __type: 'erc20', contract: E_ADDRESS }`,
 * since `prepareUnshield` refuses the `native` asset kind. Never leaves the controller - see
 * `fromPrivacyPoolsAssetAddress`.
 */
export const PRIVACY_POOLS_NATIVE_ASSET_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

/**
 * Fixed so a phrase alone recovers its notes, at the cost of one identity per phrase. Never infer
 * another index: a wrong one points the wallet at an empty set of notes.
 */
export const PRIVACY_POOLS_ACCOUNT_INDEX = 0

/**
 * The SDK's branch of the phrase's key tree: every Privacy Pools account's key is below it, at
 * `/{accountIndex}'`. Its node is what the keystore stores for a phrase (see `privacyKeys`).
 */
export const PRIVACY_POOLS_KEY_ROOT_PATH = "m/28784'/1'"

/**
 * The one key Privacy Pools needs per phrase, from the SDK's `SignatureSecretManager`: every note's
 * nullifier, salt and paymaster withdrawal signer are derived from this key's EIP-712 signature of
 * the note, `PrivacyPoolNote(depositIndex, secretIndex)`.
 *
 * Security boundary: `KeystoreController.derivePrivacyKey` refuses any other path, since the
 * plugin asks for arbitrary paths and could otherwise reach the user's EVM keys.
 */
export const PRIVACY_POOLS_SIGNING_KEY_PATH = `${PRIVACY_POOLS_KEY_ROOT_PATH}/${PRIVACY_POOLS_ACCOUNT_INDEX}'`

/**
 * fatlabs' CDN of the entrypoint's and the pools' event history as signed, content-addressed
 * files, against thousands of `eth_getLogs` calls: a chain's first read takes about 18 s. Only
 * Ethereum is published. Every file is checked against the signed manifest before use. The `/v2`
 * publication, as only it has each event's transaction hash, which the activity links to.
 */
export const PRIVACY_POOLS_SAGA_SYNC_URL = 'https://saga.fatsolutions.xyz/v2'

/**
 * fatlabs' Ed25519 key that signs the `PRIVACY_POOLS_SAGA_SYNC_URL` manifest. A manifest that
 * fails the check is rejected and the history is read from the provider instead.
 */
export const PRIVACY_POOLS_SAGA_SYNC_PUBLIC_KEY =
  '0x03778175990200a844f375d7c6e13e2ae0dc67a4ce610b04afb77c0ebb46b115'

/**
 * How long one read from `PRIVACY_POOLS_SAGA_SYNC_URL` may take before the provider reads the
 * history instead. One read can carry a pool's whole history, so it is longer than a request's.
 */
export const PRIVACY_POOLS_SAGA_READ_TIMEOUT = 60_000

/** How long a GET from the Privacy Pools SDK, such as the 0xBow API, may take before it fails. */
export const PRIVACY_POOLS_READ_TIMEOUT = 30_000

/**
 * Ethereum only: Sepolia has no paymaster, so nothing could be withdrawn there. Other chains
 * (Optimism, BSC, Arbitrum) use a different entrypoint, so adding them takes more than an entry.
 */
export const PRIVACY_POOLS_CHAINS: { [chainId: string]: PrivacyPoolsChainConfig } = {
  '1': {
    chainId: 1n,
    entrypointAddress: '0x6818809EefCe719E480a7526D76bD3e561526b46',
    deploymentBlock: 22153713n,
    // 12 s per block
    blocksPerDay: 7200n,
    aspUrl: 'https://api.0xbow.io',
    sagaSyncUrl: PRIVACY_POOLS_SAGA_SYNC_URL,
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
    // As the entrypoint's `assetConfig` lists them
    pools: {
      '0xf241d57c6debae225c0f2e6ea1529373c9a9c9fb': ZERO_ADDRESS as Hex,
      '0xb419c2867ab3cbc78921660cb95150d95a94ce86': '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      '0xe859c0bd25f260baee534fb52e307d3b64d24572': '0xdAC17F958D2ee523a2206206994597C13D831ec7'
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
 * `pimlico_getUserOperationGasPrice`. Throws without our key, like the wallet's Pimlico bundler.
 */
export const getPrivacyPoolsBundlerUrl = (chainId: bigint): string => {
  const apiKey = process.env.REACT_APP_PIMLICO_API_KEY

  if (!apiKey) throw new Error('Pimlico API key is not set')

  return `https://api.pimlico.io/v2/${chainId.toString()}/rpc?apikey=${apiKey}`
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

/**
 * How long taking back a deposit waits for its depositor's account to load before giving up, so
 * a slow network does not keep the button loading. Covers one fetch through our RPCs.
 */
export const PRIVACY_POOLS_RAGEQUIT_DEPOSITOR_STATE_TIMEOUT_MS = 15 * 1000

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

/** How many days back the deposits that hide a transfer are counted in what the user sees. */
export const PRIVACY_POOLS_COVER_WINDOW_DAYS = 90n

/**
 * Depositors checked for a Kohaku client fingerprint in one call. Their packed addresses stay under the
 * 24 KB calldata limit of RPCs without state override, and the call far below the gas cap.
 */
export const PRIVACY_POOLS_FINGERPRINT_CHECK_BATCH_SIZE = 1000

const ETH_UNIT = 10n ** 18n
const USD_STABLECOIN_UNIT = 10n ** 6n
const USD_STABLECOIN_DEPOSIT_CHIPS = [25n, 100n, 500n, 1_000n, 5_000n, 10_000n].map(
  (amount) => amount * USD_STABLECOIN_UNIT
)

/**
 * The most common amounts deposits put into each pool, smallest first, by token id (see
 * `getPrivacyPoolsTokenId`). A deposit of one of them hides among many others. None is below the
 * pool's minimum deposit. The ETH ones are the most common deposits of the last 90 days.
 */
export const PRIVACY_POOLS_DEPOSIT_CHIPS: { [tokenId: string]: bigint[] } = {
  [`1:${ZERO_ADDRESS}`]: [1n, 10n, 50n, 100n, 500n].map(
    (hundredths) => (hundredths * ETH_UNIT) / 100n
  ),
  '1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': USD_STABLECOIN_DEPOSIT_CHIPS,
  '1:0xdac17f958d2ee523a2206206994597c13d831ec7': USD_STABLECOIN_DEPOSIT_CHIPS
}

/**
 * A send hidden among fewer deposits than this is shown as a warning, even with no leak. It does
 * not count as a leak, as the user decides whether that many is enough.
 */
export const PRIVACY_POOLS_MIN_REASSURING_COVER = 5

/** Leaks of a send that come from where it goes, which another recipient avoids. */
export const PRIVACY_POOLS_RECIPIENT_LEAK_IDS: PrivacyPoolsLeakId[] = [
  'send-to-depositor',
  'send-rest-to-depositor'
]

/** Leaks of a send that come from its amount and the deposits it spends, which another amount can avoid. */
export const PRIVACY_POOLS_AMOUNT_LEAK_IDS: PrivacyPoolsLeakId[] = [
  'unique-amount',
  'empties-partly-sent-deposit',
  'several-deposits',
  'fresh-deposit'
]

/** Whether the address is the wallet's native token address (`ZERO_ADDRESS`). */
export const isPrivacyPoolsNativeAsset = (address: string): boolean =>
  address.toLowerCase() === ZERO_ADDRESS

/**
 * Identifies a token of the Send form. Includes the chain, as the same token on two chains has
 * different pools and must not collide.
 */
export const getPrivacyPoolsTokenId = (chainId: string, tokenAddress: string): string =>
  `${chainId}:${tokenAddress.toLowerCase()}`

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
