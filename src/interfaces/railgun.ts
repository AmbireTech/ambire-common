import { Price } from './assets'
import { ControllerInterface } from './controller'
import { Hex } from './hex'

export type IRailgunController = ControllerInterface<
  InstanceType<typeof import('../controllers/railgun/railgun').RailgunController>
>

/**
 * 'queued' exists because scans cannot overlap - the WASM module is single-threaded, so a run over
 * several chains is strictly sequential and a waiting chain has to say so.
 */
export type RailgunSyncStatus = 'idle' | 'initializing' | 'queued' | 'syncing' | 'ready'

/**
 * Why Railgun can't be used right now, so the UI can explain it rather than just disable the button:
 * - 'locked' - the keystore is locked, so the keys can't be derived
 * - 'no-seed' - the account has no key from a stored recovery phrase (hardware, private key,
 *   view-only), and the Railgun identity is derived from that phrase
 * - 'unsupported-network' - no Railgun-capable chain is in the user's network list
 */
export type RailgunUnavailableReason = 'locked' | 'no-seed' | 'unsupported-network'

/**
 * Spendability of a note per the POI (Proof of Innocence) aggregator, mirroring the SDK's
 * `PoiStatus`. Only 'Valid' notes can be spent - `SignerPool.drain` refuses the rest, for unshields
 * as much as for private transfers. 'Missing' is where a freshly shielded note sits for Railgun's
 * ~1h standby period; 'unknown' means the SDK reported no status (POI disabled).
 */
export type RailgunPoiStatus = 'Valid' | 'ProofSubmitted' | 'Missing' | 'ShieldBlocked' | 'unknown'

/** One shielded balance as the SDK reports it - grouped per (token, POI status) pair. */
export type RailgunShieldedBalance = {
  tokenAddress: string
  amount: bigint
  poiStatus: RailgunPoiStatus
}

/**
 * The same balances collapsed to one entry per token, split by what the user can actually do with
 * them. Only `spendableAmount` can be unshielded or transferred.
 */
export type RailgunTokenBalance = {
  tokenAddress: string
  spendableAmount: bigint
  pendingAmount: bigint
  blockedAmount: bigint
  totalAmount: bigint
}

/**
 * What the UI needs to render a shielded balance - the pool reports raw addresses and amounts only.
 *
 * An entry exists only when `symbol`/`decimals` were actually read, never assumed: `decimals` is
 * what user-entered amounts are parsed with, so a missing entry means "unresolved" and the forms
 * refuse to act on the token. `priceIn` may still be empty - that is a balance without a value
 * (always the case on testnets), not an unresolved token.
 */
export type RailgunTokenData = {
  address: string
  symbol: string
  decimals: number
  priceIn: Price[]
}

export type RailgunChainState = {
  chainId: string
  /**
   * The chain's wrapped native token (WETH), so the UI can label the matching shielded balance and
   * the native flows without hardcoding a possibly-stale address. There is no 0zk address here -
   * that one is wallet-wide, see `RailgunController.railgunAddress`.
   */
  wrappedBaseTokenAddress: Hex | null
  syncStatus: RailgunSyncStatus
  /**
   * Whether this identity's own notes have been decrypted on this device before, which is what
   * tells the one-time initialization apart from a seconds-long catch-up. Read from what is
   * persisted, not from `lastSyncedAt` - a further identity on an already-scanned chain still faces
   * the full walk.
   */
  hasIdentityData: boolean
  // Tells "never synced" (show placeholders) apart from "syncing again" (keep what is on screen)
  lastSyncedAt: number | null
  /**
   * When the sync in flight started, or null when none is. The SDK reports no progress at all, so
   * elapsed time is the only thing that tells a slow sync from a hung one.
   */
  syncStartedAt: number | null
  balances: RailgunShieldedBalance[]
  /**
   * Why this chain is unusable, or null when it is fine. Per chain rather than controller-wide: one
   * dead RPC must not present itself as "Railgun is broken" while the other chain's balances are on
   * screen and spendable.
   */
  error: string | null
}

/**
 * What broadcasting an unshield or a private transfer is expected to cost, in the chain's wrapped
 * base token (WETH) - the only asset the SDK pays the relayer with, so it never comes out of the
 * asset being sent.
 *
 * An estimate by nature: the gas is only known once the proof exists. `maxAmount` carries the
 * headroom the shielded WETH balance is checked against.
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
 * How far along a private operation is. No percentage to be had - the SDK reports nothing while it
 * works - so these are the points the controller can observe: picking notes (seconds), proving and
 * sending (minutes, the bulk of the wait), then refreshing the balance that confirms the result.
 */
export type RailgunPrivateOperationPhase = 'preparing' | 'proving' | 'finalizing'

/**
 * The private operation on screen: the one in flight, or the last one until the user dismisses it.
 * Shields are absent - they go through the regular transaction flow, which has its own progress UI.
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
 * A Railgun operation started from this wallet. Recorded locally as operations are performed,
 * because the pool exposes no transaction history: `notes()` returns unspent notes only, with no
 * timestamp or txn id, and change notes are indistinguishable from received ones.
 */
export type RailgunActivityEntry = {
  id: string
  /**
   * The 0zk identity the operation belongs to. Recorded because the log is one flat list shared by
   * every identity on the device, while the pool it describes is per identity (per recovery
   * phrase) - so it is what scopes the log to the account on screen. See `RailgunController.activity`.
   */
  railgunAddress: string
  chainId: string
  type: RailgunActivityType
  tokenAddress: string
  // Native shields move the wrapped base token in the pool - kept so the entry can be labelled with
  // the asset the user picked, not the wrapped one
  isNative: boolean
  amount: bigint
  // Public 0x address for unshields, 0zk address for private transfers, null for shields
  recipient: string | null
  status: RailgunActivityStatus
  createdAt: number
  /**
   * When the shield's transaction was signed and sent, for shields only. Absent until then, which
   * is what tells "waiting for a signature" apart from "on its way".
   */
  broadcastedAt?: number
  // Set when `status` is 'failed', to surface why without digging through logs
  error?: string
  // What Railgun's treasury took, recorded rather than recomputed so the log survives a rate change
  protocolFee?: bigint
}

/**
 * 'pending' means "not observed as complete yet". Unshields and transfers resolve from their own
 * broadcast result; a shield resolves from the transaction that carries it - see
 * `RailgunController.handleShieldAccountOpStatusUpdate`, with `#resolvePendingShields` as the
 * balance-based fallback when that transaction is never seen.
 */
export type RailgunActivityStatus = 'pending' | 'success' | 'failed'
