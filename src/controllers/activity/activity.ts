/* eslint-disable import/no-extraneous-dependencies */
import { Account, AccountId } from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import { Message } from '../../interfaces/userRequest'
import { isSmartAccount } from '../../libs/account/account'
import { AccountOpStatus } from '../../libs/accountOp/accountOp'
import { fetchTxnId, SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { NetworkNonces } from '../../libs/portfolio/interfaces'
import { getBenzinUrlParams } from '../../utils/benzin'
import { AccountsController } from '../accounts/accounts'
import EventEmitter from '../eventEmitter/eventEmitter'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'

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

export interface SignedMessage extends Message {
  dapp: {
    name: string
    icon: string
  } | null
  timestamp: number
}

interface AccountsOps extends PaginationResult<SubmittedAccountOp> {}
interface MessagesToBeSigned extends PaginationResult<SignedMessage> {}

export interface Filters {
  account: string
  network?: string
}

interface InternalAccountsOps {
  // account => network => SubmittedAccountOp[]
  [key: string]: { [key: string]: SubmittedAccountOp[] }
}

interface InternalSignedMessages {
  // account => Message[]
  [key: string]: SignedMessage[]
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
export class ActivityController extends EventEmitter {
  #storage: Storage

  #fetch: Fetch

  #initialLoadPromise: Promise<void>

  #accounts: AccountsController

  #selectedAccount: SelectedAccountController

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

  #providers: ProvidersController

  #networks: NetworksController

  #onContractsDeployed: (network: Network) => Promise<void>

  #rbfStatuses = [AccountOpStatus.BroadcastedButNotConfirmed, AccountOpStatus.BroadcastButStuck]

  #callRelayer: Function

  constructor(
    storage: Storage,
    fetch: Fetch,
    callRelayer: Function,
    accounts: AccountsController,
    selectedAccount: SelectedAccountController,
    providers: ProvidersController,
    networks: NetworksController,
    onContractsDeployed: (network: Network) => Promise<void>
  ) {
    super()
    this.#storage = storage
    this.#fetch = fetch
    this.#callRelayer = callRelayer
    this.#accounts = accounts
    this.#selectedAccount = selectedAccount
    this.#providers = providers
    this.#networks = networks
    this.#onContractsDeployed = onContractsDeployed
    this.#initialLoadPromise = this.#load()
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

  async filterAccountsOps(
    sessionId: string,
    filters: Filters,
    pagination: Pagination = {
      fromPage: 0,
      itemsPerPage: 10
    }
  ) {
    await this.#initialLoadPromise

    let filteredItems

    if (filters.network) {
      filteredItems = this.#accountsOps[filters.account]?.[filters.network] || []
    } else {
      filteredItems = Object.values(this.#accountsOps[filters.account] || []).flat()
      // By default, #accountsOps are grouped by network and sorted in descending order.
      // However, when the network filter is omitted, #accountsOps from different networks are mixed,
      // requiring additional sorting to ensure they are also in descending order.
      filteredItems.sort((a, b) => b.timestamp - a.timestamp)
    }

    const result = paginate(filteredItems, pagination.fromPage, pagination.itemsPerPage)

    this.accountsOps[sessionId] = {
      result,
      filters,
      pagination
    }

    this.emitUpdate()
  }

  // Reset filtered AccountsOps session.
  // Example: when a FE component is being unmounted, we don't need anymore the filtered accounts ops and we
  // free the memory calling this method.
  resetAccountsOpsFilters(sessionId: string) {
    delete this.accountsOps[sessionId]
  }

  // Everytime we add/remove an AccOp, we should run this method in order to keep the filtered and internal accounts ops in sync.
  private async syncFilteredAccountsOps() {
    const promises = Object.keys(this.accountsOps).map(async (sessionId) => {
      await this.filterAccountsOps(
        sessionId,
        this.accountsOps[sessionId].filters,
        this.accountsOps[sessionId].pagination
      )
    })

    await Promise.all(promises)
  }

  async filterSignedMessages(
    sessionId: string,
    filters: Filters,
    pagination: Pagination = {
      fromPage: 0,
      itemsPerPage: 10
    }
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
  }

  // Everytime we add/remove a Message, we should run this method in order to keep the filtered and internal messages in sync.
  private async syncSignedMessages() {
    const promises = Object.keys(this.signedMessages).map(async (sessionId) => {
      await this.filterSignedMessages(
        sessionId,
        this.signedMessages[sessionId].filters,
        this.signedMessages[sessionId].pagination
      )
    })

    await Promise.all(promises)
  }

  async addAccountOp(accountOp: SubmittedAccountOp) {
    await this.#initialLoadPromise

    const { accountAddr, networkId } = accountOp

    if (!this.#accountsOps[accountAddr]) this.#accountsOps[accountAddr] = {}
    if (!this.#accountsOps[accountAddr][networkId]) this.#accountsOps[accountAddr][networkId] = []

    // newest SubmittedAccountOp goes first in the list
    this.#accountsOps[accountAddr][networkId].unshift({ ...accountOp })
    trim(this.#accountsOps[accountAddr][networkId])

    await this.syncFilteredAccountsOps()

    await this.#storage.set('accountsOps', this.#accountsOps)
    this.emitUpdate()
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
  async updateAccountsOpsStatuses(): Promise<{
    shouldEmitUpdate: boolean
    shouldUpdatePortfolio: boolean
  }> {
    await this.#initialLoadPromise

    if (!this.#selectedAccount.account || !this.#accountsOps[this.#selectedAccount.account.addr])
      return { shouldEmitUpdate: false, shouldUpdatePortfolio: false }

    // This flag tracks the changes to AccountsOps statuses
    // and optimizes the number of the emitted updates and storage/state updates.
    let shouldEmitUpdate = false

    let shouldUpdatePortfolio = false

    await Promise.all(
      Object.keys(this.#accountsOps[this.#selectedAccount.account.addr]).map(async (networkId) => {
        const network = this.#networks.networks.find((x) => x.id === networkId)
        if (!network) return
        const provider = this.#providers.providers[network.id]

        const selectedAccount = this.#selectedAccount.account?.addr

        if (!selectedAccount) return

        return Promise.all(
          this.#accountsOps[selectedAccount][networkId].map(async (accountOp, accountOpIndex) => {
            // Don't update the current network account ops statuses,
            // as the statuses are already updated in the previous calls.
            if (accountOp.status !== AccountOpStatus.BroadcastedButNotConfirmed) return

            shouldEmitUpdate = true

            const declareStuckIfQuaterPassed = (op: SubmittedAccountOp) => {
              const accountOpDate = new Date(op.timestamp)
              accountOpDate.setMinutes(accountOpDate.getMinutes() + 15)
              const aQuaterHasPassed = accountOpDate < new Date()
              if (aQuaterHasPassed) {
                this.#accountsOps[selectedAccount][networkId][accountOpIndex].status =
                  AccountOpStatus.BroadcastButStuck
              }
            }

            const fetchTxnIdResult = await fetchTxnId(
              accountOp.identifiedBy,
              network,
              this.#fetch,
              this.#callRelayer,
              accountOp
            )
            if (fetchTxnIdResult.status === 'rejected') {
              this.#accountsOps[selectedAccount][networkId][accountOpIndex].status =
                AccountOpStatus.Rejected
              return
            }
            if (fetchTxnIdResult.status === 'not_found') {
              declareStuckIfQuaterPassed(accountOp)
              return
            }

            const txnId = fetchTxnIdResult.txnId as string
            this.#accountsOps[selectedAccount][networkId][accountOpIndex].txnId = txnId

            try {
              const receipt = await provider.getTransactionReceipt(txnId)
              if (receipt) {
                this.#accountsOps[selectedAccount][networkId][accountOpIndex].status =
                  receipt.status ? AccountOpStatus.Success : AccountOpStatus.Failure

                if (receipt.status) {
                  shouldUpdatePortfolio = true
                }

                if (accountOp.isSingletonDeploy && receipt.status) {
                  await this.#onContractsDeployed(network)
                }
                return
              }

              // if there's no receipt, confirm there's a txn
              // if there's no txn and 15 minutes have passed, declare it a failure
              const txn = await provider.getTransaction(txnId)
              if (txn) return
              declareStuckIfQuaterPassed(accountOp)
            } catch {
              this.emitError({
                level: 'silent',
                message: `Failed to determine transaction status on ${accountOp.networkId} for ${accountOp.txnId}.`,
                error: new Error(
                  `activity: failed to get transaction receipt for ${accountOp.txnId}`
                )
              })
            }

            // if there are more than 1 txns with the same nonce and payer,
            // we can conclude this one is replaced by fee
            const sameNonceTxns = this.#accountsOps[selectedAccount][networkId].filter(
              (accOp) =>
                accOp.gasFeePayment &&
                accountOp.gasFeePayment &&
                accOp.gasFeePayment.paidBy === accountOp.gasFeePayment.paidBy &&
                accOp.nonce.toString() === accountOp.nonce.toString()
            )
            const confirmedSameNonceTxns = sameNonceTxns.find(
              (accOp) =>
                accOp.status === AccountOpStatus.Success || accOp.status === AccountOpStatus.Failure
            )
            if (sameNonceTxns.length > 1 && !!confirmedSameNonceTxns) {
              this.#accountsOps[selectedAccount][networkId][accountOpIndex].status =
                AccountOpStatus.UnknownButPastNonce
              shouldUpdatePortfolio = true
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

    return { shouldEmitUpdate, shouldUpdatePortfolio }
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

  async hideBanner({
    addr,
    network,
    timestamp
  }: {
    addr: string
    network: string
    timestamp: number
  }) {
    await this.#initialLoadPromise

    // shouldn't happen
    if (!this.#accountsOps[addr]) return
    if (!this.#accountsOps[addr][network]) return

    // find the op we want to update
    const op = this.#accountsOps[addr][network].find((accOp) => accOp.timestamp === timestamp)
    if (!op) return

    // update by reference
    if (!op.flags) op.flags = {}
    op.flags.hideActivityBanner = true

    await this.#storage.set('accountsOps', this.#accountsOps)

    this.emitUpdate()
  }

  #throwNotInitialized() {
    this.emitError({
      level: 'major',
      message:
        "Looks like your activity couldn't be processed. Retry, or contact support if issue persists.",
      error: new Error('activity: controller not initialized')
    })
  }

  get broadcastedButNotConfirmed(): SubmittedAccountOp[] {
    if (!this.#selectedAccount.account || !this.#accountsOps[this.#selectedAccount.account.addr])
      return []

    return Object.values(this.#accountsOps[this.#selectedAccount.account.addr])
      .flat()
      .filter((accountOp) => accountOp.status === AccountOpStatus.BroadcastedButNotConfirmed)
  }

  // Here, we retrieve nonces that are either already confirmed and known,
  // or those that have been broadcasted and are in the process of being confirmed.
  // We use this information to determine the token's pending badge status (whether it is PendingToBeConfirmed or PendingToBeSigned).
  // By knowing the latest AccOp nonce, we can compare it with the portfolio's pending simulation nonce.
  // If the ActivityNonce is the same as the simulation beforeNonce,
  // we can conclude that the badge is PendingToBeConfirmed.
  // In all other cases, if the portfolio nonce is newer, then the badge is still PendingToBeSigned.
  // More info: calculatePendingAmounts.
  get lastKnownNonce(): NetworkNonces {
    if (!this.#selectedAccount.account || !this.#accountsOps[this.#selectedAccount.account.addr])
      return {}

    return Object.values(this.#accountsOps[this.#selectedAccount.account.addr])
      .flat()
      .reduce(
        (acc, accountOp) => {
          const successStatuses = [
            AccountOpStatus.BroadcastedButNotConfirmed,
            AccountOpStatus.Success,
            AccountOpStatus.UnknownButPastNonce
          ]

          if (!successStatuses.includes(accountOp.status!)) return acc

          if (!acc[accountOp.networkId]) {
            acc[accountOp.networkId] = accountOp.nonce
          } else {
            acc[accountOp.networkId] =
              accountOp.nonce > acc[accountOp.networkId]
                ? accountOp.nonce
                : acc[accountOp.networkId]
          }

          return acc
        },

        {} as NetworkNonces
      )
  }

  get banners(): Banner[] {
    if (!this.#networks.isInitialized) return []
    return (
      this.broadcastedButNotConfirmed
        // do not show a banner for forcefully hidden banners
        .filter((op) => !(op.flags && op.flags.hideActivityBanner))
        .map((accountOp) => {
          const network = this.#networks.networks.find((x) => x.id === accountOp.networkId)!

          const url = `https://benzin.ambire.com/${getBenzinUrlParams({
            chainId: network.chainId,
            txnId: accountOp.txnId,
            identifiedBy: accountOp.identifiedBy
          })}`

          return {
            id: accountOp.txnId,
            type: 'success',
            category: 'pending-to-be-confirmed-acc-op',
            title: 'Transaction successfully signed and sent!\nCheck it out on the block explorer!',
            text: '',
            actions: [
              {
                label: 'Close',
                actionName: 'hide-activity-banner',
                meta: {
                  addr: accountOp.accountAddr,
                  network: accountOp.networkId,
                  timestamp: accountOp.timestamp,
                  isHideStyle: true
                }
              },
              {
                label: 'Check',
                actionName: 'open-external-url',
                meta: { url }
              }
            ]
          } as Banner
        })
    )
  }

  /**
   * A not confirmed account op can actually be with a status of BroadcastButNotConfirmed
   * and BroadcastButStuck. Typically, it becomes BroadcastButStuck if not confirmed
   * in a 15 minutes interval after becoming BroadcastButNotConfirmed. We need two
   * statuses to hide the banner of BroadcastButNotConfirmed from the dashboard.
   */
  getNotConfirmedOpIfAny(accId: AccountId, networkId: Network['id']): SubmittedAccountOp | null {
    const acc = this.#accounts.accounts.find((oneA) => oneA.addr === accId)
    if (!acc) return null

    // if the broadcasting account is a smart account, it means relayer
    // broadcast => it's in this.#accountsOps[acc.addr][networkId]
    // disregard erc-4337 txns as they shouldn't have an RBF
    const isSA = isSmartAccount(acc)
    if (isSA) {
      if (!this.#accountsOps[acc.addr] || !this.#accountsOps[acc.addr][networkId]) return null
      if (!this.#rbfStatuses.includes(this.#accountsOps[acc.addr][networkId][0].status!))
        return null

      return this.#accountsOps[acc.addr][networkId][0]
    }

    // if the account is an EOA, we have to go through all the smart accounts
    // to check whether the EOA has made a broadcast for them
    const theEOAandSAaccounts = this.#accounts.accounts.filter(
      (oneA) => isSmartAccount(oneA) || oneA.addr === accId
    )
    const ops: SubmittedAccountOp[] = []
    theEOAandSAaccounts.forEach((oneA) => {
      if (!this.#accountsOps[oneA.addr] || !this.#accountsOps[oneA.addr][networkId]) return
      const op = this.#accountsOps[oneA.addr][networkId].find(
        (oneOp) =>
          this.#rbfStatuses.includes(this.#accountsOps[oneA.addr][networkId][0].status!) &&
          oneOp.gasFeePayment?.paidBy === oneA.addr
      )
      if (!op) return
      ops.push(op)
    })
    return !ops.length ? null : ops.reduce((m, e) => (e.nonce > m.nonce ? e : m))
  }

  getLastTxn(networkId: Network['id']): SubmittedAccountOp | null {
    if (
      !this.#selectedAccount.account ||
      !this.#accountsOps[this.#selectedAccount.account.addr] ||
      !this.#accountsOps[this.#selectedAccount.account.addr][networkId]
    )
      return null

    return this.#accountsOps[this.#selectedAccount.account.addr][networkId][0]
  }

  async findMessage(account: string, filter: (item: SignedMessage) => boolean) {
    await this.#initialLoadPromise

    return this.#signedMessages[account].find(filter)
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      broadcastedButNotConfirmed: this.broadcastedButNotConfirmed, // includes the getter in the stringified instance
      lastKnownNonce: this.lastKnownNonce,
      banners: this.banners // includes the getter in the stringified instance
    }
  }
}
