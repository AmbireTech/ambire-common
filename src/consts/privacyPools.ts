import { Hex } from '../interfaces/hex'
import { PrivacyPoolsAsset, PrivacyPoolsChainConfig } from '../interfaces/privacyPools'
import { ZERO_ADDRESS } from '../services/socket/constants'

/**
 * The sentinel `@kohaku-eth/privacy-pools` uses for native ETH. The SDK types every asset as an
 * ERC-20, so native amounts travel as `{ __type: 'erc20', contract: E_ADDRESS }` rather than as the
 * `native` asset kind - which `prepareUnshield` explicitly refuses.
 *
 * It stops at the controller's edge: `fromPrivacyPoolsAssetAddress` maps it to `ZERO_ADDRESS` on
 * the way out, so the portfolio, token lists and UI keep using the wallet's own convention for
 * native and never learn this constant exists.
 */
export const PRIVACY_POOLS_NATIVE_ASSET_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

/**
 * Privacy Pools' BIP-32 prefix, from the SDK's `SecretManager`:
 * `m/28784'/1'/<account>'/<salt|nullifier>'/<deposit>'/<secret>'`.
 *
 * `KeystoreController.derivePrivacyPoolsKey` refuses anything outside it. That whitelist is the
 * security boundary, not a tidiness rule: the plugin is an unaudited alpha that asks the host
 * keystore to derive arbitrary paths, and without the prefix check it could reach the user's EVM
 * keys.
 */
export const PRIVACY_POOLS_DERIVATION_PATH_PREFIX = "m/28784'/1'/"

/**
 * Which key set to derive. Fixed at 0 so the notes a phrase owns are a pure function of that
 * phrase and nothing has to be persisted to recover them - at the cost of one identity per phrase.
 * A per-account index would have to be user-chosen and stored; never infer one, since a different
 * inference points the wallet at an empty set of notes.
 */
export const PRIVACY_POOLS_ACCOUNT_INDEX = 0

/**
 * Where the pools' event history is published as static files, signed and content-addressed.
 *
 * Run by fatlabs, who also build the protocol's circuits. Reading a pool from here costs one
 * request and about a second, against the thousands of sequential `eth_getLogs` calls the same
 * history costs from a provider - which is the whole reason a first sync used to take a quarter of
 * an hour.
 *
 * Only Ethereum is published, and only the pools: the entrypoint has no stream, so its own walk
 * still goes to the provider. Nothing here is trusted on its word - the client checks every file
 * against the digests in the signed manifest before the SDK sees an event.
 */
export const PRIVACY_POOLS_SAGA_SYNC_URL = 'https://saga.fatsolutions.xyz'

const nativeAsset = (symbol: string, maxDeposit: bigint): PrivacyPoolsAsset => ({
  address: ZERO_ADDRESS as Hex,
  symbol,
  decimals: 18,
  isNative: true,
  maxDeposit
})

/**
 * The chains the 0xBow deployment is configured for in this SDK version. `PrivacyPoolsV1_0xBow`
 * only carries these two, and the protocol is live on more (Optimism, BSC, Arbitrum) behind a
 * different entrypoint - adding them means more than appending an id here.
 *
 * Mutually exclusive in practice: Sepolia only exists in the testnet network set and Ethereum only
 * in the mainnet one.
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
      nativeAsset('ETH', 10_000n * 10n ** 18n),
      {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        decimals: 6,
        isNative: false,
        maxDeposit: 1_000_000n * 10n ** 6n
      },
      {
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        symbol: 'USDT',
        decimals: 6,
        isNative: false,
        maxDeposit: 1_000_000n * 10n ** 6n
      },
      {
        address: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        symbol: 'DAI',
        decimals: 18,
        isNative: false,
        maxDeposit: 1_000_000n * 10n ** 18n
      },
      {
        address: '0xdC035D45d973E3EC169d2276DDab16f1e407384F',
        symbol: 'USDS',
        decimals: 18,
        isNative: false,
        maxDeposit: 1_000_000n * 10n ** 18n
      },
      {
        address: '0xa3931d71877C0E7a3148CB7Eb4463524FEc27fbD',
        symbol: 'sUSDS',
        decimals: 18,
        isNative: false,
        maxDeposit: 1_000_000n * 10n ** 18n
      },
      {
        address: '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3',
        symbol: 'USDe',
        decimals: 18,
        isNative: false,
        maxDeposit: 1_000_000n * 10n ** 18n
      },
      {
        address: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d',
        symbol: 'USD1',
        decimals: 18,
        isNative: false,
        maxDeposit: 1_000_000n * 10n ** 18n
      },
      {
        address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
        symbol: 'wstETH',
        decimals: 18,
        isNative: false,
        maxDeposit: 100_000n * 10n ** 18n
      },
      {
        address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        symbol: 'wBTC',
        decimals: 8,
        isNative: false,
        maxDeposit: 100n * 10n ** 8n
      }
    ]
  },
  '11155111': {
    chainId: 11155111n,
    entrypointAddress: '0x34A2068192b1297f2a7f85D7D8CdE66F8F0921cB',
    deploymentBlock: 8461453n,
    aspUrl: 'https://dw.0xbow.io',
    // No `paymaster`: the SDK ships no paymaster for Sepolia yet, so withdrawals are unavailable
    // here until one is deployed. Deposits, balances and reclaims are unaffected.
    assets: [
      nativeAsset('ETH', 1n * 10n ** 18n),
      {
        address: '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0',
        symbol: 'USDT',
        decimals: 6,
        isNative: false,
        maxDeposit: 100n * 10n ** 6n
      },
      {
        address: '0x1c7d4b196cb0c7b01d743fbc6116a902379c7238',
        symbol: 'USDC',
        decimals: 6,
        isNative: false,
        maxDeposit: 100n * 10n ** 6n
      }
    ]
  }
}

export const PRIVACY_POOLS_SUPPORTED_CHAIN_IDS = Object.values(PRIVACY_POOLS_CHAINS).map(
  ({ chainId }) => chainId
)

/**
 * The bundler a withdrawal's userOp is estimated and sent through.
 *
 * Pimlico specifically, not whichever bundler the network is configured with: the SDK prices the
 * userOp with `pimlico_getUserOperationGasPrice`, which no other bundler answers. Our own key when
 * the build has one, so withdrawals are not throttled by the public endpoint's rate limit - the
 * same key the regular transaction flow already sends to Pimlico.
 */
export const getPrivacyPoolsBundlerUrl = (chainId: bigint): string => {
  const apiKey = process.env.REACT_APP_PIMLICO_API_KEY

  return apiKey
    ? `https://api.pimlico.io/v2/${chainId.toString()}/rpc?apikey=${apiKey}`
    : `https://public.pimlico.io/v2/${chainId.toString()}/rpc`
}

/**
 * Circuit artifacts are served from the app as same-origin assets - see the extension's webpack
 * copy step. The host supplies the base; the SDK's `Circuits` appends these paths.
 *
 * Deliberately not the SDK's `DEFAULT_ARTIFACTS_BASE_URL`, which points at a pinned commit on
 * raw.githubusercontent.com: a third-party CDN in the path of a withdrawal, needing a CSP entry,
 * re-downloading ~23 MB per prover instance.
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

/** Storage key holding the local operation log. The pool exposes no history of its own. */
export const PRIVACY_POOLS_ACTIVITY_STORAGE_KEY = 'privacyPoolsActivity'

/** Storage key holding the wallet's Privacy Pools accounts. */
export const PRIVACY_POOLS_ACCOUNTS_STORAGE_KEY = 'privacyPoolsAccounts'

export const getPrivacyPoolsChainConfig = (chainId: bigint): PrivacyPoolsChainConfig | undefined =>
  PRIVACY_POOLS_CHAINS[chainId.toString()]

/**
 * Where the plugin keeps a chain's history, in the plugin's own key format.
 *
 * Mirrored here rather than read from the SDK, which does not export it, because two things the
 * wallet does need the key before a plugin exists: shipping that chain a starting state, and
 * telling whether the chain has any history at all yet.
 */
export const getPrivacyPoolsStoreKey = ({
  chainId,
  entrypointAddress
}: PrivacyPoolsChainConfig): string =>
  `privacy-pool-state-${chainId.toString()}-${BigInt(entrypointAddress).toString()}`

/** Whether an address is how this wallet writes "the chain's native token". */
export const isPrivacyPoolsNativeAsset = (address: string): boolean =>
  address.toLowerCase() === ZERO_ADDRESS

/**
 * Looks up an asset's display data by the address the wallet uses for it.
 *
 * Configured rather than read from the contract: `decimals` is what user-entered amounts are
 * parsed with, so a wrong or missing value is a wrong amount, and the pools are a short, curated
 * list that 0xBow controls. Reading them over RPC would add a round trip per token and a failure
 * mode on a slow node, for data that does not change.
 */
export const getPrivacyPoolsAsset = (
  chainId: bigint,
  address: string
): PrivacyPoolsAsset | undefined =>
  getPrivacyPoolsChainConfig(chainId)?.assets.find(
    (asset) => asset.address.toLowerCase() === address.toLowerCase()
  )

/** Translates an address into the sentinel the SDK expects for native. */
export const toPrivacyPoolsAssetAddress = (address: string): Hex =>
  (isPrivacyPoolsNativeAsset(address)
    ? PRIVACY_POOLS_NATIVE_ASSET_ADDRESS
    : address.toLowerCase()) as Hex

/**
 * Translates an address the SDK reported back into the wallet's own convention, so the sentinel
 * never leaves the controller. Takes the bigint the SDK actually stores addresses as.
 */
export const fromPrivacyPoolsAssetAddress = (address: bigint | string): Hex => {
  const hex =
    typeof address === 'bigint'
      ? `0x${address.toString(16).padStart(40, '0')}`
      : address.toLowerCase()

  return (hex.toLowerCase() === PRIVACY_POOLS_NATIVE_ASSET_ADDRESS ? ZERO_ADDRESS : hex) as Hex
}
