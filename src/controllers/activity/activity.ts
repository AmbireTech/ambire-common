import { toBeHex, TransactionReceipt, ZeroAddress } from 'ethers'

import { AddressPoisoningMatch } from '@/interfaces/transfer'
import {
  getAddressPoisoningMatchCounts,
  pickBetterPoisoningMatch,
  ScoredAddressPoisoningMatch
} from '@/libs/transfer/address-poisoning'
import { ActivityIdbStorage } from '@/services/storage/activityIdb'

import { Account, AccountId, IAccountsController } from '../../interfaces/account'
import {
  IActivityController,
  IActivityIdbStorage,
  InternalAccountsOps
} from '../../interfaces/activity'
import { Banner } from '../../interfaces/banner'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { Fetch } from '../../interfaces/fetch'
import { INetworksController, Network } from '../../interfaces/network'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import { ISafeController } from '../../interfaces/safe'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { IStorageController } from '../../interfaces/storage'
import {
  getAccountOpBalanceChanges,
  getBalanceChangeTokenAddresses
} from '../../libs/accountOp/balanceChanges'
import {
  AccountOpIdentifiedBy,
  BalanceChange,
  fetchFrontRanTxnId,
  fetchTxnId,
  getAccountOpRecipients,
  hasTimePassedSinceBroadcast,
  isIdentifiedByMultipleTxn,
  isIdentifiedByRelayer,
  isIdentifiedByUserOpHash,
  PortfoliosToUpdate,
  SubmittedAccountOp,
  SubmittedAccountOpLike,
  updateOpStatus
} from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus, Call } from '../../libs/accountOp/types'
import { getTransferLogTokens } from '../../libs/logsParser/parseLogs'
import { filterStaticBlacklistedAddrs } from '../../libs/portfolio/blacklist'
import { ScamFilter } from '../../libs/scamFilter'
import { parseLogs } from '../../libs/userOperation/userOperation'
import { getDebugTraceTransaction } from '../../utils/debugTransaction'
import wait from '../../utils/wait'
import EventEmitter from '../eventEmitter/eventEmitter'
import { InternalSignedMessages, SignedMessage } from './types'

import type { BalanceChangesReceipt } from '../../libs/accountOp/balanceChanges'
export interface Pagination {
  fromPage: number
  itemsPerPage: number
}

interface PaginationResult<T> {
  items: T[]
  itemsTotal: number
  currentPage: number
  maxPages: number
}

type AccountsOps = PaginationResult<SubmittedAccountOpLike>

type AddExternalAccountOpParams = {
  accountAddr: string
  chainId: bigint
  txnId: string
  receipt: TransactionReceipt
  callId?: Call['id']
  shouldLearnTokens?: boolean
}

type AccountOpBalanceChangesBackfillReference = Pick<
  SubmittedAccountOp,
  'identifiedBy' | 'accountAddr' | 'chainId'
>

type MessagesToBeSigned = PaginationResult<SignedMessage>

export interface Filters {
  account: string
  chainId?: bigint
  identifiedBy?: AccountOpIdentifiedBy
}


export interface ExternalAccountOps {
  [account: string]: { [network: string]: SubmittedAccountOpLike[] }
}

// We are limiting items array to include no more than 1000 records,
// as we trim out the oldest ones (in the beginning of the items array).
// We do this to maintain optimal storage and performance.
// Set to true to disable IndexedDB and benchmark against chrome.storage.local
const DISABLE_ACTIVITY_IDB = false

const trim = <T>(items: T[], maxSize = 1000): void => {
  if (items.length > maxSize) {
    // If the array size is greater than maxSize, remove the last (oldest) item
    // newest items are added to the beginning of the array so oldest will be at the end (thats why we .pop())
    items.pop()
  }
}

const paginate = (items: any[], fromPage: number, itemsPerPage: number) => {
  return {
    items: items.slice(fromPage * itemsPerPage, fromPage * itemsPerPage + itemsPerPage),
    itemsTotal: items.length,
    currentPage: fromPage, // zero/index based
    maxPages: Math.ceil(items.length / itemsPerPage)
  }
}

const getPreviousBlockNumber = (blockNumber: number) => (blockNumber > 0 ? blockNumber - 1 : 0)

const normalizeTxnId = (txnId?: string | null) => txnId?.toLowerCase()

/**
 * Take all txnIds from the account op
 * - normal case: accountOp.txnId
 * - MultipleTxns case: each call.txnId
 */
const getInternalAccountOpTxnIds = (accountOp: SubmittedAccountOp) => {
  return [accountOp.txnId, ...accountOp.calls.map((call) => call.txnId)].filter(
    (txnId): txnId is string => !!txnId
  )
}

const internalAccountOpHasTxnId = (accountOp: SubmittedAccountOp, txnId: string) => {
  const normalizedTxnId = normalizeTxnId(txnId)

  return getInternalAccountOpTxnIds(accountOp).some(
    (internalTxnId) => normalizeTxnId(internalTxnId) === normalizedTxnId
  )
}

const externalAccountOpHasTxnId = (accountOp: SubmittedAccountOpLike, txnId: string) =>
  normalizeTxnId(accountOp.txnId) === normalizeTxnId(txnId)

const isAccountOpFinalized = (accountOp: SubmittedAccountOp) =>
  accountOp.status !== AccountOpStatus.BroadcastedButNotConfirmed &&
  accountOp.status !== AccountOpStatus.Pending

/**
 * Fix address checksum problems as sometimes addresses are left out
 * only because they are not saved properly checksummed
 */
const getAccountOpsAccountKey = <T>(
  accountOps: { [account: string]: { [network: string]: T[] } },
  accountAddr: string
) => Object.keys(accountOps).find((key) => key.toLowerCase() === accountAddr.toLowerCase())

const getAccountOpsForAccountAndChain = <T>(
  accountOps: { [account: string]: { [network: string]: T[] } },
  accountAddr: string,
  chainIdString: string
) => {
  const accountKey = getAccountOpsAccountKey(accountOps, accountAddr)
  return accountKey ? accountOps[accountKey]?.[chainIdString] || [] : []
}

const getBalanceChangeWindowFromReceipts = (
  accountOp: SubmittedAccountOp,
  receipts: TransactionReceipt[]
) => {
  const firstReceipt = receipts[0]
  const lastReceipt = receipts[receipts.length - 1]

  if (!firstReceipt || !lastReceipt) return null

  return {
    receiptBlockNumber: lastReceipt.blockNumber,
    prevBlockNumber: isIdentifiedByMultipleTxn(accountOp.identifiedBy)
      ? getPreviousBlockNumber(firstReceipt.blockNumber)
      : undefined
  }
}

const getBalanceChangeTokenAddrsFromReceipts = async (
  accountOp: SubmittedAccountOp,
  receipts: TransactionReceipt[]
) => {
  const foundTokens = filterStaticBlacklistedAddrs(
    (
      await Promise.all(
        receipts.map((receipt) => getTransferLogTokens(receipt.logs, accountOp.accountAddr))
      )
    ).flat(),
    accountOp.chainId
  )

  return getBalanceChangeTokenAddresses(foundTokens, accountOp.chainId)
}

const getAccountOpReceipts = async (
  accountOp: SubmittedAccountOp,
  provider: {
    getTransactionReceipt: (txnId: string) => Promise<TransactionReceipt | null>
  }
) => {
  const txIds = isIdentifiedByMultipleTxn(accountOp.identifiedBy)
    ? accountOp.calls.map((call) => call.txnId).filter((txnId) => !!txnId)
    : accountOp.txnId
      ? [accountOp.txnId]
      : []

  if (!txIds.length) return []

  const receipts = await Promise.all(txIds.map((txnId) => provider.getTransactionReceipt(txnId)))

  return receipts.filter((receipt): receipt is TransactionReceipt => !!receipt)
}

/**
 * Activity Controller
 * Manages signed AccountsOps and Messages in controller memory and browser storage.
 *
 * Raw, unfiltered data is stored in private properties `ActivityController.#accountsOps` and
 * `ActivityController.#signedMessages`.
 *
 * Public methods and properties are exposed for retrieving data with filtering and pagination.
 *
 * To apply filters or pagination, call `filterAccountsOps()` or `filterSignedMessages()` with the
 * required parameters. Filtered items are stored in `ActivityController.accountsOps` and
 * `ActivityController.signedMessages` by session ID.
 *
 * Sessions ensure that each page manages its own filters and pagination independently. For example,
 * filters in "Settings -> Transactions History" and "Dashboard -> Activity Tab" are isolated per session.
 *
 * After adding or removing an AccountOp or SignedMessage, call `syncFilteredAccountsOps()` or
 * `syncFilteredSignedMessages()` to synchronize filtered data with the source data.
 *
 * The frontend is responsible for clearing filtered items for a session when a component unmounts
 * by calling `resetAccountsOpsFilters()` or `resetSignedMessagesFilters()`. If not cleared, all
 * sessions will be automatically removed when the browser is closed or the controller terminates.
 *
 * 💡 For performance, items per account and network are limited to 1000.
 * Older items are trimmed, keeping the most recent ones.
 */
export class ActivityController extends EventEmitter implements IActivityController {
  #storage: IStorageController

  #fetch: Fetch

  #activityIdb?: IActivityIdbStorage

  #initialLoadPromise?: Promise<void>

  #accounts: IAccountsController

  #selectedAccount: ISelectedAccountController

  #accountsOps: InternalAccountsOps = {}

  #externalAccountOps: ExternalAccountOps = {}

  accountsOps: {
    [sessionId: string]: {
      result: AccountsOps
      filters: Filters
      pagination: Pagination
    }
  } = {}

  #signedMessages: InternalSignedMessages = {}

  signedMessages: {
    [sessionId: string]: {
      result: MessagesToBeSigned
      filters: Filters
      pagination: Pagination
    }
  } = {}

  #providers: IProvidersController

  #networks: INetworksController

  #portfolio: IPortfolioController

  #safe: ISafeController

  #onContractsDeployed: (network: Network) => Promise<void>

  #callRelayer: Function

  #bannersByAccount: Map<string, Banner[]> = new Map()

  #updateAccountsOpsStatusesPromises: {
    [accountAddr: string]:
      | Promise<{
          shouldEmitUpdate: boolean
          // Which networks require a portfolio update?
          chainsToUpdate: Network['chainId'][]
          portfoliosToUpdate: PortfoliosToUpdate
          updatedAccountsOps: SubmittedAccountOp[]
          newestOpTimestamp: number
          shouldFetchSafeTxns: boolean
        }>
      | undefined
  } = {}

  #backfillAccountOpBalanceChangesPromises: {
    [key: string]: Promise<void> | undefined
  } = {}

  #addExternalAccountOpQueue: Promise<void> = Promise.resolve()

  constructor(
    storage: IStorageController,
    fetch: Fetch,
    callRelayer: Function,
    accounts: IAccountsController,
    selectedAccount: ISelectedAccountController,
    providers: IProvidersController,
    networks: INetworksController,
    portfolio: IPortfolioController,
    safe: ISafeController,
    onContractsDeployed: (network: Network) => Promise<void>,
    eventEmitterRegistry?: IEventEmitterRegistryController
  ) {
    super(eventEmitterRegistry)
    this.#storage = storage
    this.#fetch = fetch

    // Initialize ActivityIdbStorage if available (browser environment)
    if (!DISABLE_ACTIVITY_IDB && typeof indexedDB !== 'undefined') {
      try {
        this.#activityIdb = new ActivityIdbStorage()
        console.log('[ActivityController] ActivityIdbStorage initialized')
      } catch (error) {
        console.error('[ActivityController] Failed to initialize ActivityIdbStorage', error)
      }
    }

    this.#callRelayer = callRelayer
    this.#accounts = accounts
    this.#selectedAccount = selectedAccount
    this.#providers = providers
    this.#networks = networks
    this.#portfolio = portfolio
    this.#safe = safe
    this.#onContractsDeployed = onContractsDeployed
    this.#initialLoadPromise = this.#load().finally(() => {
      this.#initialLoadPromise = undefined
    })
  }

  async #load(): Promise<void> {
    await this.#accounts.initialLoadPromise
    await this.#selectedAccount.initialLoadPromise

    let accountsOps: InternalAccountsOps = {}
    let externalAccountOps: ExternalAccountOps = {}
    let signedMessages: InternalSignedMessages = {}

    // Migrate from chrome.storage.local to IDB if needed (first load)
    if (this.#activityIdb) {
      try {
        const idbIsEmpty = await this.#activityIdb.isEmpty()
        if (idbIsEmpty) {
          const storedOps = await this.#storage.get('accountsOps', {})
          if (Object.keys(storedOps).length > 0) {
            console.log('[ActivityController] Migrating accountsOps to IDB')
            await this.#activityIdb.migrateFromStorage(storedOps)
            console.log('[ActivityController] accountsOps migration complete')
          }
        }
      } catch (error) {
        console.error('[ActivityController] Failed to migrate to IDB', error)
      }
    }

    // Load from IDB or fallback to storage
    if (this.#activityIdb) {
      try {
        console.time('[ActivityController] startup-load:idb')
        accountsOps = await this.#activityIdb.loadStartupOps()
        console.timeEnd('[ActivityController] startup-load:idb')
      } catch (error) {
        console.error('[ActivityController] Failed to load from IDB, falling back to storage', error)
        console.time('[ActivityController] startup-load:storage-fallback')
        accountsOps = await this.#storage.get('accountsOps', {})
        console.timeEnd('[ActivityController] startup-load:storage-fallback')
      }
    } else {
      console.time('[ActivityController] startup-load:storage')
      accountsOps = await this.#storage.get('accountsOps', {})
      console.timeEnd('[ActivityController] startup-load:storage')
    }

    // Always load externalAccountOps from storage (not migrated to IDB yet)
    [externalAccountOps, signedMessages] = await Promise.all([
      this.#storage.get('externalAccountOps', {}),
      this.#storage.get('signedMessages', {})
    ])

    this.#accountsOps = accountsOps
    this.#externalAccountOps = externalAccountOps
    this.#signedMessages = signedMessages
    this.emitUpdate()
  }

  /**
   * Checks if there are any account operations that were sent to a specific address.
   * Returns history metadata plus an optional poisoning match for first-time recipients.
   */
  async hasAccountOpsSentTo(
    toAddress: string, // the address to check for received transactions
    accountId: AccountId // the account ID to filter operations from
  ): Promise<{
    found: boolean
    lastTransactionDate: Date | null
    addressPoisoningMatch: AddressPoisoningMatch | null
  }> {
    await this.#initialLoadPromise
    if (!toAddress) return { found: false, lastTransactionDate: null, addressPoisoningMatch: null }

    const accounts = accountId ? [accountId] : Object.keys(this.#accountsOps)
    let found = false
    let lastTimestamp: number | null = null
    const normalizedToAddress = toAddress.toLowerCase()
    let bestPoisoningMatch: ScoredAddressPoisoningMatch | null = null

    const updatePoisoningMatch = (address: string, lastInteractedAt: number | null = null) => {
      const matchCounts = getAddressPoisoningMatchCounts(toAddress, address)

      if (!matchCounts) return

      bestPoisoningMatch = pickBetterPoisoningMatch(bestPoisoningMatch, {
        matchedAddress: address,
        matchedPrefixCharsCount: matchCounts.matchedPrefixCharsCount,
        matchedSuffixCharsCount: matchCounts.matchedSuffixCharsCount,
        lastInteractedAt
      })
    }

    // Address poisoning compares the new recipient only against recipients from
    // this account's historical account ops below.
    accounts.forEach((account) => {
      const accountOpsOfAccount = this.#accountsOps[account]
      if (!accountOpsOfAccount) return
      const networks = Object.keys(accountOpsOfAccount)
      networks.forEach((network) => {
        const networkAccountOpsOfAccount = accountOpsOfAccount[network]
        if (!networkAccountOpsOfAccount) return
        networkAccountOpsOfAccount.forEach((op) => {
          const recipients = getAccountOpRecipients(op)
          const hasSentToRecipient = recipients.some((recipient) => {
            if (recipient.toLowerCase() === normalizedToAddress) return true

            // Poisoning checks are needed only for first-time sends. As soon as
            // we know the recipient was used before, skip this extra work.
            if (!found) updatePoisoningMatch(recipient, op.timestamp)

            return false
          })

          if (hasSentToRecipient) {
            found = true

            if (!lastTimestamp || op.timestamp > lastTimestamp) {
              lastTimestamp = op.timestamp
            }
          }
        })
      })
    })

    let addressPoisoningMatch: AddressPoisoningMatch | null = null
    if (!found && bestPoisoningMatch) {
      const currentBestPoisoningMatch = bestPoisoningMatch as ScoredAddressPoisoningMatch
      addressPoisoningMatch = {
        matchedAddress: currentBestPoisoningMatch.matchedAddress,
        matchedPrefixCharsCount: currentBestPoisoningMatch.matchedPrefixCharsCount,
        matchedSuffixCharsCount: currentBestPoisoningMatch.matchedSuffixCharsCount
      }
    }

    return {
      found,
      lastTransactionDate: lastTimestamp ? new Date(lastTimestamp) : null,
      addressPoisoningMatch
    }
  }

  async filterAccountsOps(
    sessionId: string,
    filters: Filters,
    pagination: Pagination = { fromPage: 0, itemsPerPage: 10 }
  ) {
    await this.#initialLoadPromise
    this.#externalAccountOps = await this.#storage.get(
      'externalAccountOps',
      this.#externalAccountOps
    )

    const enabledNetworkChainIds = this.#networks.networks.map(({ chainId }) => String(chainId))
    let internalAccountOpsByChain = this.#accountsOps[filters.account] || {}
    const externalAccountOpsByChain = this.#externalAccountOps[filters.account] || {}

    console.log('[ActivityController] filterAccountsOps called', {
      account: filters.account,
      chainId: filters.chainId?.toString(),
      page: pagination.fromPage,
      knownAccounts: Object.keys(this.#accountsOps),
      internalChains: Object.entries(internalAccountOpsByChain).map(
        ([c, ops]) => `${c}:${ops.length}ops`
      ),
      externalChains: Object.entries(externalAccountOpsByChain).map(
        ([c, ops]) => `${c}:${ops.length}ops`
      ),
      enabledNetworkChainIds
    })

    // Lazy-load from IDB if requesting pages beyond the in-memory window and IDB is available.
    // Skip if in-memory already holds the full history (>= STARTUP_RECENT_OPS_LIMIT means it was
    // previously expanded, so a second IDB round-trip would return the same data).
    const chainIdString = filters.chainId?.toString()
    const inMemoryCount = chainIdString
      ? (internalAccountOpsByChain[chainIdString]?.length ?? 0)
      : 0
    // IDB startup window loads 20 ops per chain; more than that means the cache was already expanded.
    // Lazy-load whenever a chain filter is active and the cache is still in the startup window —
    // including page 0, so the correct total page count is shown immediately on chain switch.
    const idbStartupWindowSize = 20
    const alreadyFullyLoaded = inMemoryCount > idbStartupWindowSize
    if (this.#activityIdb && filters.chainId && chainIdString && !alreadyFullyLoaded) {
      try {
        console.time(`[ActivityController] lazy-load:idb page=${pagination.fromPage}`)
        const fullOpsFromIdb = await this.#activityIdb.getOpsForAccountAndChain(
          filters.account,
          filters.chainId
        )
        console.timeEnd(`[ActivityController] lazy-load:idb page=${pagination.fromPage}`)
        if (fullOpsFromIdb) {
          console.log(
            `[ActivityController] lazy-load: in-memory had ${inMemoryCount} ops → IDB returned ${fullOpsFromIdb.length} ops for ${filters.account}:${chainIdString}`
          )
          // Update in-memory cache with full array from IDB
          if (!internalAccountOpsByChain[chainIdString]) {
            internalAccountOpsByChain[chainIdString] = []
          }
          internalAccountOpsByChain[chainIdString] = fullOpsFromIdb
          this.#accountsOps[filters.account] = internalAccountOpsByChain
        }
      } catch (error) {
        console.error('ActivityController: Failed to lazy-load from IDB', error)
        // Continue with in-memory data
      }
    } else {
      console.log(
        `[ActivityController] pagination page=${pagination.fromPage}: served from in-memory (${inMemoryCount} ops cached)`
      )
    }

    const internalAccountOpsEntriesOnEnabledNetworks = Object.entries(
      internalAccountOpsByChain
    ).filter(([chainId]) => enabledNetworkChainIds.includes(chainId))
    const internalAccountOps = new Set(
      internalAccountOpsEntriesOnEnabledNetworks.flatMap(([, accountOps]) => accountOps)
    )

    // Build a set of all txnIds from internal ops for dedup at the merge point.
    // External ops whose txnId matches an internal op are filtered out here — they are
    // duplicates that #removeExternalAccountOpsMatchingInternalOps missed because the
    // internal op was outside the startup window when the scanner ran.
    const internalTxnIds = new Set(
      [...internalAccountOps].flatMap((op) => getInternalAccountOpTxnIds(op).map(normalizeTxnId))
    )

    const accountOpsEntriesOnEnabledNetworks = enabledNetworkChainIds
      .map(
        (chainId) =>
          [
            chainId,
            [
              ...(internalAccountOpsByChain[chainId] || []),
              ...(externalAccountOpsByChain[chainId] || []).filter(
                (extOp) => !extOp.txnId || !internalTxnIds.has(normalizeTxnId(extOp.txnId))
              )
            ]
          ] as const
      )
      .filter(([, accountOps]) => accountOps.length)
    let filteredItems: SubmittedAccountOpLike[]

    if (filters.chainId && enabledNetworkChainIds.includes(String(filters.chainId))) {
      filteredItems = [
        ...(accountOpsEntriesOnEnabledNetworks.find(
          ([chainId]) => chainId === String(filters.chainId)
        )?.[1] || [])
      ]
    } else {
      filteredItems = accountOpsEntriesOnEnabledNetworks.flatMap(([, accountOps]) => accountOps)
    }

    // By default, account ops are grouped by network and sorted in descending order.
    // However, when internal and external ops are mixed, they need a final sort even
    // when a network filter is present.
    filteredItems.sort((a, b) => b.timestamp - a.timestamp)

    // for benzin fetching
    if (filters.identifiedBy) {
      filteredItems = filteredItems.filter(
        (i) => i.identifiedBy && i.identifiedBy.identifier === filters.identifiedBy!.identifier
      )
    }

    console.time(`[ActivityController] paginate page=${pagination.fromPage}`)
    const result = paginate(filteredItems, pagination.fromPage, pagination.itemsPerPage)
    console.timeEnd(`[ActivityController] paginate page=${pagination.fromPage}`)
    console.log(
      `[ActivityController] paginate: ${filteredItems.length} total ops → page ${pagination.fromPage} has ${result.items.length} items (${result.maxPages} pages total)`
    )

    this.setDashboardBannersSeen(sessionId, filters.account)
    this.accountsOps[sessionId] = { result, filters, pagination }

    this.emitUpdate()

    // find ops with no balance changes recorded and backfill them;
    // no need to console.log anything in the catch statement here
    // as error handling is handled in backfillAccountOpBalanceChangesAndPersist.
    const opsWithNoBalanceChanges = result.items.filter(
      (op): op is SubmittedAccountOp =>
        internalAccountOps.has(op as SubmittedAccountOp) &&
        op.status !== AccountOpStatus.BroadcastedButNotConfirmed &&
        op.balanceChanges === undefined
    )
    if (opsWithNoBalanceChanges.length)
      this.backfillAccountOpBalanceChangesAndPersist(opsWithNoBalanceChanges).catch(() => null)
  }

  setDashboardBannersSeen(
    sessionId: string,
    accountAddr: string,
    params?: {
      accountOpIds?: SubmittedAccountOp['id'][]
      emitUpdate?: boolean
      /**
       * When true, the banners are hidden immediately, instead of awaiting the user
       * to leave the screen
       */
      hideImmediately?: boolean
    }
  ) {
    const { accountOpIds, emitUpdate, hideImmediately } = params || {}
    if (!sessionId.startsWith('dashboard')) return

    const prevBanners = this.#bannersByAccount.get(accountAddr)
    if (!prevBanners) return

    let updatedBanners = prevBanners.map((b) => {
      if (
        b.category === 'failed-acc-ops' &&
        (!accountOpIds ||
          (b.meta?.accountOpsDataForNextUpdate &&
            b.meta.accountOpsDataForNextUpdate.length === 1 &&
            b.meta.accountOpsDataForNextUpdate.some((opData) => accountOpIds.includes(opData.id))))
      ) {
        return { ...b, meta: { ...b.meta, seen: true } }
      }

      return b
    })

    if (hideImmediately) {
      updatedBanners = updatedBanners.filter((b) => !b.meta?.seen)
    }

    this.#bannersByAccount.set(accountAddr, updatedBanners)

    if (emitUpdate) this.emitUpdate()
  }

  // Reset filtered AccountsOps session.
  // Example: when a FE component is being unmounted, we don't need anymore the filtered accounts ops and we
  // free the memory calling this method.
  resetAccountsOpsFilters(sessionId: string, skipEmit?: boolean) {
    if (!this.accountsOps[sessionId]) return

    if (sessionId.startsWith('dashboard')) {
      if (this.#selectedAccount.account) {
        const { addr } = this.#selectedAccount.account
        const banners = this.#bannersByAccount.get(addr)
        if (banners) {
          const filtered = banners.filter((b) => !(b.category === 'failed-acc-ops' && b.meta?.seen))
          this.#bannersByAccount.set(addr, filtered)
        }
      }
    }

    delete this.accountsOps[sessionId]

    if (!skipEmit) this.emitUpdate()
  }

  // Everytime we add/remove an AccOp, we should run this method in order to keep the filtered and internal accounts ops in sync.
  private async syncFilteredAccountsOps() {
    const promises = Object.keys(this.accountsOps).map(async (sessionId) => {
      await this.filterAccountsOps(
        sessionId,
        this.accountsOps[sessionId]!.filters,
        this.accountsOps[sessionId]!.pagination
      )
    })

    await Promise.all(promises)
  }

  /**
   * Writes accountsOps via IDB if available, otherwise falls back to chrome.storage.local.
   * When IDB is available, errors are logged but do NOT fall back to storage — writing
   * this.#accountsOps (startup subset) to storage would permanently truncate full history.
   */
  async #persistToIdb(fn: () => Promise<void>): Promise<void> {
    if (!this.#activityIdb) {
      await this.#storage.set('accountsOps', this.#accountsOps)
      return
    }
    try {
      await fn()
    } catch (error) {
      console.error('ActivityController: Failed to persist to IDB', error)
    }
  }

  /**
   * Persist changed ops to IDB (or storage fallback), sync filtered views, and emit an update.
   */
  private async persistAccountsOps(changedOps: SubmittedAccountOp[]) {
    await this.#persistToIdb(() => this.#activityIdb!.updateOps(changedOps))
    await this.syncFilteredAccountsOps()
    this.emitUpdate()
  }

  /**
   * We could have this case:
   * 1. We have a BroadcastedButNotConfirmed account op with an accountOp.txnId that's not the final, confirmed txnId
   * 2. While we have this pending account op, getLogs() finds the confirmed transactions. Its txnId differs from the BroadcastedButNotConfirmed accountOp, so it gets added successfully, skipping the duplication guard
   * 3. The BroadcastedButNotConfirmed loop completes, changes the accountOp.txnId to the real one, but it's too late as the externalAccountOp has already been added.
   * That's why we're running back and cleaning up already added externalAccountOps with the same txnId
   */
  async #removeExternalAccountOpsMatchingInternalOps(accountOps: SubmittedAccountOp[]) {
    let hasRemovedExternalAccountOps = false

    accountOps.filter(isAccountOpFinalized).forEach((accountOp) => {
      const externalAccountOpsAccountKey = getAccountOpsAccountKey(
        this.#externalAccountOps,
        accountOp.accountAddr
      )
      if (!externalAccountOpsAccountKey) return

      const chainIdString = accountOp.chainId.toString()
      const externalAccountOps =
        this.#externalAccountOps[externalAccountOpsAccountKey]?.[chainIdString]
      if (!externalAccountOps?.length) return

      const internalTxnIds = new Set(
        getInternalAccountOpTxnIds(accountOp).map((txnId) => normalizeTxnId(txnId))
      )
      if (!internalTxnIds.size) return

      const filteredExternalAccountOps = externalAccountOps.filter((externalAccountOp) => {
        const externalTxnId = normalizeTxnId(externalAccountOp.txnId)
        return !externalTxnId || !internalTxnIds.has(externalTxnId)
      })

      if (filteredExternalAccountOps.length === externalAccountOps.length) return

      this.#externalAccountOps[externalAccountOpsAccountKey]![chainIdString] =
        filteredExternalAccountOps
      hasRemovedExternalAccountOps = true
    })

    if (hasRemovedExternalAccountOps)
      await this.#storage.set('externalAccountOps', this.#externalAccountOps)
  }

  async filterSignedMessages(
    sessionId: string,
    filters: Filters,
    pagination: Pagination = { fromPage: 0, itemsPerPage: 10 }
  ) {
    await this.#initialLoadPromise

    const filteredItems = this.#signedMessages[filters.account] || []

    const result = paginate(filteredItems, pagination.fromPage, pagination.itemsPerPage)

    this.signedMessages[sessionId] = {
      result,
      filters,
      pagination
    }

    this.emitUpdate()
  }

  // Reset filtered Messages session.
  // Example: when a FE component is being unmounted, we don't need anymore the filtered messages and we
  // free the memory calling this method.
  resetSignedMessagesFilters(sessionId: string) {
    delete this.signedMessages[sessionId]
    this.emitUpdate()
  }

  // Everytime we add/remove a Message, we should run this method in order to keep the filtered and internal messages in sync.
  private async syncSignedMessages() {
    const promises = Object.keys(this.signedMessages).map(async (sessionId) => {
      await this.filterSignedMessages(
        sessionId,
        this.signedMessages[sessionId]!.filters,
        this.signedMessages[sessionId]!.pagination
      )
    })

    await Promise.all(promises)
  }

  removeNetworkData(chainId: bigint) {
    Object.keys(this.accountsOps).forEach(async (sessionId) => {
      const state = this.accountsOps[sessionId]
      const isFilteredByRemovedNetwork = state?.filters.chainId === chainId

      if (isFilteredByRemovedNetwork) {
        await this.filterAccountsOps(
          sessionId,
          { account: state.filters.account },
          state.pagination
        )
      }
    })
  }

  async addAccountOp(accountOp: SubmittedAccountOp) {
    await this.#initialLoadPromise

    const { accountAddr, chainId } = accountOp

    if (!this.#accountsOps[accountAddr]) this.#accountsOps[accountAddr] = {}
    if (!this.#accountsOps[accountAddr][chainId.toString()])
      this.#accountsOps[accountAddr][chainId.toString()] = []

    // Capture the oldest op's id before mutating — it becomes the trimmed id if the
    // group is already at capacity (trim() removes exactly one op via .pop()).
    const group = this.#accountsOps[accountAddr][chainId.toString()]!
    const trimmedId = group.length >= 1000 ? group[group.length - 1]?.id : undefined

    // newest SubmittedAccountOp goes first in the list
    group.unshift({ ...accountOp })
    trim(group)

    await this.syncFilteredAccountsOps()
    this.emitUpdate()

    await this.#persistToIdb(() =>
      this.#activityIdb!.putSingleOp(accountAddr, chainId, accountOp, trimmedId)
    )
  }

  async addExternalAccountOp({
    accountAddr,
    chainId,
    txnId,
    receipt,
    callId,
    shouldLearnTokens = false
  }: AddExternalAccountOpParams) {
    const task = this.#addExternalAccountOpQueue
      .catch(() => undefined) // errors handled inside
      .then(() =>
        this.#addExternalAccountOp({
          accountAddr,
          chainId,
          txnId,
          receipt,
          callId,
          shouldLearnTokens
        })
      )

    // errors handled inside
    this.#addExternalAccountOpQueue = task.catch(() => undefined)

    return task
  }

  async #addExternalAccountOp({
    accountAddr,
    chainId,
    txnId,
    receipt,
    callId,
    shouldLearnTokens = false
  }: AddExternalAccountOpParams): Promise<void> {
    await this.#initialLoadPromise

    // a duplication guard
    const chainIdString = chainId.toString()
    const hasExistingAccountOpWithTxnId = () => {
      const internalAccountOps = getAccountOpsForAccountAndChain(
        this.#accountsOps,
        accountAddr,
        chainIdString
      )
      const existingExternalAccountOps = getAccountOpsForAccountAndChain(
        this.#externalAccountOps,
        accountAddr,
        chainIdString
      )

      return (
        internalAccountOps.some((accountOp) => internalAccountOpHasTxnId(accountOp, txnId)) ||
        existingExternalAccountOps.some((accountOp) => externalAccountOpHasTxnId(accountOp, txnId))
      )
    }

    if (hasExistingAccountOpWithTxnId()) return

    const network = this.#networks.networks.find((n) => n.chainId === chainId)
    const provider = this.#providers.providers[chainIdString]
    if (!network || !provider) {
      this.emitError({
        level: 'silent',
        message: `Network/provider not found for chainId: ${chainId}`,
        error: new Error(`Network/provider not found for chainId: ${chainId}`)
      })
      return
    }

    const [transaction, block] = await Promise.all([
      provider.getTransaction(txnId).catch(() => null),
      provider.getBlock(receipt.blockNumber).catch(() => null)
    ])

    const accountOpStatus = receipt.status === 0 ? AccountOpStatus.Failure : AccountOpStatus.Success
    const call: Call = {
      id: callId || `external-${txnId}`,
      to: transaction?.to || receipt.to || ZeroAddress,
      value: transaction?.value || 0n,
      data: transaction?.data || '0x',
      txnId: txnId as NonNullable<Call['txnId']>,
      status: accountOpStatus,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      gasUsed: receipt.gasUsed.toString()
    }

    const submittedAccountOpLike: SubmittedAccountOpLike = {
      id: `external-${txnId}`,
      accountAddr,
      chainId,
      calls: [call],
      gasFeePayment: null,
      txnId,
      status: accountOpStatus,
      activitySource: 'external',
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      gasUsed: receipt.gasUsed.toString(),
      timestamp: block?.timestamp ? block.timestamp * 1000 : Date.now(),
      identifiedBy: {
        type: 'Transaction',
        identifier: txnId
      }
    }

    try {
      const foundTokens = filterStaticBlacklistedAddrs(
        await getTransferLogTokens(receipt.logs, accountAddr),
        chainId
      )
      if (shouldLearnTokens) {
        const scamFilter = new ScamFilter({ fetch: this.#fetch, network })
        const tokensWithAPrice = await scamFilter.filterTokensWithoutAPrice(foundTokens)
        this.#portfolio.addTokensToBeLearned(tokensWithAPrice, chainId)
      }
      const tokenAddrs = getBalanceChangeTokenAddresses(foundTokens)

      submittedAccountOpLike.balanceChanges = await getAccountOpBalanceChanges({
        accountAddr,
        chainId,
        tokenAddrs,
        receiptBlockNumber: receipt.blockNumber,
        getTokenBalancesOnBlock: this.#portfolio.getTokenBalancesOnBlock.bind(this.#portfolio),
        receipts: [receipt as TransactionReceipt],
        debugTraceTransaction: getDebugTraceTransaction(
          network.chainId,
          this.#providers.providers[network.chainId.toString()]
        )
      })
    } catch {
      submittedAccountOpLike.balanceChanges = undefined
    }

    if (hasExistingAccountOpWithTxnId()) return

    if (!this.#externalAccountOps[accountAddr]) this.#externalAccountOps[accountAddr] = {}
    if (!this.#externalAccountOps[accountAddr]![chainIdString]) {
      this.#externalAccountOps[accountAddr]![chainIdString] = []
    }

    const externalAccountOps = this.#externalAccountOps[accountAddr]![chainIdString]!
    externalAccountOps.unshift(submittedAccountOpLike)
    trim(externalAccountOps)

    // externalAccountOps: using chrome.storage.local only (not migrated to IDB yet)
    await this.#storage.set('externalAccountOps', this.#externalAccountOps);
    await this.syncFilteredAccountsOps()
    this.emitUpdate()
  }

  async setAccountOpBalanceChanges(
    identifiedBy: AccountOpIdentifiedBy,
    accountAddr: string,
    chainId: bigint,
    balanceChanges: BalanceChange[] | Error
  ) {
    await this.#initialLoadPromise

    // get the latest instance just in case
    const accountOp = this.findByIdentifiedBy(identifiedBy, accountAddr, chainId)
    if (!accountOp) return

    // if the balanceChanges end up with an error,
    // we allow 3 retries before giving up on them and setting them to an
    // empty array
    if (balanceChanges instanceof Error) {
      const balanceChangesFetchRetryCount = accountOp.balanceChangesFetchRetryCount || 0
      accountOp.balanceChangesFetchRetryCount = balanceChangesFetchRetryCount + 1
      if (accountOp.balanceChangesFetchRetryCount >= 3) {
        accountOp.balanceChanges = []
      }
      return
    }

    accountOp.balanceChanges = balanceChanges
  }

  /**
   * Use this method for updates from the UI only
   * as we're persisting the state right after the operation
   */
  async backfillAccountOpBalanceChangesAndPersist(accountOps: SubmittedAccountOp[]) {
    await Promise.all(accountOps.map((accOp) => this.backfillAccountOpBalanceChanges(accOp)))
    await this.persistAccountsOps(accountOps)
  }

  /**
   * This method calculate the balanche changes and puts them in memory
   * as a reference to #accountOps only.
   * Use backfillAccountOpBalanceChangesAndPersist if you want to persist them.
   * We have this separation in order to persist to storage only after the
   * end of an operation
   */
  async backfillAccountOpBalanceChanges(accountOp: AccountOpBalanceChangesBackfillReference) {
    await this.#initialLoadPromise

    // take the latest #accountOp, not a stale one from the UI
    const currentAccountOp = this.findByIdentifiedBy(
      accountOp.identifiedBy,
      accountOp.accountAddr,
      accountOp.chainId
    )

    if (!currentAccountOp || typeof currentAccountOp.balanceChanges !== 'undefined') return

    const taskId = `${accountOp.accountAddr}:${accountOp.chainId.toString()}:${
      accountOp.identifiedBy.identifier
    }`

    if (this.#backfillAccountOpBalanceChangesPromises[taskId]) {
      return this.#backfillAccountOpBalanceChangesPromises[taskId]
    }

    this.#backfillAccountOpBalanceChangesPromises[taskId] = this.#prepareAndRunBalanceChangesTask(
      currentAccountOp
    ).finally(() => {
      this.#backfillAccountOpBalanceChangesPromises[taskId] = undefined
    })

    return this.#backfillAccountOpBalanceChangesPromises[taskId]
  }

  async #prepareAndRunBalanceChangesTask(accountOp: SubmittedAccountOp) {
    const hasReceipt =
      accountOp.status === AccountOpStatus.Success || accountOp.status === AccountOpStatus.Failure
    if (!hasReceipt || !accountOp.txnId) {
      // if the status is a status without a receipt, finish balance changes
      await this.setAccountOpBalanceChanges(
        accountOp.identifiedBy,
        accountOp.accountAddr,
        accountOp.chainId,
        []
      )

      return
    }

    const network = this.#networks.networks.find((n) => n.chainId === accountOp.chainId)
    const provider = this.#providers.providers[accountOp.chainId.toString()]

    // temp error, do not set balance changes to allow the system to retry
    if (!network || !provider) return

    try {
      const receipts = await getAccountOpReceipts(accountOp, provider)

      if (!receipts.length) {
        await this.setAccountOpBalanceChanges(
          accountOp.identifiedBy,
          accountOp.accountAddr,
          accountOp.chainId,
          new Error('no receipts found')
        )

        return
      }

      const tokenAddrs = await getBalanceChangeTokenAddrsFromReceipts(accountOp, receipts)
      const balanceChangeWindow = getBalanceChangeWindowFromReceipts(accountOp, receipts)

      if (!balanceChangeWindow) {
        await this.setAccountOpBalanceChanges(
          accountOp.identifiedBy,
          accountOp.accountAddr,
          accountOp.chainId,
          new Error('no receipts found')
        )

        return
      }

      await this.updateAccountOpBalanceChanges(
        accountOp,
        network,
        tokenAddrs,
        balanceChangeWindow.receiptBlockNumber,
        balanceChangeWindow.prevBlockNumber,
        receipts
      )
    } catch (error: any) {
      console.log(error)
      await this.setAccountOpBalanceChanges(
        accountOp.identifiedBy,
        accountOp.accountAddr,
        accountOp.chainId,
        error
      )
    }
  }

  async updateAccountsOpsStatuses(accountAddresses: string[] = []): Promise<
    Record<
      string,
      {
        shouldEmitUpdate: boolean
        chainsToUpdate: Network['chainId'][]
        portfoliosToUpdate: PortfoliosToUpdate
        updatedAccountsOps: SubmittedAccountOp[]
        newestOpTimestamp: number
        shouldFetchSafeTxns: boolean
      }
    >
  > {
    const selectedAddr = this.#selectedAccount.account?.addr
    // ensure ops are always updated for selected account if no addresses are passed
    const uniqueAddresses = Array.from(
      new Set([...accountAddresses, selectedAddr].filter(Boolean))
    ) as string[]
    const results = await Promise.all(
      uniqueAddresses.map(async (addr) => {
        if (this.#updateAccountsOpsStatusesPromises[addr])
          return [addr, await this.#updateAccountsOpsStatusesPromises[addr]] as const

        this.#updateAccountsOpsStatusesPromises[addr] = this.#updateAccountsOpsStatuses(
          addr
        ).finally(() => {
          this.#updateAccountsOpsStatusesPromises[addr] = undefined
        })

        const res = await this.#updateAccountsOpsStatusesPromises[addr]
        return [addr, res] as const
      })
    )

    return Object.fromEntries(results)
  }

  async #executeBalanceChanges(
    balanceChangesTasks: Array<{
      accountOp: SubmittedAccountOp
      network: Network
      tokenAddrs: string[]
      receiptBlockNumber: number
      prevBlockNumber?: number
      receipts?: BalanceChangesReceipt[]
    }>
  ) {
    if (balanceChangesTasks.length === 0) return

    await Promise.all(
      balanceChangesTasks.map(
        ({ accountOp, network, tokenAddrs, receiptBlockNumber, prevBlockNumber, receipts }) =>
          this.updateAccountOpBalanceChanges(
            accountOp,
            network,
            tokenAddrs,
            receiptBlockNumber,
            prevBlockNumber,
            receipts
          )
      )
    )
    await this.persistAccountsOps(balanceChangesTasks.map((t) => t.accountOp))
  }

  /**
   * Update AccountsOps statuses (inner and public state, and storage)
   *
   * Here is the algorithm:
   * 0. Once we broadcast an AccountOp, we are adding it to ActivityController via `addAccountOp`,
   * and are setting its status to AccountOpStatus.BroadcastedButNotConfirmed.
   * 1. Here, we firstly rely on `getTransactionReceipt` for determining the status (success or failure).
   * 2. If we don't manage to determine its status, we are comparing AccountOp and Account nonce.
   * If Account nonce is greater than AccountOp, then we know that AccountOp has past nonce (AccountOpStatus.UnknownButPastNonce).
   */
  async #updateAccountsOpsStatuses(accountAddr: string): Promise<{
    shouldEmitUpdate: boolean
    // Which networks require a portfolio update?
    chainsToUpdate: Network['chainId'][]
    updatedAccountsOps: SubmittedAccountOp[]
    newestOpTimestamp: number
    portfoliosToUpdate: PortfoliosToUpdate
    shouldFetchSafeTxns: boolean
  }> {
    await this.#initialLoadPromise

    if (!this.#accountsOps[accountAddr])
      return {
        shouldEmitUpdate: false,
        chainsToUpdate: [],
        updatedAccountsOps: [],
        portfoliosToUpdate: {},
        newestOpTimestamp: 0,
        shouldFetchSafeTxns: false
      }

    // This flag tracks the changes to AccountsOps statuses
    // and optimizes the number of the emitted updates and storage/state updates.
    let shouldEmitUpdate = false

    const chainsToUpdate = new Set<Network['chainId']>()
    const portfoliosToUpdate: PortfoliosToUpdate = {}
    const updatedAccountsOps: SubmittedAccountOp[] = []
    const balanceChangesTasks: Array<{
      accountOp: SubmittedAccountOp
      network: Network
      tokenAddrs: string[]
      receiptBlockNumber: number
      prevBlockNumber?: number
      receipts?: BalanceChangesReceipt[]
    }> = []

    // we should fetch Safe txns again upon failure
    let shouldFetchSafeTxns = false

    // Use this flag to make the auto-refresh slower with the passege of time.
    // implementation is in background.ts
    let newestOpTimestamp: number = 0

    // Limit the number of iterations to optimize the performance on accounts with large transaction history
    const MAX_OPS_TO_ITERATE_PER_CHAIN = 50

    await Promise.all(
      Object.keys(this.#accountsOps[accountAddr]).map(async (keyAsChainId) => {
        const network = this.#networks.networks.find((n) => n.chainId.toString() === keyAsChainId)
        if (!network) return
        const provider = this.#providers.providers[network.chainId.toString()]
        if (!provider) return

        const allOps = this.#accountsOps[accountAddr]![network.chainId.toString()]

        if (!allOps || !allOps.length) return

        const recentOps = Array.isArray(allOps) ? allOps.slice(0, MAX_OPS_TO_ITERATE_PER_CHAIN) : []
        const opsToUpdate = recentOps.filter(
          (op) => op.status === AccountOpStatus.BroadcastedButNotConfirmed
        )
        const confirmedOps = allOps.filter(
          (op) => op.status === AccountOpStatus.Success || op.status === AccountOpStatus.Failure
        )

        return Promise.all(
          opsToUpdate.map(async (accountOp) => {
            shouldEmitUpdate = true
            let firstReceiptBlockNumber: number | undefined
            let lastReceiptBlockNumber: number | undefined
            let shouldScheduleBalanceChangesTask = false
            const foundTokensForBalanceChanges = new Set<string>()
            const receiptsForBalanceChanges: BalanceChangesReceipt[] = []

            if (newestOpTimestamp === undefined || newestOpTimestamp < accountOp.timestamp) {
              newestOpTimestamp = accountOp.timestamp
            }

            const declareStuckIfFiveMinsPassed = async (op: SubmittedAccountOp) => {
              if (hasTimePassedSinceBroadcast(op, 5)) {
                const updatedOpIfAny = updateOpStatus(accountOp, AccountOpStatus.BroadcastButStuck)
                if (updatedOpIfAny) {
                  updatedAccountsOps.push(updatedOpIfAny)
                  const acc = this.#accounts.accounts.find((a) => a.addr === op.accountAddr)
                  if (acc && !!acc.safeCreation) {
                    await this.#safe.unresolve(op.nonce).catch((e) => e)
                    shouldFetchSafeTxns = true
                  }
                }
              }
            }

            const hasConfirmedOpWithSameEoaNonce =
              accountOp.eoaNonce !== null &&
              typeof accountOp.eoaNonce !== 'undefined' &&
              confirmedOps.some((op) => op !== accountOp && op.eoaNonce === accountOp.eoaNonce)

            if (hasConfirmedOpWithSameEoaNonce) {
              const updatedOpIfAny = updateOpStatus(accountOp, AccountOpStatus.UnknownButPastNonce)
              if (updatedOpIfAny) updatedAccountsOps.push(updatedOpIfAny)
              return
            }

            const txIds = []
            if (accountOp.identifiedBy.type !== 'MultipleTxns') {
              const fetchTxnIdResult = await fetchTxnId(
                accountOp.identifiedBy,
                network,
                this.#callRelayer,
                accountOp
              )
              if (fetchTxnIdResult.status === 'rejected') {
                const updatedOpIfAny = updateOpStatus(accountOp, AccountOpStatus.Rejected)
                if (updatedOpIfAny) updatedAccountsOps.push(updatedOpIfAny)
                return
              }
              if (fetchTxnIdResult.status === 'not_found') {
                await declareStuckIfFiveMinsPassed(accountOp)
                return
              }

              const txnId = fetchTxnIdResult.txnId as string

              accountOp.txnId = txnId
              txIds.push(txnId)
            } else {
              const limit = !provider.batchMaxCount || provider.batchMaxCount > 1 ? 100 : 3
              txIds.push(
                ...accountOp.calls
                  .filter((call) => !!call.status && call.txnId)
                  .map((call) => call.txnId)
                  .slice(0, limit)
              )
            }

            try {
              const receipts = await Promise.all(
                // no catch, throw an error if one promise doesn't complete
                txIds.map((txnId) => (txnId ? provider.getTransactionReceipt(txnId) : null))
              )
              for (let i = 0; i < receipts.length; i++) {
                let receipt = receipts[i]
                const txnId = txIds[i]
                if (receipt) {
                  // if the status is a failure and it's an userOp, it means it
                  // could've been front ran. We need to make sure we find the
                  // transaction that has succeeded
                  if (
                    !receipt.status &&
                    isIdentifiedByUserOpHash(accountOp.identifiedBy) &&
                    txnId
                  ) {
                    const frontRanTxnId = await fetchFrontRanTxnId(
                      accountOp.identifiedBy,
                      txnId,
                      network
                    )

                    accountOp.txnId = frontRanTxnId

                    receipt = await provider.getTransactionReceipt(frontRanTxnId)
                    if (!receipt) return
                  }

                  if (typeof firstReceiptBlockNumber === 'undefined') {
                    firstReceiptBlockNumber = receipt.blockNumber
                  }
                  lastReceiptBlockNumber = receipt.blockNumber
                  receiptsForBalanceChanges.push({
                    logs: receipt.logs,
                    hash: receipt.hash,
                    from: receipt.from,
                    gasUsed: receipt.gasUsed,
                    gasPrice: receipt.gasPrice
                  })

                  // if this is an user op, we have to check the logs
                  let isSuccess: boolean | undefined
                  if (isIdentifiedByUserOpHash(accountOp.identifiedBy)) {
                    const userOpEventLog = parseLogs(
                      receipt.logs,
                      accountOp.identifiedBy.identifier
                    )
                    if (userOpEventLog) isSuccess = userOpEventLog.success
                  }

                  // if it's not an userOp or it is, but isSuccess was not found
                  if (isSuccess === undefined) isSuccess = !!receipt.status

                  const updatedOpIfAny = updateOpStatus(
                    accountOp,
                    isSuccess ? AccountOpStatus.Success : AccountOpStatus.Failure,
                    receipt
                  )
                  if (updatedOpIfAny) updatedAccountsOps.push(updatedOpIfAny)
                  if (
                    updatedOpIfAny &&
                    (updatedOpIfAny.status === AccountOpStatus.Success ||
                      updatedOpIfAny.status === AccountOpStatus.Failure)
                  ) {
                    shouldScheduleBalanceChangesTask = true
                  }

                  if (accountOp.isSingletonDeploy && receipt.status) {
                    await this.#onContractsDeployed(network)
                  }

                  if (!isSuccess) {
                    // if the txn resulted in a failure, unresolve all Safe txns
                    // with the same nonce so that the user can retry
                    const acc = this.#accounts.accounts.find(
                      (a) => a.addr === accountOp.accountAddr
                    )
                    if (acc && !!acc.safeCreation) {
                      await this.#safe.unresolve(accountOp.nonce).catch((e) => e)
                      shouldFetchSafeTxns = true
                    }
                  }

                  const foundTokens = isSuccess
                    ? filterStaticBlacklistedAddrs(
                        await getTransferLogTokens(receipt.logs, accountOp.accountAddr),
                        accountOp.chainId
                      )
                    : []
                  if (foundTokens.length)
                    this.#portfolio.addTokensToBeLearned(foundTokens, accountOp.chainId)
                  foundTokens.forEach((tokenAddr) => foundTokensForBalanceChanges.add(tokenAddr))

                  accountOp.blockNumber = receipt.blockNumber

                  accountOp.blockHash = receipt.blockHash

                  accountOp.gasUsed = toBeHex(receipt.gasUsed)

                  // Add accounts that are recipients of the AccountOp
                  const accountOpRecipients = getAccountOpRecipients(
                    accountOp,
                    this.#accounts.accounts.map((a) => a.addr)
                  )

                  accountOpRecipients.forEach((accAddr) => {
                    if (!portfoliosToUpdate[accAddr]) portfoliosToUpdate[accAddr] = []

                    portfoliosToUpdate[accAddr].push(network.chainId)
                  })

                  // update the chain if a receipt has been received as otherwise, we're
                  // left hanging with a pending portfolio balance
                  chainsToUpdate.add(network.chainId)

                  continue
                }

                // if there's no receipt, confirm there's a txn
                // if there's no txn and 15 minutes have passed, declare it a failure

                const txn = txnId ? await provider.getTransaction(txnId) : null

                if (txn) continue
                await declareStuckIfFiveMinsPassed(accountOp)
              }
            } catch {
              this.emitError({
                level: 'silent',
                message: `Failed to determine transaction status on network with id ${accountOp.chainId} for ${accountOp.txnId}.`,
                error: new Error(
                  `activity: failed to get transaction receipt for ${accountOp.txnId}`
                )
              })
            }

            if (shouldScheduleBalanceChangesTask && typeof lastReceiptBlockNumber !== 'undefined') {
              balanceChangesTasks.push({
                accountOp,
                network,
                tokenAddrs: getBalanceChangeTokenAddresses(
                  Array.from(foundTokensForBalanceChanges),
                  accountOp.chainId
                ),
                receiptBlockNumber: lastReceiptBlockNumber,
                prevBlockNumber:
                  isIdentifiedByMultipleTxn(accountOp.identifiedBy) &&
                  typeof firstReceiptBlockNumber !== 'undefined'
                    ? getPreviousBlockNumber(firstReceiptBlockNumber)
                    : undefined,
                receipts: receiptsForBalanceChanges
              })
            }
          })
        )
      })
    )

    // if there are balanceChangesTasks, shouldEmitUpdate will be true
    // so they will get saved
    if (shouldEmitUpdate) {
      // remove duplicates if encountered during a race condition
      await this.#removeExternalAccountOpsMatchingInternalOps(updatedAccountsOps)
      await this.persistAccountsOps(updatedAccountsOps)
    }

    // record the balance changes but do not await them
    // no need to console.log errors in the catch() as it's handled inside
    this.#executeBalanceChanges(balanceChangesTasks).catch(() => null)

    return {
      shouldEmitUpdate,
      chainsToUpdate: Array.from(chainsToUpdate),
      updatedAccountsOps,
      portfoliosToUpdate,
      newestOpTimestamp,
      shouldFetchSafeTxns
    }
  }

  async updateAccountOpBalanceChanges(
    accountOp: SubmittedAccountOp,
    network: Network,
    tokenAddrs: string[],
    receiptBlockNumber: number,
    prevBlockNumber?: number,
    receipts?: BalanceChangesReceipt[]
  ) {
    await this.#initialLoadPromise

    try {
      if (accountOp.chainId !== network.chainId) {
        throw new Error(
          `Cannot update balance changes for ${accountOp.identifiedBy.identifier}: network mismatch`
        )
      }

      const balanceChanges = await getAccountOpBalanceChanges({
        accountAddr: accountOp.accountAddr,
        chainId: accountOp.chainId,
        tokenAddrs,
        receiptBlockNumber,
        getTokenBalancesOnBlock: this.#portfolio.getTokenBalancesOnBlock.bind(this.#portfolio),
        prevBlockNumber,
        receipts,
        debugTraceTransaction: getDebugTraceTransaction(
          network.chainId,
          this.#providers.providers[network.chainId.toString()]
        )
      })

      await this.setAccountOpBalanceChanges(
        accountOp.identifiedBy,
        accountOp.accountAddr,
        accountOp.chainId,
        balanceChanges
      )

      return balanceChanges
    } catch (error: any) {
      console.log(error)
      await this.setAccountOpBalanceChanges(
        accountOp.identifiedBy,
        accountOp.accountAddr,
        accountOp.chainId,
        error
      )

      return []
    }
  }

  async addSignedMessage(signedMessage: SignedMessage, account: string) {
    await this.#initialLoadPromise

    if (!this.#signedMessages[account]) this.#signedMessages[account] = []

    // newest SignedMessage goes first in the list
    this.#signedMessages[account].unshift(signedMessage)
    trim(this.#signedMessages[account])
    await this.syncSignedMessages()

    await this.#storage.set('signedMessages', this.#signedMessages)
    this.emitUpdate()
  }

  async removeAccountData(address: Account['addr']) {
    await this.#initialLoadPromise

    delete this.#accountsOps[address]
    delete this.#signedMessages[address]

    await this.syncFilteredAccountsOps()
    await this.syncSignedMessages()

    // Delete from IDB if available
    if (this.#activityIdb) {
      try {
        await this.#activityIdb.deleteAccount(address)
      } catch (error) {
        console.error('ActivityController: Failed to delete from IDB, falling back to storage', error)
        await this.#storage.set('accountsOps', this.#accountsOps)
        await this.#storage.set('signedMessages', this.#signedMessages)
      }
    } else {
      await this.#storage.set('accountsOps', this.#accountsOps)
      await this.#storage.set('signedMessages', this.#signedMessages)
    }

    this.emitUpdate()
  }

  get broadcastedButNotConfirmed(): { [accAddr: string]: SubmittedAccountOp[] } {
    return Object.fromEntries(
      this.#accounts.accounts.map((acc) => {
        const accOps = this.#accountsOps[acc.addr]

        if (!accOps) return [acc.addr, []]

        const ops = Object.values(accOps)
          .flat()
          .filter((op) => op.status === AccountOpStatus.BroadcastedButNotConfirmed)

        return [acc.addr, ops]
      })
    )
  }

  async findMessage(account: string, filter: (item: SignedMessage) => boolean) {
    await this.#initialLoadPromise

    if (!this.#signedMessages[account]) return null

    return this.#signedMessages[account].find(filter)
  }

  // return a txn id only if we have certainty that this is the final txn id:
  // EOA broadcast: 100% certainty on broadcast
  // Relayer | Bundler broadcast: once we have a receipt as there could be
  // front running or txnId replacement issues
  async getConfirmedTxId(
    submittedAccountOp: SubmittedAccountOp,
    counter = 0
  ): Promise<string | undefined> {
    if (
      !this.#accountsOps[submittedAccountOp.accountAddr] ||
      !this.#accountsOps[submittedAccountOp.accountAddr]![submittedAccountOp.chainId.toString()]
    )
      return undefined

    const activityAccountOp = this.#accountsOps[submittedAccountOp.accountAddr]![
      submittedAccountOp.chainId.toString()
    ]!.find((op) => op.identifiedBy === submittedAccountOp.identifiedBy)
    // shouldn't happen
    if (!activityAccountOp) return undefined

    if (
      !isIdentifiedByUserOpHash(activityAccountOp.identifiedBy) &&
      !isIdentifiedByRelayer(activityAccountOp.identifiedBy)
    )
      return activityAccountOp.txnId

    // @frontrunning
    if (
      activityAccountOp.status === AccountOpStatus.Pending ||
      activityAccountOp.status === AccountOpStatus.BroadcastedButNotConfirmed
    ) {
      // if the receipt cannot be confirmed after a lot of retries, continue on
      if (counter >= 30) return activityAccountOp.txnId

      await wait(2000)
      return this.getConfirmedTxId(submittedAccountOp, counter + 1)
    }

    return activityAccountOp.txnId
  }

  findByIdentifiedBy(
    identifiedBy: AccountOpIdentifiedBy,
    accountAddr: string,
    chainId: bigint
  ): SubmittedAccountOp | undefined {
    if (!this.#accountsOps[accountAddr] || !this.#accountsOps[accountAddr][chainId.toString()]) {
      return undefined
    }

    return this.#accountsOps[accountAddr]?.[chainId.toString()]?.find(
      (op) => op.identifiedBy && op.identifiedBy.identifier === identifiedBy.identifier
    )
  }

  get banners() {
    if (!this.#networks.isInitialized) {
      return Array.from(this.#bannersByAccount.values()).flat()
    }

    // Extract only needed props from the SubmittedAccountOp
    const mapToMetaData = (ops: SubmittedAccountOp[]) =>
      ops.map((op) => ({
        accountAddr: op.accountAddr,
        chainId: op.chainId,
        timestamp: op.timestamp,
        id: op.id
      }))

    for (const acc of this.#accounts.accounts) {
      const addr = acc.addr
      const accountOps = this.#accountsOps[addr]

      if (!accountOps) {
        this.#bannersByAccount.set(addr, [])

        continue
      }

      const prevBanners = this.#bannersByAccount.get(addr) || []
      const pendingBanner = prevBanners.find(
        (b) => b.category === 'pending-to-be-confirmed-acc-ops'
      )
      const failedBanner = prevBanners.find((b) => b.category === 'failed-acc-ops')
      const activityBanners: Banner[] = []

      const latestOps = Object.values(accountOps)
        .flat()
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10)

      const pendingOps = latestOps.filter(
        (op) =>
          op.status === AccountOpStatus.Pending ||
          op.status === AccountOpStatus.BroadcastedButNotConfirmed
      )

      if (pendingOps.length) {
        let opsDataForNextUpdate = mapToMetaData(pendingOps)

        if (pendingBanner) {
          opsDataForNextUpdate = [
            ...(pendingBanner.meta?.accountOpsDataForNextUpdate || []),
            ...opsDataForNextUpdate
          ].filter((o, i, s) => s.findIndex((x) => x.timestamp === o.timestamp) === i)
        }

        if (!pendingBanner && failedBanner) {
          opsDataForNextUpdate = [
            ...(failedBanner.meta?.accountOpsDataForNextUpdate || []),
            ...opsDataForNextUpdate
          ].filter((o, i, s) => s.findIndex((x) => x.timestamp === o.timestamp) === i)
        }

        activityBanners.push({
          id: `pending-${addr}`,
          type: 'info',
          category: 'pending-to-be-confirmed-acc-ops',
          title:
            pendingOps.length === 1
              ? 'Transaction is pending onchain confirmation.'
              : 'Transactions are pending onchain confirmation.',
          text:
            pendingOps.length === 1
              ? 'Scroll down to view the pending transaction.'
              : 'Scroll down to view the pending transactions.',
          meta: {
            accountAddr: addr,
            accountOpsDataForNextUpdate: opsDataForNextUpdate,
            accountOpsCount: pendingOps.length
          },
          actions: []
        })
      }

      const pendingOpsWithUpdatedStatus = pendingBanner
        ? latestOps.filter((op) =>
            pendingBanner.meta!.accountOpsDataForNextUpdate?.find(
              (meta: any) =>
                meta.accountAddr === op.accountAddr &&
                meta.chainId === op.chainId &&
                meta.timestamp === op.timestamp
            )
          )
        : []

      const failedOps = pendingOpsWithUpdatedStatus.filter(
        (op) =>
          (op.status === AccountOpStatus.Failure || op.status === AccountOpStatus.Rejected) &&
          !op.flags?.hiddenFromFailedBanner
      )

      if (failedOps.length) {
        const shouldMarkSeen = Object.keys(this.accountsOps).some((k) => k.startsWith('dashboard'))
        activityBanners.push({
          id: `failed-${addr}`,
          type: 'error',
          category: 'failed-acc-ops',
          title: failedOps.length === 1 ? 'Transaction failed.' : 'Transactions failed.',
          text:
            failedOps.length === 1
              ? 'Scroll down to view the failed transaction.'
              : 'Scroll down to view the failed transactions.',
          meta: {
            accountAddr: addr,
            accountOpsDataForNextUpdate: mapToMetaData(failedOps),
            accountOpsCount: failedOps.length,
            seen: shouldMarkSeen
          },
          actions: []
        })
      } else if (failedBanner) {
        // Preserve existing failed banner if no new ones
        activityBanners.push(failedBanner)
      }

      this.#bannersByAccount.set(addr, activityBanners)
    }

    return Array.from(this.#bannersByAccount.values()).flat()
  }

  getAccountOpsForAccount({
    accountAddr = this.#selectedAccount.account?.addr,
    from,
    numberOfItems,
    // added so the logic in the survey controller does not get heavy for accs with a lot of txns
    sortAccOps = true
  }: {
    accountAddr?: string
    from?: number
    numberOfItems?: number
    sortAccOps?: boolean
  }) {
    if (!accountAddr) return []

    let allAccountOps = Object.values(this.#accountsOps[accountAddr] || {}).flat()
    if (sortAccOps) allAccountOps = allAccountOps.sort((a, b) => b.timestamp - a.timestamp)

    if (typeof from === 'number' && typeof numberOfItems === 'number')
      return allAccountOps.slice(from, from + numberOfItems)
    return allAccountOps
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      broadcastedButNotConfirmed: this.broadcastedButNotConfirmed, // includes the getter in the stringified instance
      banners: this.banners // includes the getter in the stringified instance
    }
  }
}
