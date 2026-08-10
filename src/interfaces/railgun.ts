import { ControllerInterface } from './controller'
import { Hex } from './hex'

export type IRailgunController = ControllerInterface<
  InstanceType<typeof import('../controllers/railgun/railgun').RailgunController>
>

export type RailgunSyncStatus = 'idle' | 'initializing' | 'syncing' | 'ready'

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

export type RailgunChainState = {
  chainId: string
  // Note there is no address here: the 0zk address is wallet-wide, not per-chain - see
  // RailgunController.railgunAddress.
  // The chain's wrapped native token (WETH on Ethereum/Sepolia). Exposed so the UI can label
  // the corresponding shielded balance and the native shield/unshield flows without
  // hardcoding a possibly-stale address.
  wrappedBaseTokenAddress: Hex | null
  syncStatus: RailgunSyncStatus
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
  /**
   * The chain's head as observed when the most recent sync attempt started, successful or not,
   * together with `syncedThroughBlock` the two answer "how stale is this balance" in blocks.
   *
   * Read here rather than taken from the SDK: its own cursor lives inside the persisted plugin
   * blob under an undocumented, hex-encoded key, so depending on it would break on a version bump.
   * One `eth_blockNumber` per chain per sync is cheaper than that coupling.
   */
  networkHead: number | null
  /**
   * The head the last *successful* sync started from, i.e. the block the shielded balances are
   * known to be current as of. Deliberately conservative: the SDK re-reads the head as it works,
   * so it typically ends up slightly further along - claiming less than was actually synced is the
   * right direction for a freshness claim.
   */
  syncedThroughBlock: number | null
  balances: RailgunShieldedBalance[]
  /**
   * Why this chain is unusable right now, or null when it is fine. Per-chain rather than one
   * controller-wide error because every supported chain is initialized and synced now: a single
   * dead RPC (or a chain whose cold sync timed out) must not present itself as "Railgun is
   * broken" while the other chain's shielded balances are on screen and spendable.
   */
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
}

/**
 * 'pending' means "not observed as complete yet". Unshields/transfers resolve from their own
 * broadcast result; shields are broadcast by the regular sign & broadcast flow, which never
 * reports back here, so they resolve on the next sync that shows the balance growing.
 */
export type RailgunActivityStatus = 'pending' | 'success' | 'failed'
