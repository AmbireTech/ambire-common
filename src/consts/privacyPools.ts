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
    relayers: {
      'Fast Relay': 'https://fastrelay.xyz/relayer',
      'Cloaked Relay': 'https://api.clkd.xyz/relayer'
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
    relayers: {
      'Testnet Relay': 'https://testnet-relayer.privacypools.com/relayer',
      'Freedom Relay': 'https://fastrelay.xyz/relayer'
    },
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
 * Where the relayer service mounts its router. The operators run 0xBow's own Express app, which
 * does `app.use('/relayer', ...)`, while the SDK's client requests `${relayerUrl}/quote` with no
 * prefix of its own - so the prefix has to live in the configured URL above. Kept here because a
 * bare host answers 404 and the failure looks like a dead relayer rather than a wrong path.
 */
export const PRIVACY_POOLS_RELAYER_PATH_PREFIX = '/relayer'

/**
 * Bound on how much of the withdrawn amount a relayer may keep, checked before we prove against
 * its quote. The entrypoint enforces its own per-asset `maxRelayFeeBPS` on chain, so this is the
 * earlier and stricter of the two.
 *
 * Temporarily off. A relayer's fee is mostly the gas it fronts, so on a small withdrawal it is a
 * large share of the amount by arithmetic rather than by greed - a 10% ceiling refused every
 * relayer and left the funds unwithdrawable, which is worse than an expensive withdrawal the user
 * agreed to. The checks that matter are unaffected: the committed recipient must be the one the
 * user typed, and the committed fee may not exceed the advertised one. What replaces the ceiling
 * is the user - a withdrawal stops at `phase: 'ready'` showing the exact fee and the exact amount
 * the recipient gets, and nothing is spent until they confirm.
 *
 * Off does not mean unbounded: the entrypoint's own per-asset `maxRelayFeeBPS` is read from the
 * chain and enforced before proving - see `readEntrypointAssetConfig`. That ceiling is the real
 * one, since exceeding it reverts the relay, and it is set per deployment (1% on Sepolia, 10% on
 * Ethereum) rather than guessed here.
 *
 * Set it back to a bigint to re-arm it. Null rather than a very large number so the check is
 * skipped outright instead of being nominally on and never firing.
 */
export const PRIVACY_POOLS_MAX_RELAY_FEE_BPS: bigint | null = null

/**
 * How much of a relayer's signed fee commitment has to be left for us to prove against it. Quotes
 * carry their own `expiration`, but proving takes ~10s on a desktop and longer on weak hardware,
 * so one that is about to lapse is refused up front rather than after the work is done.
 *
 * Measured: 0xBow's relayers issue commitments good for exactly 60 seconds. So this must stay well
 * under 60s or every quote is refused the moment network latency eats into it - and comfortably
 * above the ~10s of proving, or we accept a quote that cannot survive the work it is for.
 */
export const PRIVACY_POOLS_QUOTE_MIN_REMAINING_MS = 25_000

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

export const getPrivacyPoolsChainConfig = (chainId: bigint): PrivacyPoolsChainConfig | undefined =>
  PRIVACY_POOLS_CHAINS[chainId.toString()]

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
