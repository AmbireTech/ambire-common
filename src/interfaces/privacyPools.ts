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
   * Relayer name to base URL, including the `/relayer` path prefix. More than one on purpose:
   * the SDK quotes them in parallel, takes the cheapest, and tolerates individual failures, and
   * they stop accepting at different gas prices.
   */
  relayers: { [name: string]: string }
  /** The assets this chain's pools accept, in the order the UI should offer them. */
  assets: PrivacyPoolsAsset[]
}

export type PrivacyPoolsSyncStatus = 'idle' | 'initializing' | 'syncing' | 'ready'

/**
 * Why Privacy Pools can't be used right now, so the UI can explain rather than just disable:
 * - 'locked' - the keystore is locked, so the note secrets can't be derived
 * - 'no-seed' - the account has no key from a stored recovery phrase (hardware, private key,
 *   view-only), and the secrets are derived from that phrase
 * - 'unsupported-network' - no Privacy Pools chain is in the user's network list
 */
export type PrivacyPoolsUnavailableReason = 'locked' | 'no-seed' | 'unsupported-network'

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
 * A relayer's answer for one withdrawal, after we have checked it against what we asked for.
 *
 * The SDK does not validate the quote it proves against - `quoteThunk.validateWithdrawalData` is
 * an empty function with a TODO - so these fields are what our own guard decoded out of the
 * relayer's `withdrawalData` and confirmed, not what the relayer claimed alongside it.
 */
export type PrivacyPoolsQuote = {
  relayerName: string
  feeBps: bigint
  feeAmount: bigint
  /** What the recipient actually receives, after the relayer's cut. */
  amountAfterFee: bigint
  /** Unix ms after which the relayer's signed commitment is no longer accepted. */
  expiresAt: number
}

/**
 * How a withdrawal reaches the chain.
 * - 'relayed' - a third-party relayer broadcasts and takes a fee. The only mode where the
 *   recipient never needs prior ETH, and so the only one that lets it be a brand new address.
 * - 'self' - we broadcast `Entrypoint.relay` ourselves with a zero fee. Costs one public link
 *   between the address paying gas and the recipient, so it is for reclaiming to an address
 *   already known to be the user's, for amounts no relayer will take, and for when relayers are
 *   down - never as a cheaper way to reach a fresh address.
 */
export type PrivacyPoolsWithdrawalMode = 'relayed' | 'self'

/**
 * How far along a withdrawal is. No percentage to be had - the SDK reports nothing while it works -
 * so these are the points the controller can observe: picking a note and quoting (seconds),
 * proving (~10s and up, the bulk of the wait), a pause for the user to confirm the fee,
 * broadcasting, then the refresh that confirms it.
 */
export type PrivacyPoolsOperationPhase =
  | 'quoting'
  | 'proving'
  /** Proved and quoted, waiting for the user to send it. Nothing is spent until they do. */
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
  chainId: string
  tokenAddress: string
  isNative: boolean
  amount: bigint
  recipient: string
  mode: PrivacyPoolsWithdrawalMode
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
  /** What the relayer took on the way out, for withdrawals in 'relayed' mode. */
  relayFee?: bigint
  mode?: PrivacyPoolsWithdrawalMode
  txnId?: string
}

/**
 * 'pending' means "not observed as complete yet". A withdrawal resolves from its own broadcast
 * result; a deposit resolves from the transaction that carries it.
 */
export type PrivacyPoolsActivityStatus = 'pending' | 'success' | 'failed'
