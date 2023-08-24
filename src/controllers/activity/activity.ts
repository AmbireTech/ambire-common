import { JsonRpcProvider } from 'ethers'

import { networks } from '../../consts/networks'
import { Storage } from '../../interfaces/storage'
import { Message } from '../../interfaces/userRequest'
import { AccountOp, AccountOpStatus } from '../../libs/accountOp/accountOp'
import EventEmitter from '../eventEmitter'
import { AccountStates } from '../main/main'

interface Pagination {
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
  nonce: number
}

interface AccountsOps extends PaginationResult<SubmittedAccountOp> {}
interface MessagesToBeSigned extends PaginationResult<Message> {}

interface Filters {
  account: string
  network: string
}

interface InternalAccountsOps {
  // account => network => SubmittedAccountOp[]
  [key: string]: { [key: string]: SubmittedAccountOp[] }
}

interface InternalSignedMessages {
  // account => network => Message[]
  [key: string]: { [key: string]: Message[] }
}

// We are limiting items array to include no more than 1000 records,
// as we trim out the oldest ones (in the beginning of the items array).
// We do this to maintain optimal storage and performance.
const trim = <T>(items: T[], maxSize = 1000): void => {
  if (items.length > maxSize) {
    // If the array size is greater than maxSize, remove the first (oldest) item
    items.shift()
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
 *   5.1. Once we add a new AccountOp to ActivityController via addAccountOp, we are setting its status to AccountOpStatus.Pending.
 *   5.2. Later, we need to call `updateAccountsOpsStatuses()` from the app.
 *       5.2.1. Then, we firstly rely on getTransactionReceipt for determining the status (success or failure).
 *       5.2.2. If we don't manage to determine its status, we are comparing AccountOp and Account nonce. If Account nonce is greater than AccountOp, then we know that AccountOp has past nonce (AccountOpStatus.UnknownButPastNonce).
 */
export class ActivityController extends EventEmitter {
  #storage: Storage

  #initialLoadPromise: Promise<void>

  #accounts: AccountStates

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

  filters: Filters

  constructor(storage: Storage, accounts: AccountStates, filters: Filters) {
    super()
    this.#storage = storage
    this.#accounts = accounts
    this.filters = filters
    this.#initialLoadPromise = this.#load()
  }

  async #load(): Promise<void> {
    const [accountsOps, signedMessages] = await Promise.all([
      this.#storage.get('accountsOps', {}),
      this.#storage.get('signedMessages', {})
    ])

    this.#accountsOps = accountsOps
    this.#signedMessages = signedMessages

    this.accountsOps = this.filterAndPaginate(this.#accountsOps, this.accountsOpsPagination)
    this.signedMessages = this.filterAndPaginate(
      this.#signedMessages,
      this.signedMessagesPagination
    )

    this.emitUpdate()
  }

  private filterAndPaginate<T>(
    items: {
      [key: string]: { [key: string]: T[] } | undefined
    },
    pagination: Pagination
  ): PaginationResult<T> {
    const filteredItems = items?.[this.filters.account]?.[this.filters.network] || []
    const { fromPage, itemsPerPage } = pagination

    return {
      items: filteredItems.slice(fromPage * itemsPerPage, fromPage * itemsPerPage + itemsPerPage),
      itemsTotal: filteredItems.length,
      currentPage: fromPage, // zero/index based
      maxPages: Math.ceil(filteredItems.length / itemsPerPage)
    }
  }

  async addAccountOp(accountOp: SubmittedAccountOp) {
    await this.#initialLoadPromise

    const account = accountOp.accountAddr
    const network = accountOp.networkId

    if (!this.#accountsOps[account]) this.#accountsOps[account] = {}
    if (!this.#accountsOps[account][network]) this.#accountsOps[account][network] = []

    this.#accountsOps[account][network].push({ ...accountOp, status: AccountOpStatus.Pending })
    trim(this.#accountsOps[account][network])

    this.accountsOps = this.filterAndPaginate(this.#accountsOps, this.accountsOpsPagination)

    await this.#storage.set('accountsOps', this.#accountsOps)
    this.emitUpdate()
  }

  /**
   * Update AccountsOps statuses (inner and public state, and storage)
   *
   * Here is the algorithm:
   * 0. Once we add a new AccountOp to ActivityController via `addAccountOp`, we are setting its status to AccountOpStatus.Pending.
   * 1. Here, we firstly rely on `getTransactionReceipt` for determining the status (success or failure).
   * 2. If we don't manage to determine its status, we are comparing AccountOp and Account nonce.
   * If Account nonce is greater than AccountOp, then we know that AccountOp has past nonce (AccountOpStatus.UnknownButPastNonce).
   */
  async updateAccountsOpsStatuses() {
    const accountsOps = this.#accountsOps?.[this.filters.account]?.[this.filters.network] || []
    const network = networks.find((x) => x.id === this.filters.network)
    const provider = new JsonRpcProvider(network!.rpcUrl)

    // We are updating Pending AccountsOps only, because we already updated the rest AccountsOps
    await Promise.all(
      accountsOps
        .filter((accountOp) => accountOp.status === AccountOpStatus.Pending)
        .map(async (accountOp, index) => {
          const receipt = await provider.getTransactionReceipt(accountOp.txnId)

          if (receipt) {
            accountsOps[index].status = receipt.status
              ? AccountOpStatus.Success
              : AccountOpStatus.Failure
          } else if (
            this.#accounts[accountOp.accountAddr][accountOp.networkId].nonce > accountOp.nonce
          ) {
            accountsOps[index].status = AccountOpStatus.UnknownButPastNonce
          }
        })
    )
    await this.#storage.set('accountsOps', this.#accountsOps)
    this.accountsOps = this.filterAndPaginate(this.#accountsOps, this.accountsOpsPagination)
    this.emitUpdate()
  }

  async addSignedMessage(signedMessage: Message, account: string, network: string) {
    await this.#initialLoadPromise

    if (!this.#signedMessages[account]) this.#signedMessages[account] = {}
    if (!this.#signedMessages[account][network]) this.#signedMessages[account][network] = []

    this.#signedMessages[account][network].push(signedMessage)
    trim(this.#signedMessages[account][network])
    this.signedMessages = this.filterAndPaginate(
      this.#signedMessages,
      this.signedMessagesPagination
    )

    await this.#storage.set('signedMessages', this.#signedMessages)
    this.emitUpdate()
  }

  setFilters(filters: Filters): void {
    this.filters = filters
    this.accountsOps = this.filterAndPaginate(this.#accountsOps, this.accountsOpsPagination)
    this.signedMessages = this.filterAndPaginate(
      this.#signedMessages,
      this.signedMessagesPagination
    )

    this.emitUpdate()
  }

  setAccountsOpsPagination(pagination: Pagination): void {
    this.accountsOpsPagination = pagination

    this.accountsOps = this.filterAndPaginate(this.#accountsOps, this.accountsOpsPagination)
    this.emitUpdate()
  }

  setSignedMessagesPagination(pagination: Pagination): void {
    this.signedMessagesPagination = pagination

    this.signedMessages = this.filterAndPaginate(
      this.#signedMessages,
      this.signedMessagesPagination
    )
    this.emitUpdate()
  }

  setAccounts(accounts: AccountStates) {
    this.#accounts = accounts
  }
}
