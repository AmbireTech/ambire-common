import { toBeHex } from 'ethers'

import { Account, AccountId, IAccountsController } from '../../interfaces/account'
import { IActivityController } from '../../interfaces/activity'
import { Banner } from '../../interfaces/banner'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { Fetch } from '../../interfaces/fetch'
import { INetworksController, Network } from '../../interfaces/network'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import { ISelectedAccountController } from '../../interfaces/selectedAccount'
import { IStorageController } from '../../interfaces/storage'
import {
  AccountOpIdentifiedBy,
  checkIsRecipientOfAccountOp,
  fetchFrontRanTxnId,
  fetchTxnId,
  getAccountOpRecipients,
  hasTimePassedSinceBroadcast,
  isIdentifiedByRelayer,
  isIdentifiedByUserOpHash,
  PortfoliosToUpdate,
  SubmittedAccountOp,
  updateOpStatus
} from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { getTransferLogTokens } from '../../libs/logsParser/parseLogs'
import { parseLogs } from '../../libs/userOperation/userOperation'
import wait from '../../utils/wait'
import EventEmitter from '../eventEmitter/eventEmitter'
import { InternalSignedMessages, SignedMessage } from './types'

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

interface AccountsOps extends PaginationResult<SubmittedAccountOp> {}
interface MessagesToBeSigned extends PaginationResult<SignedMessage> {}

export interface Filters {
  account: string
  chainId?: bigint
  identifiedBy?: AccountOpIdentifiedBy
}

export interface InternalAccountsOps {
  // account => network => SubmittedAccountOp[]
  [key: string]: { [key: string]: SubmittedAccountOp[] }
}

// We are limiting items array to include no more than 1000 records,
// as we trim out the oldest ones (in the beginning of the items array).
// We do this to maintain optimal storage and performance.
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

  #initialLoadPromise?: Promise<void>

  #accounts: IAccountsController

  #selectedAccount: ISelectedAccountController

  #accountsOps: InternalAccountsOps = {}

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
        }>
      | undefined
  } = {}

  constructor(
    storage: IStorageController,
    fetch: Fetch,
    callRelayer: Function,
    accounts: IAccountsController,
    selectedAccount: ISelectedAccountController,
    providers: IProvidersController,
    networks: INetworksController,
    portfolio: IPortfolioController,
    onContractsDeployed: (network: Network) => Promise<void>,
    eventEmitterRegistry?: IEventEmitterRegistryController
  ) {
    super(eventEmitterRegistry)
    this.#storage = storage
    this.#fetch = fetch
    this.#callRelayer = callRelayer
    this.#accounts = accounts
    this.#selectedAccount = selectedAccount
    this.#providers = providers
    this.#networks = networks
    this.#portfolio = portfolio
    this.#onContractsDeployed = onContractsDeployed
    this.#initialLoadPromise = this.#load().finally(() => {
      this.#initialLoadPromise = undefined
    })
  }

  async #load(): Promise<void> {
    await this.#accounts.initialLoadPromise
    await this.#selectedAccount.initialLoadPromise
    const [accountsOps, signedMessages] = await Promise.all([
      this.#storage.get('accountsOps', {}),
      this.#storage.get('signedMessages', {})
    ])

    this.#accountsOps = accountsOps
    this.#signedMessages = signedMessages

    this.emitUpdate()
  }

  /**
   * Checks if there are any account operations that were sent to a specific address
   * @param toAddress The address to check for received transactions
   * @param accountId The account ID to filter operations from
   * @returns An object with 'found' (boolean) and 'lastTransactionDate' (Date | null)
   */
  async hasAccountOpsSentTo(
    toAddress: string,
    accountId: AccountId
  ): Promise<{ found: boolean; lastTransactionDate: Date | null }> {
    await this.#initialLoadPromise
    if (!toAddress) return { found: false, lastTransactionDate: null }
    const accounts = accountId ? [accountId] : Object.keys(this.#accountsOps)
    let found = false
    let lastTimestamp: number | null = null

    accounts.forEach((account) => {
      const accountOpsOfAccount = this.#accountsOps[account]
      if (!accountOpsOfAccount) return
      const networks = Object.keys(accountOpsOfAccount)
      networks.forEach((network) => {
        const networkAccountOpsOfAccount = accountOpsOfAccount[network]
        if (!networkAccountOpsOfAccount) return
        networkAccountOpsOfAccount.forEach((op) => {
          const timestampOfSentTo = checkIsRecipientOfAccountOp(op, toAddress)

          if (timestampOfSentTo) {
            found = true

            if (!lastTimestamp || timestampOfSentTo > lastTimestamp) {
              lastTimestamp = timestampOfSentTo
            }
          }
        })
      })
    })

    return { found, lastTransactionDate: lastTimestamp ? new Date(lastTimestamp) : null }
  }

  async filterAccountsOps(
    sessionId: string,
    filters: Filters,
    pagination: Pagination = { fromPage: 0, itemsPerPage: 10 }
  ) {
    await this.#initialLoadPromise

    const enabledNetworkChainIds = this.#networks.networks.map(({ chainId }) => String(chainId))
    const accountOpsEntriesOnEnabledNetworks = Object.entries(
      this.#accountsOps[filters.account] || {}
    ).filter(([chainId]) => enabledNetworkChainIds.includes(chainId))
    let filteredItems: SubmittedAccountOp[]

    if (filters.chainId && enabledNetworkChainIds.includes(String(filters.chainId))) {
      filteredItems =
        accountOpsEntriesOnEnabledNetworks.find(
          ([chainId]) => chainId === String(filters.chainId)
        )?.[1] || []
    } else {
      filteredItems = accountOpsEntriesOnEnabledNetworks.flatMap(([, accountOps]) => accountOps)
      // By default, #accountsOps are grouped by network and sorted in descending order.
      // However, when the network filter is omitted, #accountsOps from different networks are mixed,
      // requiring additional sorting to ensure they are also in descending order.
      filteredItems.sort((a, b) => b.timestamp - a.timestamp)
    }

    // for benzin fetching
    if (filters.identifiedBy) {
      filteredItems.filter(
        (i) => i.identifiedBy && i.identifiedBy.identifier === filters.identifiedBy!.identifier
      )
    }

    const result = paginate(filteredItems, pagination.fromPage, pagination.itemsPerPage)

    this.setDashboardBannersSeen(sessionId, filters.account)
    this.accountsOps[sessionId] = { result, filters, pagination }

    this.emitUpdate()
  }

  setDashboardBannersSeen(sessionId: string, accountAddr: string) {
    if (!sessionId.startsWith('dashboard')) return

    const prevBanners = this.#bannersByAccount.get(accountAddr)
    if (!prevBanners) return

    const updatedBanners = prevBanners.map((b) => {
      if (b.category === 'failed-acc-ops') {
        return { ...b, meta: { ...b.meta, seen: true } }
      }

      return b
    })

    this.#bannersByAccount.set(accountAddr, updatedBanners)
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

    // newest SubmittedAccountOp goes first in the list
    this.#accountsOps[accountAddr]![chainId.toString()]!.unshift({ ...accountOp })
    trim(this.#accountsOps[accountAddr][chainId.toString()]!)

    await this.syncFilteredAccountsOps()

    await this.#storage.set('accountsOps', this.#accountsOps)
    this.emitUpdate()
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
  }> {
    await this.#initialLoadPromise

    if (!this.#accountsOps[accountAddr])
      return {
        shouldEmitUpdate: false,
        chainsToUpdate: [],
        updatedAccountsOps: [],
        portfoliosToUpdate: {},
        newestOpTimestamp: 0
      }

    // This flag tracks the changes to AccountsOps statuses
    // and optimizes the number of the emitted updates and storage/state updates.
    let shouldEmitUpdate = false

    const chainsToUpdate = new Set<Network['chainId']>()
    const portfoliosToUpdate: PortfoliosToUpdate = {}
    const updatedAccountsOps: SubmittedAccountOp[] = []

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
        const recentOps = Array.isArray(allOps) ? allOps.slice(0, MAX_OPS_TO_ITERATE_PER_CHAIN) : []
        const opsToUpdate = recentOps.filter(
          (op) => op.status === AccountOpStatus.BroadcastedButNotConfirmed
        )

        return Promise.all(
          opsToUpdate.map(async (accountOp) => {
            shouldEmitUpdate = true

            if (newestOpTimestamp === undefined || newestOpTimestamp < accountOp.timestamp) {
              newestOpTimestamp = accountOp.timestamp
            }

            const declareStuckIfFiveMinsPassed = (op: SubmittedAccountOp) => {
              if (hasTimePassedSinceBroadcast(op, 5)) {
                const updatedOpIfAny = updateOpStatus(accountOp, AccountOpStatus.BroadcastButStuck)
                if (updatedOpIfAny) updatedAccountsOps.push(updatedOpIfAny)
              }
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
                declareStuckIfFiveMinsPassed(accountOp)
                return
              }

              const txnId = fetchTxnIdResult.txnId as string
              // eslint-disable-next-line no-param-reassign
              accountOp.txnId = txnId
              txIds.push(txnId)
            } else {
              const limit = !provider.batchMaxCount || provider.batchMaxCount > 1 ? 100 : 3
              txIds.push(
                ...accountOp.calls
                  .filter((call) => !!call.status)
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
                    // eslint-disable-next-line no-await-in-loop
                    const frontRanTxnId = await fetchFrontRanTxnId(
                      accountOp.identifiedBy,
                      txnId,
                      network
                    )
                    // eslint-disable-next-line no-param-reassign
                    accountOp.txnId = frontRanTxnId
                    // eslint-disable-next-line no-await-in-loop
                    receipt = await provider.getTransactionReceipt(frontRanTxnId)
                    if (!receipt) return
                  }

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

                  if (accountOp.isSingletonDeploy && receipt.status) {
                    // eslint-disable-next-line no-await-in-loop
                    await this.#onContractsDeployed(network)
                  }

                  // learn tokens from the transfer logs
                  if (isSuccess) {
                    // eslint-disable-next-line no-await-in-loop
                    const foundTokens = await getTransferLogTokens(
                      receipt.logs,
                      accountOp.accountAddr
                    )
                    if (foundTokens.length) {
                      this.#portfolio.addTokensToBeLearned(foundTokens, accountOp.chainId)
                    }
                  }

                  // eslint-disable-next-line no-param-reassign
                  accountOp.blockNumber = receipt.blockNumber

                  // eslint-disable-next-line no-param-reassign
                  accountOp.blockHash = receipt.blockHash

                  // eslint-disable-next-line no-param-reassign
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
                  // eslint-disable-next-line no-continue
                  continue
                }

                // if there's no receipt, confirm there's a txn
                // if there's no txn and 15 minutes have passed, declare it a failure
                // eslint-disable-next-line no-await-in-loop
                const txn = txnId ? await provider.getTransaction(txnId) : null
                // eslint-disable-next-line no-continue
                if (txn) continue
                declareStuckIfFiveMinsPassed(accountOp)
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
          })
        )
      })
    )

    if (shouldEmitUpdate) {
      await this.#storage.set('accountsOps', this.#accountsOps)
      await this.syncFilteredAccountsOps()
      this.emitUpdate()
    }

    return {
      shouldEmitUpdate,
      chainsToUpdate: Array.from(chainsToUpdate),
      updatedAccountsOps,
      portfoliosToUpdate,
      newestOpTimestamp
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

    await this.#storage.set('accountsOps', this.#accountsOps)
    await this.#storage.set('signedMessages', this.#signedMessages)

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

      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      await wait(1000)
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
        timestamp: op.timestamp
      }))

    // eslint-disable-next-line no-restricted-syntax
    for (const acc of this.#accounts.accounts) {
      const addr = acc.addr
      const accountOps = this.#accountsOps[addr]

      if (!accountOps) {
        this.#bannersByAccount.set(addr, [])
        // eslint-disable-next-line no-continue
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
            ...pendingBanner.meta!.accountOpsDataForNextUpdate,
            ...opsDataForNextUpdate
          ].filter((o, i, s) => s.findIndex((x) => x.timestamp === o.timestamp) === i)
        }

        if (!pendingBanner && failedBanner) {
          opsDataForNextUpdate = [
            ...failedBanner.meta!.accountOpsDataForNextUpdate,
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
            pendingBanner.meta!.accountOpsDataForNextUpdate.find(
              (meta: any) =>
                meta.accountAddr === op.accountAddr &&
                meta.chainId === op.chainId &&
                meta.timestamp === op.timestamp
            )
          )
        : []

      const failedOps = pendingOpsWithUpdatedStatus.filter(
        (op) => op.status === AccountOpStatus.Failure || op.status === AccountOpStatus.Rejected
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
    numberOfItems
  }: {
    accountAddr?: string
    from: number
    numberOfItems: number
  }) {
    if (!accountAddr) return []

    return Object.values(this.#accountsOps[accountAddr] || {})
      .flat()
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(from, from + numberOfItems)
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
