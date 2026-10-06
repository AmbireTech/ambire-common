import { ControllerInterface } from './controller'
import { Hex } from './hex'

export type IPrivacyPoolsController = ControllerInterface<
  InstanceType<typeof import('../controllers/privacyPools/privacyPools').PrivacyPoolsController>
>

/**
 * One asset a pool accepts. Configured rather than read from the contract: user-entered amounts
 * are parsed with `decimals`, so a wrong value is a wrong amount. 0xBow's curated list is static.
 */
export type PrivacyPoolsAsset = {
  /** Native is `ZERO_ADDRESS`; the SDK's own sentinel never appears here. */
  address: Hex
  symbol: string
  decimals: number
  isNative: boolean
  /**
   * 0xBow's interface limit per deposit. Not a protocol limit, but the one that matters, since
   * 0xBow also runs the ASP.
   */
  maxDeposit: bigint
  /**
   * Whether the paymaster can sponsor withdrawing it. Only these are offered for deposits, or the
   * funds could not be sent out from this wallet.
   */
  isWithdrawable: boolean
}

/** One chain's 0xBow deployment and the off-chain services for it. */
export type PrivacyPoolsChainConfig = {
  chainId: bigint
  entrypointAddress: Hex
  /** Where a first sync starts reading the entrypoint's history. */
  deploymentBlock: bigint
  /** 0xBow's association-set API for this chain. */
  aspUrl: string
  /** The saga-sync CDN serving the pools' history. Without it, a first sync is slow. */
  sagaSyncUrl?: string
  /** The ERC-4337 paymaster for withdrawals. Without it, withdrawals are unavailable. */
  paymaster?: PrivacyPoolsPaymasterConfig
  /** In the order the UI offers them. */
  assets: PrivacyPoolsAsset[]
}

/**
 * The paymaster pays the userOp's gas and takes its fee out of the withdrawn amount, so the
 * recipient needs no ETH.
 */
export type PrivacyPoolsPaymasterConfig = {
  entryPointAddress: Hex
  paymasterAddress: Hex
  /**
   * Pool address (lowercase, as the SDK looks it up) to the adapter that withdraws from it during
   * paymaster validation. A pool missing here cannot be withdrawn from.
   */
  poolAdapters: { [poolAddress: string]: Hex }
}

/**
 * The notes one stored recovery phrase holds in the pools. It has no address: notes are tied to
 * secrets derived from the phrase. At most one per phrase, since the account index is fixed.
 */
export type PrivacyPoolsAccount = {
  seedId: string
  createdAt: number
}

export type PrivacyPoolsSyncStatus = 'idle' | 'initializing' | 'syncing' | 'ready'

/**
 * Why Privacy Pools can't be used right now:
 * - 'locked' - the keystore is locked, so the note secrets can't be derived
 * - 'no-account' - no Privacy Pools account is selected
 * - 'unsupported-network' - no Privacy Pools chain is in the user's network list
 */
export type PrivacyPoolsUnavailableReason = 'locked' | 'no-account' | 'unsupported-network'

/**
 * Set by the Association Set Provider, not the protocol. A deposit is 'pending' until 0xBow adds
 * its label to the set and the new root is pushed on chain. Only 'approved' notes can be withdrawn;
 * a 'pending' one can only be reclaimed publicly (ragequit) to its depositor.
 */
export type PrivacyPoolsApprovalStatus = 'approved' | 'pending'

/** One note as the SDK reports it. `label` is the handle a public reclaim is requested by. */
export type PrivacyPoolsNote = {
  label: bigint
  tokenAddress: string
  amount: bigint
  approval: PrivacyPoolsApprovalStatus
}

/** Notes summed per token. Only `approvedAmount` can be withdrawn. */
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
 * One chain as the UI reads it: the chain's sync, shared by every identity, merged with this
 * identity's last read. Notes reach the UI only as per-token `balances`.
 */
export type PrivacyPoolsChainState = {
  chainId: string
  syncStatus: PrivacyPoolsSyncStatus
  /** Start of the sync in flight. The SDK reports no progress, so this tells slow from hung. */
  syncStartedAt: number | null
  /** Per chain, so one dead RPC doesn't hide the other chains' usable balances. */
  error: string | null
  /**
   * Whether this device has read the chain's history - minutes the first time, seconds after.
   * Null until looked up.
   */
  isInitialSyncDone: boolean | null
  /** In ms, when the first read ran since the wallet started. */
  initialSyncDuration: number | null
  // Tells "never synced" (show placeholders) apart from "syncing again" (keep what is on screen)
  lastSyncedAt: number | null
  /** In ms, of this identity's latest sync. */
  lastSyncDuration: number | null
}

/** The part of `PrivacyPoolsChainState` shared by every identity. */
export type PrivacyPoolsChainSyncState = Pick<
  PrivacyPoolsChainState,
  'syncStatus' | 'syncStartedAt' | 'error'
>

/** Shared by every identity and kept through a lock, as none of it comes from a phrase. */
export type PrivacyPoolsChainHistory = Pick<
  PrivacyPoolsChainState,
  'isInitialSyncDone' | 'initialSyncDuration'
>

/** The part that belongs to one identity, with its notes in that chain's pools. */
export type PrivacyPoolsIdentityChainState = Pick<
  PrivacyPoolsChainState,
  'lastSyncedAt' | 'lastSyncDuration'
> & { notes: PrivacyPoolsNote[] }

/**
 * A prepared withdrawal's cost. The fee is decoded from the signed userOp, not taken from the SDK
 * (see `readPaymasterWithdrawal`); the expected cost is simulated (see
 * `estimatePaymasterWithdrawalFee`).
 */
export type PrivacyPoolsQuote = {
  /**
   * The cap, in the token's units: the fee locked into the proof. The paymaster refunds what gas
   * does not use to the recipient in the same transaction.
   */
  feeAmount: bigint
  /** The least the recipient receives. */
  amountAfterFee: bigint
  /** `feeAmount` minus the refund. Null when the simulation failed. */
  expectedFeeAmount: bigint | null
}

/**
 * A withdrawal's progress. The SDK reports none while it works, so these are the observable
 * points. 'proving' is the bulk of the wait (~10s and up): the proof is usually built twice, again
 * after the bundler refines the gas limits.
 */
export type PrivacyPoolsOperationPhase =
  | 'proving'
  /** Proved and priced, waiting for the user to send it. Nothing is spent until they do. */
  | 'ready'
  | 'broadcasting'
  | 'finalizing'

/**
 * The withdrawal in flight, or the last one until dismissed. Deposits go through the regular
 * transaction flow instead.
 */
export type PrivacyPoolsOperation = {
  /** Tells a superseded withdrawal's late result apart from the current one's. */
  id: string
  /** Shown only with this recovery phrase's account. */
  seedId: string
  chainId: string
  tokenAddress: string
  isNative: boolean
  amount: bigint
  recipient: string
  status: PrivacyPoolsOperationStatus
  phase: PrivacyPoolsOperationPhase
  startedAt: number
  quote: PrivacyPoolsQuote | null
  // Set when `status` is 'failed', in the same plain language the toast would have used
  error: string | null
}

/** The entrypoint's deposit requirements for one asset, read from the chain as 0xBow tunes them. */
export type PrivacyPoolsDepositAssetConfig = {
  minimumDepositAmount: bigint
}

/** 'pending' means "not observed as complete yet". It resolves from the broadcast result. */
export type PrivacyPoolsOperationStatus = 'pending' | 'success' | 'failed'
