import { IrCall } from '../libs/humanizer/interfaces'
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
  /** About a day of blocks, to count the pool's recent activity by block instead of by time. */
  blocksPerDay: bigint
  /** 0xBow's association-set API for this chain. */
  aspUrl: string
  /** The saga-sync CDN serving the pools' history. Without it, a first sync is slow. */
  sagaSyncUrl?: string
  /** The ERC-4337 paymaster for withdrawals. Without it, withdrawals are unavailable. */
  paymaster?: PrivacyPoolsPaymasterConfig
  /**
   * Pool address (lowercase) to the wallet's address of the asset it holds. Only calls to these are
   * shown as Privacy Pools calls, and only their deposits can be taken back from the wallet.
   */
  pools: { [poolAddress: string]: Hex }
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

export type PrivacyPoolsSyncStatus = 'idle' | 'syncing' | 'ready'

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
  /** The address the deposit was made from, the only one that can take it back (ragequit). */
  depositorAddr: Hex
  /** The account's deposits are numbered in the order they were made, so a higher one is newer. */
  depositIndex: number
}

/**
 * A deposit still being verified. Only the account it was made from can take it back, publicly and
 * in full (ragequit).
 */
export type PrivacyPoolsRagequitDeposit = {
  label: bigint
  /** What goes back: the whole deposit, as nothing of it can have been sent yet. */
  amount: bigint
  /** The address the deposit was made from, the only one it can go back to. */
  depositorAddr: Hex
}

/**
 * What everyone's deposits in a pool add up to, as of the chain's last sync. Mostly from this
 * device's copy of the pool's history, the rest from the pool itself - see `getPrivacyPoolsPoolStats`.
 */
export type PrivacyPoolsPoolStats = {
  /** What the pool holds: deposits less withdrawals and deposits taken back. */
  totalAmount: bigint
  /** Deposits ever verified. The more there are, the harder a withdrawal is to tell apart. */
  approvedDepositsCount: number
  /** Deposits still waiting to be verified, and what they hold. */
  pendingDepositsCount: number
  pendingAmount: bigint
  depositsCount24h: number
  withdrawalsCount24h: number
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
 * One chain as the UI reads it: the account's sync of the chain, merged with what this device knows
 * of the chain's shared state. Notes reach the UI only as per-token `balances`.
 */
export type PrivacyPoolsChainState = {
  chainId: string
  syncStatus: PrivacyPoolsSyncStatus
  /** Start of the sync in flight. The SDK reports no progress, so this tells slow from hung. */
  syncStartedAt: number | null
  /** Per chain, so one dead RPC doesn't hide the other chains' usable balances. */
  error: string | null
  /**
   * Whether this device has read the chain's shared state - minutes the first time, seconds after.
   * Null until looked up.
   */
  isInitialSyncDone: boolean | null
  /** In ms, when the first read ran since the wallet started. */
  initialSyncDuration: number | null
  // Tells "never synced" (show placeholders) apart from "syncing again" (keep what is on screen)
  lastSyncedAt: number | null
  /** In ms, of this account's latest sync. */
  lastSyncDuration: number | null
}

/** The part that belongs to one account: its sync of the chain, and its notes in the chain's pools. */
export type PrivacyPoolsAccountChainState = Pick<
  PrivacyPoolsChainState,
  'syncStatus' | 'syncStartedAt' | 'error' | 'lastSyncedAt' | 'lastSyncDuration'
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
  /**
   * The proved withdrawal as the sign screens show a transaction: what it sends and to whom, read
   * from its payload rather than from the request, and what the recipient is expected to get, from
   * the simulation. Set with `quote`.
   */
  humanization: IrCall | null
  // Set when `status` is 'failed', in the same plain language the toast would have used
  error: string | null
}

/**
 * What the user has entered on a Privacy Pools account's Send screen. Kept like the regular Send
 * form: through a closed popup, until the user leaves the screen, switches accounts or sends.
 */
export type PrivacyPoolsSendForm = {
  /** The recipient field as typed. A domain name in it is resolved again when the screen opens. */
  recipientFieldValue: string
  /** The picked token's id (`${chainId}:${tokenAddress}`), or '' for the screen's default. */
  tokenId: string
  amount: string
  amountInFiat: string
  amountFieldMode: 'token' | 'fiat'
}

/** The entrypoint's deposit requirements for one asset, read from the chain as 0xBow tunes them. */
export type PrivacyPoolsDepositAssetConfig = {
  /** The pool the entrypoint sends the asset's deposits to. */
  poolAddress: string
  minimumDepositAmount: bigint
}

/** 'pending' means "not observed as complete yet". It resolves from the broadcast result. */
export type PrivacyPoolsOperationStatus = 'pending' | 'success' | 'failed'
