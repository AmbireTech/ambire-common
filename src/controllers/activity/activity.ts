import { JsonRpcProvider } from 'ethers'

import { networks } from '../../consts/networks'
import { AccountStates } from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import { Storage } from '../../interfaces/storage'
import { Message } from '../../interfaces/userRequest'
import { AccountOp, AccountOpStatus } from '../../libs/accountOp/accountOp'
import { isErc4337Broadcast } from '../../libs/userOperation/userOperation'
import bundler from '../../services/bundlers'
import EventEmitter from '../eventEmitter'

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

export interface SubmittedAccountOp extends AccountOp {
  txnId: string
  nonce: bigint
  success?: boolean
  timestamp: number
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

/**
 * Activity Controller
 * is responsible for keeping signed AccountsOps and Messages in the controller memory and browser storage.
 *
 * With its public methods and properties, you can retrieve ActivityController.accountsOps and ActivityController.signedMessages in a paginated structure.
 *
 * In order to set filters/pagination, we should use the following methods:
 * `setFilters` - the same filters are reused for both AccountsOps and SignedMessages, because in terms of UI, most probably they will have the same value for both types.
 * `setAccountsOpsPagination` - set pagination props for AccountsOps only. We don't reuse the pagination for SignedMessages too, because pagination is tightly coupled to its type.
 * `setSignedMessagesPagination` - set pagination props for SignedMessages.
 *
 * 💡 For performance reasons, we have made the decision to limit the number of items per account + network to a maximum of 1000.
 * To achieve this, we have trimmed out the oldest items, retaining only the most recent ones.
 *
 * Implementation decisions:
 *
 * 1. Before we start operating with the controller inner state, we rely on private load() function to load the browser storage and to update the inner state.
 * 2. The filtering by account/network is reused for both AccountsOps and SignedMessages. This seems most logical from a UI perspective.
 * 3. Pagination is not reused because the two tabs can have different states.
 * 4. MainController passes all accounts to ActivityController (instead of a single account, i.e. the current one) so that we can know the latest nonce for each account + network. Otherwise (if we don't want to pass all accounts), when selecting an account from the UI in the Transaction History screen, MainController should subscribe and pass only one account. The first option seems to be less cumbersome.
 * 5. Here is how we update AccountsOps statuses:
 *   5.1. Once we add a new AccountOp to ActivityController via addAccountOp, we are setting its status to AccountOpStatus.BroadcastedButNotConfirmed.
 *   5.2. Later, we need to call `updateAccountsOpsStatuses()` from the app.
 *       5.2.1. Then, we firstly rely on getTransactionReceipt for determining the status (success or failure).
 *       5.2.2. If we don't manage to determine its status, we are comparing AccountOp and Account nonce. If Account nonce is greater than AccountOp, then we know that AccountOp has past nonce (AccountOpStatus.UnknownButPastNonce).
 */
export class ActivityController extends EventEmitter {
  #storage: Storage

  #initialLoadPromise: Promise<void>

  #accountStates: AccountStates

  #accountsOps: InternalAccountsOps = {}

  accountsOps: AccountsOps | undefined

  #signedMessages: InternalSignedMessages = {}

  signedMessages: MessagesToBeSigned | undefined

  accountsOpsPagination: Pagination = {
    fromPage: 0,
    itemsPerPage: 10
  }

  signedMessagesPagination: Pagination = {
    fromPage: 0,
    itemsPerPage: 10
  }

  filters: Filters | null = null

  isInitialized: boolean = false

  #relayerUrl: string

  constructor(storage: Storage, accountStates: AccountStates, relayerUrl: string) {
    super()
    this.#storage = storage
    this.#accountStates = accountStates
    this.#initialLoadPromise = this.#load()
    this.#relayerUrl = relayerUrl
  }

  async #load(): Promise<void> {
    const [accountsOps, signedMessages] = await Promise.all([
      this.#storage.get('accountsOps', {}),
      this.#storage.get('signedMessages', {})
    ])

    this.#accountsOps = accountsOps
    this.#signedMessages = signedMessages

    this.emitUpdate()
  }

  init({ filters }: { filters: Filters }) {
    this.filters = filters
    this.isInitialized = true

    this.accountsOps = this.filterAndPaginateAccountOps(
      this.#accountsOps,
      this.accountsOpsPagination
    )
    this.signedMessages = this.filterAndPaginateSignedMessages(
      this.#signedMessages,
      this.signedMessagesPagination
    )

    this.emitUpdate()
  }

  reset() {
    this.filters = null
    this.isInitialized = false
    this.emitUpdate()
  }

  private filterAndPaginateAccountOps<T>(
    items: {
      [key: string]: { [key: string]: T[] } | undefined
    },
    pagination: Pagination
  ) {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }

    let filteredItems = []
    if (this.filters!.network) {
      filteredItems = items?.[this.filters!.account]?.[this.filters!.network] || []
    } else {
      filteredItems = Object.values(items?.[this.filters!.account] || []).flat()
    }

    const { fromPage, itemsPerPage } = pagination

    return {
      items: filteredItems.slice(fromPage * itemsPerPage, fromPage * itemsPerPage + itemsPerPage),
      itemsTotal: filteredItems.length,
      currentPage: fromPage, // zero/index based
      maxPages: Math.ceil(filteredItems.length / itemsPerPage)
    }
  }

  private filterAndPaginateSignedMessages<T>(
    items: {
      [key: string]: T[] | undefined
    },
    pagination: Pagination
  ) {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }
    const filteredItems = items?.[this.filters!.account] || []
    const { fromPage, itemsPerPage } = pagination

    return {
      items: filteredItems.slice(fromPage * itemsPerPage, fromPage * itemsPerPage + itemsPerPage),
      itemsTotal: filteredItems.length,
      currentPage: fromPage, // zero/index based
      maxPages: Math.ceil(filteredItems.length / itemsPerPage)
    }
  }

  async addAccountOp(accountOp: SubmittedAccountOp) {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }

    await this.#initialLoadPromise

    const account = accountOp.accountAddr
    const network = accountOp.networkId

    if (!this.#accountsOps[account]) this.#accountsOps[account] = {}
    if (!this.#accountsOps[account][network]) this.#accountsOps[account][network] = []

    // newest SubmittedAccountOp goes first in the list
    this.#accountsOps[account][network].unshift({ ...accountOp })
    trim(this.#accountsOps[account][network])

    this.accountsOps = this.filterAndPaginateAccountOps(
      this.#accountsOps,
      this.accountsOpsPagination
    )

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
  async updateAccountsOpsStatuses(): Promise<boolean> {
    await this.#initialLoadPromise

    // Here we don't rely on `this.isInitialized` flag, as it checks for both `this.filters.account` and `this.filters.network` existence.
    // Banners are network agnostic, and that's the reason we check for `this.filters.account` only and having this.#accountsOps loaded.
    if (!this.filters?.account || !this.#accountsOps[this.filters.account]) return false

    // This flag tracks the changes to AccountsOps statuses
    // and optimizes the number of the emitted updates and storage/state updates.
    let shouldEmitUpdate = false

    await Promise.all(
      Object.keys(this.#accountsOps[this.filters.account]).map(async (network) => {
        const networkConfig = networks.find((x) => x.id === network)
        const provider = new JsonRpcProvider(networkConfig!.rpcUrl)

        return Promise.all(
          this.#accountsOps[this.filters!.account][network].map(
            async (accountOp, accountOpIndex) => {
              // Don't update the current network account ops statuses,
              // as the statuses are already updated in the previous calls.
              if (accountOp.status !== AccountOpStatus.BroadcastedButNotConfirmed) return

              shouldEmitUpdate = true

              const is4337 = isErc4337Broadcast(
                networkConfig!,
                this.#accountStates[accountOp.accountAddr][accountOp.networkId]
              )
              try {
                const receipt = is4337
                  ? await bundler.getReceipt(accountOp.txnId, networkConfig!)
                  : await provider.getTransactionReceipt(accountOp.txnId)
                if (receipt) {
                  this.#accountsOps[this.filters!.account][network][accountOpIndex].status =
                    receipt.status ? AccountOpStatus.Success : AccountOpStatus.Failure
                  return
                }
              } catch {
                this.emitError({
                  level: 'silent',
                  message: `Failed to determine transaction status on ${accountOp.networkId} for ${accountOp.txnId}.`,
                  error: new Error(
                    `activity: failed to get transaction receipt for ${accountOp.txnId}`
                  )
                })
              }

              if (
                (!is4337 &&
                  this.#accountStates[accountOp.accountAddr][accountOp.networkId].nonce >
                    accountOp.nonce) ||
                (is4337 &&
                  this.#accountStates[accountOp.accountAddr][accountOp.networkId].erc4337Nonce >
                    accountOp.nonce)
              ) {
                this.#accountsOps[this.filters!.account][network][accountOpIndex].status =
                  AccountOpStatus.UnknownButPastNonce
              }
            }
          )
        )
      })
    )

    if (shouldEmitUpdate) {
      await this.#storage.set('accountsOps', this.#accountsOps)
      this.accountsOps = this.filterAndPaginateAccountOps(
        this.#accountsOps,
        this.accountsOpsPagination
      )
      this.emitUpdate()
    }

    return shouldEmitUpdate
  }

  async addSignedMessage(signedMessage: SignedMessage, account: string) {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }

    await this.#initialLoadPromise

    if (!this.#signedMessages[account]) this.#signedMessages[account] = []

    // newest SignedMessage goes first in the list
    this.#signedMessages[account].unshift(signedMessage)
    trim(this.#signedMessages[account])
    this.signedMessages = this.filterAndPaginateSignedMessages(
      this.#signedMessages,
      this.signedMessagesPagination
    )

    await this.#storage.set('signedMessages', this.#signedMessages)
    this.emitUpdate()
  }

  setFilters(filters: Filters): void {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }

    this.filters = filters
    this.accountsOps = this.filterAndPaginateAccountOps(
      this.#accountsOps,
      this.accountsOpsPagination
    )
    this.signedMessages = this.filterAndPaginateSignedMessages(
      this.#signedMessages,
      this.signedMessagesPagination
    )

    this.emitUpdate()
  }

  setAccountsOpsPagination(pagination: Pagination): void {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }

    this.accountsOpsPagination = pagination

    this.accountsOps = this.filterAndPaginateAccountOps(
      this.#accountsOps,
      this.accountsOpsPagination
    )
    this.emitUpdate()
  }

  setSignedMessagesPagination(pagination: Pagination): void {
    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }

    this.signedMessagesPagination = pagination

    this.signedMessages = this.filterAndPaginateSignedMessages(
      this.#signedMessages,
      this.signedMessagesPagination
    )
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
    // Here we don't rely on `this.isInitialized` flag, as it checks for both `this.filters.account` and `this.filters.network` existence.
    // Banners are network agnostic, and that's the reason we check for `this.filters.account` only and having this.#accountsOps loaded.
    if (!this.filters?.account || !this.#accountsOps[this.filters.account]) return []

    return Object.values(this.#accountsOps[this.filters.account])
      .flat()
      .filter((accountOp) => accountOp.status === AccountOpStatus.BroadcastedButNotConfirmed)
  }

  get banners(): Banner[] {
    return this.broadcastedButNotConfirmed.map((accountOp) => {
      const network = networks.find((x) => x.id === accountOp.networkId)!

      const is4337 = isErc4337Broadcast(
        network,
        this.#accountStates[accountOp.accountAddr][accountOp.networkId]
      )
      return {
        id: accountOp.txnId,
        topic: 'TRANSACTION',
        title: 'Transaction successfully signed and sent!\nCheck it out on the block explorer!',
        text: '',
        actions: [
          {
            label: 'Check',
            actionName: 'open-external-url',
            meta: {
              url: is4337
                ? `${this.#relayerUrl}/userOp/${accountOp.networkId}/${accountOp.txnId}`
                : `${network.explorerUrl}/tx/${accountOp.txnId}`
            }
          }
        ]
      } as Banner
    })
  }

  toJSON() {
    return {
      ...this,
      broadcastedButNotConfirmed: this.broadcastedButNotConfirmed, // includes the getter in the stringified instance
      banners: this.banners // includes the getter in the stringified instance
    }
  }
}
