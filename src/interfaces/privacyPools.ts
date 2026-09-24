import { ControllerInterface } from './controller'
import { Hex } from './hex'

export type IPrivacyPoolsController = ControllerInterface<
  InstanceType<typeof import('../controllers/privacyPools/privacyPools').PrivacyPoolsController>
>

/**
 * One asset a pool accepts, with the display data the UI needs.
 *
 * Configured rather than read from the contract: `decimals` is what user-entered amounts are parsed
 * with, so a missing or wrong value is a wrong amount. The pools are a short list 0xBow curates,
 * and none of this changes.
 */
export type PrivacyPoolsAsset = {
  /**
   * The address the wallet uses. Native is `ZERO_ADDRESS`, matching the rest of the app - the
   * SDK's own sentinel is translated at the controller's edge and never appears here.
   */
  address: Hex
  symbol: string
  decimals: number
  isNative: boolean
  /**
   * The per-deposit ceiling 0xBow's own interface applies. Not a protocol limit - the pool only
   * rejects deposits at `type(uint128).max` - so treat it as the operator's policy, which is the
   * bound that matters in practice since the ASP is theirs too.
   */
  maxDeposit: bigint
}

/** One chain's 0xBow deployment, plus the off-chain services that serve it. */
export type PrivacyPoolsChainConfig = {
  chainId: bigint
  entrypointAddress: Hex
  /**
   * Where the entrypoint was deployed. A first sync walks the chain from here in 5000-block
   * `eth_getLogs` steps, which is why a shipped state snapshot matters on mainnet.
   */
  deploymentBlock: bigint
  /** 0xBow's association-set API for this chain. */
  aspUrl: string
  /**
   * Where this chain's pool history is published as static, verifiable files, when someone
   * publishes it. Set only for chains the saga-sync CDN actually carries - a chain without one
   * rebuilds its history from the provider, which is correct but slow.
   */
  sagaSyncUrl?: string
  /**
   * The ERC-4337 paymaster that sponsors withdrawals on this chain. Absent where none is deployed,
   * and withdrawals are unavailable there.
   */
  paymaster?: PrivacyPoolsPaymasterConfig
  /** The assets this chain's pools accept, in the order the UI should offer them. */
  assets: PrivacyPoolsAsset[]
}

/**
 * How a withdrawal is sponsored: the userOp's gas is paid by the paymaster, which takes its fee out
 * of the withdrawn amount, so the recipient never needs ETH of its own and nothing the user owns
 * pays gas next to it.
 */
export type PrivacyPoolsPaymasterConfig = {
  entryPointAddress: Hex
  paymasterAddress: Hex
  /**
   * Pool address (lowercase, the way the SDK looks it up) to the adapter that withdraws from it
   * during paymaster validation. A pool missing here cannot be withdrawn from.
   */
  poolAdapters: { [poolAddress: string]: Hex }
}

/**
 * A Privacy Pools account: the notes one stored recovery phrase holds in the pools.
 *
 * Identified by the phrase rather than by an address, because it has none - deposits and
 * withdrawals are tied to secrets derived from the phrase, and each withdrawal is sent from a fresh
 * single-use sender. At most one per phrase: its secrets come from a fixed account index, so a
 * second one would hold the very same notes.
 */
export type PrivacyPoolsAccount = {
  seedId: string
  createdAt: number
}

export type PrivacyPoolsSyncStatus = 'idle' | 'initializing' | 'syncing' | 'ready'

/**
 * Why Privacy Pools can't be used right now, so the UI can explain rather than just disable:
 * - 'locked' - the keystore is locked, so the note secrets can't be derived
 * - 'no-account' - no Privacy Pools account is selected; a regular one is, or none at all
 * - 'unsupported-network' - no Privacy Pools chain is in the user's network list
 */
export type PrivacyPoolsUnavailableReason = 'locked' | 'no-account' | 'unsupported-network'

/**
 * Whether a note may be spent privately, decided by the Association Set Provider rather than by
 * the protocol. A deposit lands 'pending' and becomes 'approved' once 0xBow includes its label in
 * the set and the postman pushes the new root on chain.
 *
 * Only 'approved' notes can be withdrawn. A 'pending' one can only be reclaimed publicly, back to
 * the address that deposited it - see `PrivacyPoolsActivityType`'s 'reclaim'.
 */
export type PrivacyPoolsApprovalStatus = 'approved' | 'pending'

/**
 * One note as the SDK reports it. `label` is the pool's per-deposit identifier and the handle a
 * public reclaim is requested by, so it is carried rather than recomputed.
 */
export type PrivacyPoolsNote = {
  label: bigint
  tokenAddress: string
  amount: bigint
  approval: PrivacyPoolsApprovalStatus
}

/**
 * Notes collapsed to one entry per token, split by what the user can actually do with them. Only
 * `approvedAmount` can be withdrawn privately.
 */
export type PrivacyPoolsTokenBalance = {
  tokenAddress: string
  symbol: string
  decimals: number
  isNative: boolean
  approvedAmount: bigint
  pendingAmount: bigint
  totalAmount: bigint
}

/**
 * One chain as the UI reads it, merged from the chain's own sync - shared by every identity on it -
 * and the notes this identity owns there.
 */
export type PrivacyPoolsChainState = {
  chainId: string
  syncStatus: PrivacyPoolsSyncStatus
  /**
   * When the sync in flight started, or null when none is. The SDK reports no progress at all, so
   * elapsed time is the only thing telling a slow sync from a hung one.
   */
  syncStartedAt: number | null
  /**
   * Why this chain is unusable, or null when it is fine. Per chain rather than controller-wide:
   * one dead RPC must not present itself as "Privacy Pools is broken" while the other chain's
   * balances are on screen and spendable.
   */
  error: string | null
  // Tells "never synced" (show placeholders) apart from "syncing again" (keep what is on screen)
  lastSyncedAt: number | null
  notes: PrivacyPoolsNote[]
}

/** The half of `PrivacyPoolsChainState` that belongs to the chain, shared by every identity. */
export type PrivacyPoolsChainSyncState = Pick<
  PrivacyPoolsChainState,
  'syncStatus' | 'syncStartedAt' | 'error'
>

/** The half that belongs to one identity - the notes it owns in that chain's pools. */
export type PrivacyPoolsIdentityChainState = Pick<PrivacyPoolsChainState, 'lastSyncedAt' | 'notes'>

/**
 * What a prepared withdrawal costs, after we have checked it against what we asked for.
 *
 * Decoded out of the signed userOp's `paymasterData` - the bytes the paymaster and the pool will
 * actually act on - rather than taken from the SDK's word. See `readPaymasterWithdrawal`.
 */
export type PrivacyPoolsQuote = {
  /** The gas fee the paymaster keeps, in the withdrawn token's units. */
  feeAmount: bigint
  /** What the recipient actually receives, after the fee. */
  amountAfterFee: bigint
}

/**
 * How far along a withdrawal is. No percentage to be had - the SDK reports nothing while it works -
 * so these are the points the controller can observe: proving and pricing the gas (~10s and up,
 * the bulk of the wait - the proof is usually built twice, once more after the bundler refines the
 * gas limits), a pause for the user to confirm the fee, broadcasting, then the refresh that
 * confirms it.
 */
export type PrivacyPoolsOperationPhase =
  | 'proving'
  /** Proved and priced, waiting for the user to send it. Nothing is spent until they do. */
  | 'ready'
  | 'broadcasting'
  | 'finalizing'

/**
 * The withdrawal on screen: the one in flight, or the last one until the user dismisses it.
 * Deposits are absent - they go through the regular transaction flow, which has its own progress
 * UI.
 */
export type PrivacyPoolsOperation = {
  // The id of the matching activity entry, so the two can never drift apart
  id: string
  /** The recovery phrase whose notes are being withdrawn - the operation is shown only with it. */
  seedId: string
  chainId: string
  tokenAddress: string
  isNative: boolean
  amount: bigint
  recipient: string
  status: PrivacyPoolsActivityStatus
  phase: PrivacyPoolsOperationPhase
  startedAt: number
  quote: PrivacyPoolsQuote | null
  // Set when `status` is 'failed', in the same plain language the toast would have used
  error: string | null
}

/**
 * - 'deposit' - funds moved into the pool. Public, including the depositing address.
 * - 'withdraw' - funds left the pool privately, to any address.
 * - 'reclaim' - the protocol's ragequit: a still-unapproved deposit taken back publicly, to the
 *   address that made it. Named for what it does, since "ragequit" means nothing to a user.
 */
export type PrivacyPoolsActivityType = 'deposit' | 'withdraw' | 'reclaim'

/**
 * A Privacy Pools operation started from this wallet. Recorded locally as operations are
 * performed, because the pool exposes no transaction history: notes carry no timestamp and no
 * transaction id, and a change note is indistinguishable from a fresh one.
 */
export type PrivacyPoolsActivityEntry = {
  id: string
  /**
   * The seed the notes belong to. Recorded because the log is one flat list shared by every
   * identity on the device, while the notes it describes are per recovery phrase - so it is what
   * scopes the log to the account on screen.
   */
  seedId: string
  chainId: string
  type: PrivacyPoolsActivityType
  tokenAddress: string
  isNative: boolean
  amount: bigint
  /** Public address for withdrawals and reclaims, null for deposits. */
  recipient: string | null
  status: PrivacyPoolsActivityStatus
  createdAt: number
  /** Set for deposits once the transaction is signed and sent. */
  broadcastedAt?: number
  // Set when `status` is 'failed', to surface why without digging through logs
  error?: string
  /** What the entrypoint took on the way in, recorded rather than recomputed. */
  vettingFee?: bigint
  /** What the paymaster took out of a withdrawal for its gas. */
  fee?: bigint
  txnId?: string
}

/**
 * 'pending' means "not observed as complete yet". A withdrawal resolves from its own broadcast
 * result; a deposit resolves from the transaction that carries it.
 */
export type PrivacyPoolsActivityStatus = 'pending' | 'success' | 'failed'
