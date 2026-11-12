import { IrCall } from '../libs/humanizer/interfaces'
import { ControllerInterface } from './controller'
import { Pagination, PaginationResult } from '../utils/paginate'
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
   * 0xBow's relayers for withdrawals, by name, each URL with the `/relayer` path the service
   * mounts its routes on. The SDK takes the cheapest quote, the first one on a tie.
   */
  relayers?: { [name: string]: string }
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
  /** The name the user gave it. Missing on accounts added before they had names. */
  label?: string
}

/**
 * A Privacy Pools account an adding flow prepared, named `label` until the user renames it. Its
 * recovery phrase is a stored one, or a new one the keystore holds as its temp seed until added.
 */
export type PrivacyPoolsAccountToAdd =
  | { isNewSeed: false; seedId: string; label: string }
  | { isNewSeed: true; label: string }

/**
 * Prepares the Privacy Pools account of a flow, from a stored recovery phrase (`seedId`) or a new
 * one. Resolves with `null` when `signal` aborts first - the user left the flow.
 */
export type PreparePrivacyPoolsAccount = (params: {
  seedId: string | null
  extraEntropy?: string
  signal: AbortSignal
}) => Promise<PrivacyPoolsAccountToAdd | null>

export type PrivacyPoolsSyncStatus = 'idle' | 'syncing' | 'ready'

/**
 * Why Privacy Pools can't be used right now:
 * - 'locked' - the keystore is locked, so the note secrets can't be derived
 * - 'no-account' - no Privacy Pools account is selected
 * - 'unsupported-network' - no Privacy Pools chain is in the user's network list
 * - 'passphrase-needed' - the phrase's passphrase isn't saved and its account's key is missing or
 *   can't be read, so the account has to be added again with the passphrase
 */
export type PrivacyPoolsUnavailableReason =
  | 'locked'
  | 'no-account'
  | 'unsupported-network'
  | 'passphrase-needed'

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
  /** What the deposit put into the pool, after the vetting fee. `amount` is what is left of it. */
  depositValue: bigint
  /** How many sends were already made from this note. */
  withdrawCount: number
  /** The block of the deposit. */
  blockNumber: bigint
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
  depositsCount24h: number
  withdrawalsCount24h: number
}

/**
 * A chain's pool numbers, computed after each sync of its history - see
 * `PrivacyPoolsController.poolStats`.
 */
export type PrivacyPoolsChainPoolStats = {
  /** By the pool's token address, in lowercase. Empty when they could not be read. */
  byToken: { [tokenAddress: string]: PrivacyPoolsPoolStats }
  /** Why they could not be read, or null. */
  error: string | null
}

/**
 * Notes summed per token. Only `approvedAmount` can be withdrawn. What deposits, withdrawals and
 * ragequits still on their way will do is not in the notes yet, so the amounts above do not
 * include it. The fields below are named like the regular portfolio's.
 */
export type PrivacyPoolsTokenBalance = {
  tokenAddress: string
  symbol: string
  decimals: number
  isNative: boolean
  approvedAmount: bigint
  pendingAmount: bigint
  totalAmount: bigint
  /**
   * How much `totalAmount` will change once what is on its way shows in the notes: positive for a
   * deposit, after the pool's fee, negative for a withdrawal or a deposit taken back.
   */
  simulationAmount: bigint
  /** `approvedAmount` less what withdrawals on their way take out of it. What can be sent now. */
  approvedAmountPostSimulation: bigint
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

/**
 * The part that belongs to one account: its sync of the chain, its notes in the chain's pools, and
 * its history there when asked for (see `PrivacyPoolsController.filterHistory`).
 */
export type PrivacyPoolsAccountChainState = Pick<
  PrivacyPoolsChainState,
  'syncStatus' | 'syncStartedAt' | 'error' | 'lastSyncedAt' | 'lastSyncDuration'
> & {
  /** The notes with a balance. */
  notes: PrivacyPoolsNote[]
  /**
   * The notes sent in full or taken back, apart from `notes` as only the privacy checks need them,
   * to tell the user's own deposits from others'.
   */
  spentNotes: PrivacyPoolsNote[]
  /** Newest first. Null until read: it is read only while the UI shows it. */
  history: PrivacyPoolsHistoryEntry[] | null
  /** Whether `history` was read by the sync that read `notes`. Kept, though stale, until reread. */
  isHistoryCurrent: boolean
  /** Why the last read of the history failed, or null. */
  historyError: string | null
}

/** A deposit into the account, a withdrawal from it, or a deposit taken back (ragequit). */
export type PrivacyPoolsHistoryEntryType = 'deposit' | 'withdrawal' | 'ragequit'

/**
 * One event of the account's history, read from this device's copy of the pools' history, so
 * nothing about it is asked of the network.
 */
export type PrivacyPoolsHistoryEntry = {
  /** Unique within the account's history and the same across reads, for list keys. */
  id: string
  type: PrivacyPoolsHistoryEntryType
  chainId: string
  /** In the wallet's form - `ZERO_ADDRESS` for native. */
  tokenAddress: string
  /**
   * What the event moved: a deposit's amount after the pool's fee, the whole amount a withdrawal
   * took out (its fee included), or all of a deposit taken back.
   */
  amount: bigint
  /** In ms. Estimated from the blocks around it, so it can be off by a minute or two. */
  timestamp: number
  /** Null when this device's copy of the history did not record it. */
  txnId: Hex | null
  /**
   * The public address on the other side: the one a deposit came from, or a deposit taken back
   * went to. Null for a withdrawal, as where it went is not in the pool's records.
   */
  counterpartyAddr: Hex | null
  /**
   * A deposit's review: 'pending' while it is still being verified, so it cannot be sent privately
   * yet, or 'approved' once the checks approved it, so it could be. Null for a withdrawal or a
   * ragequit, and for the deposit a ragequit took back, as it is no longer being verified.
   */
  status: PrivacyPoolsApprovalStatus | null
}

/** What a history page is narrowed to. */
export type PrivacyPoolsHistoryFilters = {
  /** One network, or all of them when left out. */
  chainId?: string
}

/** A page of the selected account's history, as one screen (session) shows it. */
export type PrivacyPoolsHistorySession = {
  filters: PrivacyPoolsHistoryFilters
  pagination: Pagination
  /** Null until every network shown has been read once, so an empty page means no activity. */
  result: PaginationResult<PrivacyPoolsHistoryEntry> | null
  /** Why a network shown could not be read, or null. What was read before is still in `result`. */
  error: string | null
}

/**
 * A prepared withdrawal's cost. The fee is decoded from the signed userOp, not taken from the SDK
 * (see `readPaymasterWithdrawal`); the expected cost is simulated (see
 * `estimatePaymasterWithdrawalFee`).
 */
export type PrivacyPoolsQuote = {
  /**
   * The fee locked into the proof, in the token's units. Through Kohaku it is a cap: the paymaster
   * refunds what gas does not use to the recipient in the same transaction. Through 0xBow it is
   * exact.
   */
  feeAmount: bigint
  /** The least the recipient receives. */
  amountAfterFee: bigint
  /**
   * `feeAmount` minus the refund, or `feeAmount` itself through 0xBow. Null when the simulation
   * failed.
   */
  expectedFeeAmount: bigint | null
}

/**
 * Who sends a transfer out of a Privacy Pools account and pays its gas, for a fee taken out of it:
 * 0xBow's relayers, which most transfers out of the pools use, or Kohaku's ERC-4337 paymaster.
 */
export type PrivacyPoolsBroadcaster = '0xbow' | 'kohaku'

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
  /** Who proves and sends it, as chosen when it was started. */
  broadcaster: PrivacyPoolsBroadcaster
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
  /** The privacy of the proved withdrawal, from the deposits it spends. Set with `quote`. */
  privacy: PrivacyPoolsWithdrawalPrivacy | null
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

/**
 * The entrypoint's deposit requirements for one asset that the Send form checks, read from the
 * chain as 0xBow tunes them. The pool is kept privately, and read again once per Send session, as
 * 0xBow can replace a pool while the wallet runs.
 */
export type PrivacyPoolsDepositAssetConfig = {
  minimumDepositAmount: bigint
  /** The share of a deposit the entrypoint keeps, in basis points (1 = 0.01%). */
  vettingFeeBPS: bigint
}

/** 'pending' means "not observed as complete yet". It resolves from the broadcast result. */
export type PrivacyPoolsOperationStatus = 'pending' | 'success' | 'failed'

/**
 * A privacy leak a transfer can have. Deposits that stand out (`cover`) and deposits that are too
 * recent are not leaks: the user is shown how many deposits hide theirs and decides.
 */
export type PrivacyPoolsLeakId =
  /** The send spends a whole deposit whose amount no other deposit has. */
  | 'unique-amount'
  /** The send takes part of an untouched deposit back to the address it came from. */
  | 'send-to-depositor'
  /** The send takes any of a deposit that earlier sends took part of back to where it came from. */
  | 'send-rest-to-depositor'
  /** The send uses up a deposit that earlier sends already took part of. */
  | 'empties-partly-sent-deposit'
  /** No deposit has put this amount into the pool yet. */
  | 'unusual-deposit-amount'
  /** The send spends more than one deposit, which links them. */
  | 'several-deposits'
  /** The send spends a deposit made in the last day, so its timing can point to the user. */
  | 'fresh-deposit'

/** A change the user can make to fix a leak. */
export type PrivacyPoolsLeakAction = {
  actionName: 'set-amount'
  meta: { amount: bigint }
} & {
  /** English, to translate as it is. The amount is shown next to it. */
  label: string
}

export type PrivacyPoolsLeak = {
  id: PrivacyPoolsLeakId
  title: string
  text?: string
  /**
   * 'error' breaks privacy (Traceable), 'warning' weakens it (Weak privacy). 'info' is only a
   * note and does not lower the rating.
   */
  type: 'error' | 'warning' | 'info'
  actions: PrivacyPoolsLeakAction[]
}

/**
 * How well a transfer hides. `unchecked` means nothing could be checked, as when the pool's
 * deposits are not read yet.
 */
export type PrivacyPoolsRating = 'standard' | 'weak' | 'traceable' | 'unchecked'

/** How many recent deposits (see `PRIVACY_POOLS_COVER_WINDOW_DAYS`) hide a send. */
export type PrivacyPoolsSendCover = {
  /** Deposits large enough to pay the amount sent. */
  bigEnough: number
  /** Deposits of exactly the amount sent. */
  sameAmount: number
}

/** The privacy of a send from a Privacy Pools account. */
export type PrivacyPoolsWithdrawalPrivacy = {
  rating: PrivacyPoolsRating
  leaks: PrivacyPoolsLeak[]
  cover: PrivacyPoolsSendCover
}

/** The privacy of a deposit into a pool. */
export type PrivacyPoolsDepositPrivacy = {
  rating: PrivacyPoolsRating
  leaks: PrivacyPoolsLeak[]
  /** Recent deposits (see `PRIVACY_POOLS_COVER_WINDOW_DAYS`) of exactly this amount. */
  sameAmount: number
}

/** A send from a Privacy Pools account to check, as the Send form has it. */
export type PrivacyPoolsWithdrawalPrivacyParams = {
  seedId: string
  chainId: string
  tokenAddress: string
  /** The deposit the send spends. */
  noteLabel: bigint
  amount: bigint
  /** Null before the user enters one, so only the amount is checked. */
  recipient: string | null
}

/**
 * The privacy of a send the Send form asked about, with what it was asked for, so the screen can
 * tell whether it still matches the form. `privacy` is null when the deposit cannot pay `amount`,
 * or before the chain's first sync.
 */
export type PrivacyPoolsWithdrawalPrivacyCheck = {
  chainId: string
  tokenAddress: string
  noteLabel: bigint
  amount: bigint
  /** Null before the user enters one. */
  recipient: string | null
  privacy: PrivacyPoolsWithdrawalPrivacy | null
}
