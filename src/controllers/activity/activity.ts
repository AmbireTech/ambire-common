import EventEmitter from '../eventEmitter'
import { Storage } from '../../interfaces/storage'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { SignedMessage } from '../../interfaces/userRequest'

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

interface AccountsOps extends PaginationResult {
  items: AccountOp[]
}
interface SignedMessages extends PaginationResult {
  items: SignedMessage[]
}

interface Filters {
  account: string
  network: string
}

interface InternalAccountsOps {
  // account => network => AccountOp[]
  [key: string]: { [key: string]: AccountOp[] }
}

interface InternalSignedMessages {
  // account => network => SignedMessage[]
  [key: string]: { [key: string]: SignedMessage[] }
}

export class ActivityController extends EventEmitter {
  private storage: Storage

  private initialLoadPromise: Promise<void>

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

  constructor(storage: Storage, filters: Filters) {
    super()
    this.storage = storage
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

  // @TODO: Implement AccountOp status - pending | confirmed | failed
  async addAccountOp(accountOp: AccountOp) {
    await this.initialLoadPromise

    const account = accountOp.accountAddr
    const network = accountOp.networkId

    if (!this.#accountsOps[account]) this.#accountsOps[account] = {}
    if (!this.#accountsOps[account][network]) this.#accountsOps[account][network] = []

    this.#accountsOps[account][network].push(accountOp)
    this.accountsOps = this.filterAndPaginate(this.#accountsOps, this.accountsOpsPagination)

    await this.storage.set('accountsOps', this.#accountsOps)
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
}
