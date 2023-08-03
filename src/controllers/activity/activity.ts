import { JsonRpcProvider } from 'ethers'
import EventEmitter from '../eventEmitter'
import { Storage } from '../../interfaces/storage'
import { AccountOp, AccountOpStatus } from '../../libs/accountOp/accountOp'
import { SignedMessage } from '../../interfaces/userRequest'
import { networks } from '../../consts/networks'
import { AccountStates } from '../main/main'

interface Pagination {
  fromPage: number
  itemsPerPage: number
}

interface PaginationResult {
  items: any[]
  itemsTotal: number
  currentPage: number
  maxPages: number
}

export interface SubmittedAccountOp extends AccountOp {
  txnId: string
  nonce: number
}

interface AccountsOps extends PaginationResult {
  items: SubmittedAccountOp[]
}
interface SignedMessages extends PaginationResult {
  items: SignedMessage[]
}

interface Filters {
  account: string
  network: string
}

interface InternalAccountsOps {
  // account => network => SubmittedAccountOp[]
  [key: string]: { [key: string]: SubmittedAccountOp[] }
}

interface InternalSignedMessages {
  // account => network => SignedMessage[]
  [key: string]: { [key: string]: SignedMessage[] }
}

export class ActivityController extends EventEmitter {
  private storage: Storage

  private initialLoadPromise: Promise<void>

  private accounts: AccountStates

  #accountsOps: InternalAccountsOps = {}

  accountsOps: AccountsOps | undefined

  #signedMessages: InternalSignedMessages = {}

  signedMessages: SignedMessages | undefined

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
    this.storage = storage
    this.accounts = accounts
    this.filters = filters
    this.initialLoadPromise = this.load()
  }

  private async load(): Promise<void> {
    const [accountsOps, signedMessages] = await Promise.all([
      this.storage.get('accountsOps', {}),
      this.storage.get('signedMessages', {})
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

  private filterAndPaginate(
    items: InternalAccountsOps | InternalSignedMessages,
    pagination: Pagination
  ): PaginationResult {
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
    await this.initialLoadPromise

    const account = accountOp.accountAddr
    const network = accountOp.networkId

    if (!this.#accountsOps[account]) this.#accountsOps[account] = {}
    if (!this.#accountsOps[account][network]) this.#accountsOps[account][network] = []

    this.#accountsOps[account][network].push({ ...accountOp, status: AccountOpStatus.Pending })
    this.accountsOps = this.filterAndPaginate(this.#accountsOps, this.accountsOpsPagination)

    await this.storage.set('accountsOps', this.#accountsOps)
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
            this.accounts[accountOp.accountAddr][accountOp.networkId].nonce > accountOp.nonce
          ) {
            accountsOps[index].status = AccountOpStatus.UnknownButPastNonce
          }
        })
    )
    await this.storage.set('accountsOps', this.#accountsOps)
    this.accountsOps = this.filterAndPaginate(this.#accountsOps, this.accountsOpsPagination)
    this.emitUpdate()
  }

  async addSignedMessage(signedMessage: SignedMessage, account: string, network: string) {
    await this.initialLoadPromise

    if (!this.#signedMessages[account]) this.#signedMessages[account] = {}
    if (!this.#signedMessages[account][network]) this.#signedMessages[account][network] = []

    this.#signedMessages[account][network].push(signedMessage)
    this.signedMessages = this.filterAndPaginate(
      this.#signedMessages,
      this.signedMessagesPagination
    )

    await this.storage.set('signedMessages', this.#signedMessages)
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
    this.accounts = accounts
  }
}
