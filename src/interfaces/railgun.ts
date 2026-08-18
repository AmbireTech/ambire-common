import { Price } from './assets'
import { ControllerInterface } from './controller'
import { Hex } from './hex'

export type IRailgunController = ControllerInterface<
  InstanceType<typeof import('../controllers/railgun/railgun').RailgunController>
>

/**
 * 'queued' exists because scans cannot overlap: the WASM module is single-threaded and every plugin
 * method takes `&mut self`, so a run over several chains is strictly sequential. Saying so is better
 * than showing two spinners of which only one is moving.
 */
export type RailgunSyncStatus = 'idle' | 'initializing' | 'queued' | 'syncing' | 'ready'

/**
 * Why Railgun can't be used right now, so the UI can explain it instead of just disabling
 * the button:
 * - 'locked' - the keystore is locked, so the Railgun keys can't be derived
 * - 'no-seed' - the selected account has no internal key derived from a stored recovery
 *   phrase (hardware wallet, private-key import or view-only account). Railgun's identity is
 *   derived from the seed, so there is nothing to derive from
 * - 'unsupported-network' - none of the Railgun-capable chains is in the user's network list
 *   (or its RPC provider is missing)
 */
export type RailgunUnavailableReason = 'locked' | 'no-seed' | 'unsupported-network'

/**
 * Spendability of a note according to the POI (Proof of Innocence) aggregator, mirroring the
 * SDK's `PoiStatus`:
 * - 'Valid' - proven innocent, spendable
 * - 'ProofSubmitted' - the wallet submitted a POI proof, waiting for the aggregator
 * - 'Missing' - no POI yet. Freshly shielded notes start here and stay for Railgun's ~1h
 *   Unshield-Only Standby Period
 * - 'ShieldBlocked' - the shield was flagged by the list provider
 * - 'unknown' - the SDK returned no status (only happens with POI disabled)
 *
 * This matters beyond display: the SDK's `SignerPool.drain` refuses to spend any note that
 * isn't 'Valid', for private transfers AND unshields alike.
 */
export type RailgunPoiStatus = 'Valid' | 'ProofSubmitted' | 'Missing' | 'ShieldBlocked' | 'unknown'

/**
 * One shielded balance entry as the SDK reports it: amounts are grouped per
 * (token, POI status) pair, so the same token can appear more than once.
 */
export type RailgunShieldedBalance = {
  tokenAddress: string
  amount: bigint
  poiStatus: RailgunPoiStatus
}

/**
 * The same balances collapsed to one entry per token, split by what the user can actually do
 * with them. `spendable` is the only part unshield/private-transfer can use.
 */
export type RailgunTokenBalance = {
  tokenAddress: string
  spendableAmount: bigint
  pendingAmount: bigint
  blockedAmount: bigint
  totalAmount: bigint
}

/**
 * What the UI needs in order to render a shielded balance, resolved separately because the pool
 * reports raw contract addresses and raw amounts and nothing else. Deliberately the same three
 * pieces the dashboard uses for a public token, so a shielded row can be rendered the same way.
 *
 * An entry exists only when `symbol`/`decimals` were actually read from the contract - never with
 * assumed values, since `decimals` is what user-entered amounts are parsed with. A missing entry
 * therefore means "unresolved", and the forms refuse to act on such a token.
 *
 * `priceIn` may be empty while the entry exists: the token's market simply isn't known (always
 * the case on testnets, which have no CoinGecko platform). That is a balance shown without a
 * value, not an unresolved token.
 */
export type RailgunTokenData = {
  address: string
  symbol: string
  decimals: number
  priceIn: Price[]
}

export type RailgunChainState = {
  chainId: string
  // Note there is no address here: the 0zk address is wallet-wide, not per-chain - see
  // RailgunController.railgunAddress.
  // The chain's wrapped native token (WETH on Ethereum/Sepolia). Exposed so the UI can label
  // the corresponding shielded balance and the native shield/unshield flows without
  // hardcoding a possibly-stale address.
  wrappedBaseTokenAddress: Hex | null
  syncStatus: RailgunSyncStatus
  /**
   * Whether the current identity's own entry is on the device, i.e. whether its notes have been
   * decrypted here before. This is what decides whether a run is the one-time initialization or a
   * seconds-long catch-up - reading it off `lastSyncedAt` instead is what previously applied the
   * short timeout to a first run and put the chain in a permanent retry loop.
   */
  hasIdentityData: boolean
  // Lets the UI tell "never synced" (show placeholders) apart from "syncing again" (keep what
  // is on screen), so a refresh doesn't swap content in and out.
  lastSyncedAt: number | null
  /**
   * When the sync currently in flight started, or null when none is. Exists because the SDK
   * reports no progress at all - `RailgunProvider.sync()` returns void, emits nothing, and its
   * only narration goes to the console (see the RailgunSyncTelemetry experiment). With no
   * numerator to show, elapsed time is what tells a slow sync from a hung one, and a first sync
   * on Ethereum measured ~11 minutes - long enough that a bare spinner reads as broken.
   */
  syncStartedAt: number | null
  balances: RailgunShieldedBalance[]
  /**
   * Why this chain is unusable right now, or null when it is fine. Per-chain rather than one
   * controller-wide error because every supported chain is initialized and synced now: a single
   * dead RPC (or a chain whose cold sync timed out) must not present itself as "Railgun is
   * broken" while the other chain's shielded balances are on screen and spendable.
   */
  error: string | null
}

/**
 * What broadcasting an unshield or a private transfer is expected to cost, in the chain's wrapped
 * base token (WETH) - the only asset the SDK will pay the relayer with, so this fee always comes out
 * of the user's shielded WETH and never out of the asset being sent.
 *
 * An estimate by nature: the fee is gas x gas price, the gas is only known once the proof exists,
 * and the price is whatever it is minutes later when the operation actually goes out. `maxAmount`
 * carries the headroom the shielded WETH balance is checked against, so an operation isn't started
 * with a balance that only just covers the middle of the range.
 */
export type RailgunNetworkFeeEstimate = {
  amount: bigint
  maxAmount: bigint
  tokenAddress: string
  // Whether the spendable shielded WETH covers `maxAmount` after what the operation itself spends
  hasEnough: boolean
  shieldedWrappedBaseTokenAmount: bigint
}

/**
 * How far along a private operation is. There is no percentage to be had - the SDK reports nothing
 * while it works - so these are the points the controller can actually observe:
 * - 'preparing' - picking which shielded notes to spend. Seconds
 * - 'proving' - building the proof and sending it. Minutes, and the bulk of the wait
 * - 'finalizing' - refreshing the shielded balance, which is also what confirms the result
 */
export type RailgunPrivateOperationPhase = 'preparing' | 'proving' | 'finalizing'

/**
 * The private operation on screen: the one in flight, or the last one until the user dismisses it,
 * so its result can be shown rather than toasted away.
 *
 * Shields are absent on purpose - they are signed and broadcast through the regular transaction
 * flow, which has its own progress UI.
 */
export type RailgunPrivateOperation = {
  // The id of the matching activity entry, so the two can never drift apart
  id: string
  chainId: string
  type: Exclude<RailgunActivityType, 'shield'>
  tokenAddress: string
  isNative: boolean
  amount: bigint
  recipient: string
  status: RailgunActivityStatus
  phase: RailgunPrivateOperationPhase
  startedAt: number
  // Set when `status` is 'failed', in the same plain language the toast would have used
  error: string | null
}

export type RailgunActivityType = 'shield' | 'unshield' | 'transfer'

/**
 * A Railgun operation started from this wallet. Railgun's own pool exposes no transaction
 * history (`notes()` returns unspent notes only, with no timestamp or txn id, and change notes
 * are indistinguishable from received ones), so activity is recorded locally as operations are
 * performed instead of being derived from chain state.
 */
export type RailgunActivityEntry = {
  id: string
  chainId: string
  type: RailgunActivityType
  tokenAddress: string
  // Native shields/unshields move the wrapped base token in the pool - kept so the UI can
  // label the entry with the asset the user picked, not the wrapped one.
  isNative: boolean
  amount: bigint
  // Public 0x address for unshields, 0zk address for private transfers, null for shields
  recipient: string | null
  status: RailgunActivityStatus
  createdAt: number
  // Set when `status` is 'failed', to surface why without digging through logs
  error?: string
  /**
   * What Railgun's treasury took for this operation, in the token the entry is about. Recorded
   * rather than recomputed, so the log stays accurate if the rate ever changes.
   */
  protocolFee?: bigint
}

/**
 * 'pending' means "not observed as complete yet". Unshields/transfers resolve from their own
 * broadcast result; shields are broadcast by the regular sign & broadcast flow, which never
 * reports back here, so they resolve on the next sync that shows the balance growing.
 */
export type RailgunActivityStatus = 'pending' | 'success' | 'failed'
