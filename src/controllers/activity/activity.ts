import { networks as predefinedNetworks } from '../../consts/networks'
/* eslint-disable import/no-extraneous-dependencies */
import { Account, AccountId } from '../../interfaces/account'
import { Banner } from '../../interfaces/banner'
import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { Storage } from '../../interfaces/storage'
import { Message } from '../../interfaces/userRequest'
import { isSmartAccount } from '../../libs/account/account'
import { AccountOpStatus } from '../../libs/accountOp/accountOp'
import {
  fetchTxnId,
  isIdentifiedByUserOpHash,
  SubmittedAccountOp
} from '../../libs/accountOp/submittedAccountOp'
import { NetworkNonces } from '../../libs/portfolio/interfaces'
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

  #fetch: Fetch

  #initialLoadPromise: Promise<void>

  #accounts: AccountsController

  #selectedAccount: SelectedAccountController

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

    this.init()
    this.emitUpdate()
  }

  init(filters?: Filters) {
    this.isInitialized = true

    if (filters) {
      this.filters = filters

      this.accountsOps = this.filterAndPaginateAccountOps(
        this.#accountsOps,
        this.accountsOpsPagination
      )
      this.signedMessages = this.filterAndPaginateSignedMessages(
        this.#signedMessages,
        this.signedMessagesPagination
      )
    }

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

    let filteredItems: T[] = []

    if (this.filters) {
      if (this.filters.network) {
        filteredItems = items?.[this.filters.account]?.[this.filters.network] || []
      } else {
        filteredItems = Object.values(items?.[this.filters.account] || []).flat()
      }
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
    const filteredItems = this.filters?.account ? items?.[this.filters.account] || [] : []
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

    if (!this.isInitialized) {
      this.#throwNotInitialized()
      return
    }

    const { accountAddr, networkId } = accountOp

    if (!this.#accountsOps[accountAddr]) this.#accountsOps[accountAddr] = {}
    if (!this.#accountsOps[accountAddr][networkId]) this.#accountsOps[accountAddr][networkId] = []

    // newest SubmittedAccountOp goes first in the list
    this.#accountsOps[accountAddr][networkId].unshift({ ...accountOp })
    trim(this.#accountsOps[accountAddr][networkId])

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
  async updateAccountsOpsStatuses(): Promise<{
    shouldEmitUpdate: boolean
    shouldUpdatePortfolio: boolean
  }> {
    await this.#initialLoadPromise

    // Here we don't rely on `this.isInitialized` flag, as it checks for both `this.filters.account` and `this.filters.network` existence.
    // Banners are network agnostic, and that's the reason we check for `this.filters.account` only and having this.#accountsOps loaded.
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

            // fixed: we should check the account state of the one paying
            // the fee as his nonce gets incremented:
            // - EOA, SA by EOA: the account op holds the EOA nonce
            // - relayer, 4337: the account op holds the SA nonce
            const payedByState =
              this.#accounts.accountStates[accountOp.gasFeePayment!.paidBy] &&
              this.#accounts.accountStates[accountOp.gasFeePayment!.paidBy][accountOp.networkId]
                ? this.#accounts.accountStates[accountOp.gasFeePayment!.paidBy][accountOp.networkId]
                : null
            const isUserOp = isIdentifiedByUserOpHash(accountOp.identifiedBy)

            if (
              payedByState &&
              ((!isUserOp && payedByState.nonce > accountOp.nonce) ||
                (isUserOp && payedByState.erc4337Nonce > accountOp.nonce))
            ) {
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
      this.accountsOps = this.filterAndPaginateAccountOps(
        this.#accountsOps,
        this.accountsOpsPagination
      )
      this.emitUpdate()
    }

    return { shouldEmitUpdate, shouldUpdatePortfolio }
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

  setFilters(filters: Filters) {
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

  removeAccountData(address: Account['addr']) {
    delete this.#accountsOps[address]
    delete this.#signedMessages[address]

    this.accountsOps = this.filterAndPaginateAccountOps(
      this.#accountsOps,
      this.accountsOpsPagination
    )
    this.signedMessages = this.filterAndPaginateSignedMessages(
      this.#signedMessages,
      this.signedMessagesPagination
    )

    this.#storage.set('accountsOps', this.#accountsOps)
    this.#storage.set('signedMessages', this.#signedMessages)

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
    // Here we don't rely on `this.isInitialized` flag, as it checks for both `this.filters.account` and `this.filters.network` existence.
    // Banners are network agnostic, and that's the reason we check for `this.filters.account` only and having this.#accountsOps loaded.
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
    // Here we don't rely on `this.isInitialized` flag, as it checks for both `this.filters.account` and `this.filters.network` existence.
    // Banners are network agnostic, and that's the reason we check for `this.filters.account` only and having this.#accountsOps loaded.
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

          const isCustomNetwork = !predefinedNetworks.find((net) => net.id === network.id)
          const isUserOp = isIdentifiedByUserOpHash(accountOp.identifiedBy)
          const isNotConfirmed = accountOp.status === AccountOpStatus.BroadcastedButNotConfirmed
          const url =
            isUserOp && isNotConfirmed && !isCustomNetwork
              ? `https://jiffyscan.xyz/userOpHash/${accountOp.identifiedBy.identifier}`
              : `${network.explorerUrl}/tx/${accountOp.txnId}`

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
