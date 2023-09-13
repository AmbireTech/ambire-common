/* eslint-disable no-underscore-dangle */
import { JsonRpcProvider } from 'ethers'

import { networks } from '../../consts/networks'
import { Account, AccountId, AccountStates } from '../../interfaces/account'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { Message, UserRequest } from '../../interfaces/userRequest'
import { AccountOp, Call as AccountOpCall } from '../../libs/accountOp/accountOp'
import { getAccountState } from '../../libs/accountState/accountState'
import { estimate, EstimateResult } from '../../libs/estimate/estimate'
import { Key, Keystore, KeystoreSignerType } from '../../libs/keystore/keystore'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { AccountAdderController } from '../accountAdder/accountAdder'
import { ActivityController } from '../activity/activity'
import { EmailVaultController } from '../emailVault'
import EventEmitter from '../eventEmitter'
import { KeystoreController } from '../keystore/keystore'
import { PortfolioController } from '../portfolio/portfolio'
import { SignMessageController } from '../signMessage/signMessage'

export class MainController extends EventEmitter {
  // Private library instances
  private storage: Storage

  #keystoreLib: Keystore

  #providers: { [key: string]: JsonRpcProvider } = {}

  // Holds the initial load promise, so that one can wait until it completes
  private initialLoadPromise: Promise<void>

  #callRelayer: Function

  accountStates: AccountStates = {}

  isReady: boolean = false

  keystore: KeystoreController

  accountAdder: AccountAdderController

  // Subcontrollers
  // this is not private cause you're supposed to directly access it
  portfolio: PortfolioController

  // Public sub-structures
  // @TODO emailVaults
  emailVault: EmailVaultController

  signMessage!: SignMessageController

  activity!: ActivityController

  // @TODO read networks from settings
  accounts: Account[] = []

  selectedAccount: string | null = null

  keys: Key[] = []

  // @TODO: structure
  settings: { networks: NetworkDescriptor[] }

  userRequests: UserRequest[] = []

  // The reason we use a map structure and not a flat array is:
  // 1) it's easier in the UI to deal with structured data rather than having to .find/.filter/etc. all the time
  // 2) it's easier to mutate this - to add/remove accountOps, to find the right accountOp to extend, etc.
  // accountAddr => networkId => { accountOp, estimation }
  // @TODO consider getting rid of the `| null` ugliness, but then we need to auto-delete
  accountOpsToBeSigned: {
    [key: string]: {
      [key: string]: { accountOp: AccountOp; estimation: EstimateResult | null } | null
    }
  } = {}

  accountOpsToBeConfirmed: { [key: string]: { [key: string]: AccountOp } } = {}

  // accountAddr => UniversalMessage[]
  messagesToBeSigned: { [key: string]: Message[] } = {}

  lastUpdate: Date = new Date()

  onResolveDappRequest: (data: any, id?: bigint) => void

  onRejectDappRequest: (err: any, id?: bigint) => void

  onUpdateDappSelectedAccount: (accountAddr: string) => void

  constructor({
    storage,
    fetch,
    relayerUrl,
    keystoreSigners,
    onResolveDappRequest,
    onRejectDappRequest,
    onUpdateDappSelectedAccount
  }: {
    storage: Storage
    fetch: Function
    relayerUrl: string
    keystoreSigners: { [key: string]: KeystoreSignerType }
    onResolveDappRequest: (data: any, id?: bigint) => void
    onRejectDappRequest: (err: any, id?: bigint) => void
    onUpdateDappSelectedAccount: (accountAddr: string) => void
  }) {
    super()
    this.storage = storage
    this.portfolio = new PortfolioController(storage, relayerUrl)
    this.#keystoreLib = new Keystore(storage, keystoreSigners)
    this.keystore = new KeystoreController(this.#keystoreLib)
    this.settings = { networks }
    this.initialLoadPromise = this.load()
    this.emailVault = new EmailVaultController(storage, fetch, relayerUrl, this.#keystoreLib)
    this.accountAdder = new AccountAdderController({ storage, relayerUrl, fetch })
    this.#callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
    this.onResolveDappRequest = onResolveDappRequest
    this.onRejectDappRequest = onRejectDappRequest
    this.onUpdateDappSelectedAccount = onUpdateDappSelectedAccount
    // @TODO Load userRequests from storage and emit that we have updated
    // @TODO
  }

  private async load(): Promise<void> {
    this.isReady = false
    this.emitUpdate()
    ;[this.keys, this.accounts, this.selectedAccount] = await Promise.all([
      this.#keystoreLib.getKeys(),
      this.storage.get('accounts', []),
      this.storage.get('selectedAccount', null)
    ])
    this.#providers = Object.fromEntries(
      this.settings.networks.map((network) => [network.id, new JsonRpcProvider(network.rpcUrl)])
    )
    // @TODO reload those
    // @TODO error handling here
    this.accountStates = await this.getAccountsInfo(this.accounts)
    this.signMessage = new SignMessageController(this.#keystoreLib, this.#providers)
    this.activity = new ActivityController(this.storage, this.accountStates)

    const isKeystoreReady = await this.#keystoreLib.isReadyToStoreKeys()
    this.keystore.setIsReadyToStoreKeys(isKeystoreReady)

    const addReadyToAddAccountsIfNeeded = () => {
      if (
        !this.accountAdder.readyToAddAccounts.length &&
        this.accountAdder.addAccountsStatus !== 'SUCCESS'
      )
        return

      this.addAccounts(this.accountAdder.readyToAddAccounts)
    }
    this.accountAdder.onUpdate(addReadyToAddAccountsIfNeeded)

    this.isReady = true
    this.emitUpdate()
  }

  private async getAccountsInfo(accounts: Account[]): Promise<AccountStates> {
    const result = await Promise.all(
      this.settings.networks.map((network) =>
        getAccountState(this.#providers[network.id], network, accounts)
      )
    )

    const states = accounts.map((acc: Account, accIndex: number) => {
      return [
        acc.addr,
        Object.fromEntries(
          this.settings.networks.map((network: NetworkDescriptor, netIndex: number) => {
            return [network.id, result[netIndex][accIndex]]
          })
        )
      ]
    })

    return Object.fromEntries(states)
  }

  async updateAccountStates() {
    this.accountStates = await this.getAccountsInfo(this.accounts)
    this.lastUpdate = new Date()
    this.emitUpdate()
  }

  async selectAccount(toAccountAddr: string) {
    await this.initialLoadPromise

    if (!this.accounts.find((acc) => acc.addr === toAccountAddr)) {
      // TODO: error handling, trying to switch to account that does not exist
      return
    }

    this.selectedAccount = toAccountAddr
    await this.storage.set('selectedAccount', toAccountAddr)
    this.updateSelectedAccount(toAccountAddr)
    this.onUpdateDappSelectedAccount(toAccountAddr)
    this.emitUpdate()
  }

  async addAccounts(accounts: Account[] = []) {
    if (!accounts.length) return

    const alreadyAddedAddressSet = new Set(this.accounts.map((account) => account.addr))
    const newAccounts = accounts.filter((account) => !alreadyAddedAddressSet.has(account.addr))

    if (!newAccounts.length) return

    const nextAccounts = [...this.accounts, ...newAccounts]
    await this.storage.set('accounts', nextAccounts)
    this.accounts = nextAccounts

    this.emitUpdate()
  }

  private async ensureAccountInfo(accountAddr: AccountId, networkId: NetworkId) {
    await this.initialLoadPromise
    // Initial sanity check: does this account even exist?
    if (!this.accounts.find((x) => x.addr === accountAddr))
      throw new Error(`ensureAccountInfo: called for non-existant acc ${accountAddr}`)
    // If this still didn't work, re-load
    // @TODO: should we re-start the whole load or only specific things?
    if (!this.accountStates[accountAddr]?.[networkId]) await (this.initialLoadPromise = this.load())
    // If this still didn't work, throw error: this prob means that we're calling for a non-existant acc/network
    if (!this.accountStates[accountAddr]?.[networkId])
      throw new Error(
        `ensureAccountInfo: acc info for ${accountAddr} on ${networkId} was not retrieved`
      )
  }

  private makeAccountOpFromUserRequests(
    accountAddr: AccountId,
    networkId: NetworkId
  ): AccountOp | null {
    const account = this.accounts.find((x) => x.addr === accountAddr)
    if (!account)
      throw new Error(
        `makeAccountOpFromUserRequests: tried to run for non-existant account ${accountAddr}`
      )
    // Note: we use reduce instead of filter/map so that the compiler can deduce that we're checking .kind
    const calls = this.userRequests.reduce((uCalls: AccountOpCall[], req) => {
      // only the first one for EOAs
      if (!account.creation && uCalls.length > 0) return uCalls

      if (
        req.action.kind === 'call' &&
        req.networkId === networkId &&
        req.accountAddr === accountAddr
      ) {
        const { to, value, data } = req.action
        uCalls.push({ to, value, data, fromUserRequestId: req.id })
      }
      return uCalls
    }, [])

    if (!calls.length) return null

    const currentAccountOp = this.accountOpsToBeSigned[accountAddr][networkId]?.accountOp
    return {
      accountAddr,
      networkId,
      signingKeyAddr: currentAccountOp?.signingKeyAddr || null,
      gasLimit: currentAccountOp?.gasLimit || null,
      gasFeePayment: currentAccountOp?.gasFeePayment || null,
      // We use the AccountInfo to determine
      nonce: this.accountStates[accountAddr][networkId].nonce,
      // @TODO set this to a spoofSig based on accountState
      signature: null,
      // @TODO from pending recoveries
      accountOpToExecuteBefore: null,
      calls
    }
  }

  updateSelectedAccount(selectedAccount: string | null = null) {
    if (!selectedAccount) return
    this.portfolio.getAdditionalPortfolio(selectedAccount)
    this.portfolio.updateSelectedAccount(this.accounts, this.settings.networks, selectedAccount)
  }

  async addUserRequest(req: UserRequest) {
    this.userRequests.push(req)
    const { id, action, accountAddr, networkId } = req
    if (!this.settings.networks.find((x) => x.id === networkId))
      throw new Error(`addUserRequest: ${networkId}: network does not exist`)
    if (action.kind === 'call') {
      // @TODO: if EOA, only one call per accountOp
      if (!this.accountOpsToBeSigned[accountAddr]) this.accountOpsToBeSigned[accountAddr] = {}
      // @TODO
      // one solution would be to, instead of checking, have a promise that we always await here, that is responsible for fetching
      // account data; however, this won't work with EOA accountOps, which have to always pick the first userRequest for a particular acc/network,
      // and be recalculated when one gets dismissed
      // although it could work like this: 1) await the promise, 2) check if exists 3) if not, re-trigger the promise;
      // 4) manage recalc on removeUserRequest too in order to handle EOAs
      // @TODO consider re-using this whole block in removeUserRequest
      await this.ensureAccountInfo(accountAddr, networkId)
      const accountOp = this.makeAccountOpFromUserRequests(accountAddr, networkId)
      if (accountOp) {
        this.accountOpsToBeSigned[accountAddr][networkId] = { accountOp, estimation: null }
        try {
          await this.estimateAccountOp(accountOp)
        } catch (e) {
          // @TODO: unified wrapper for controller errors
          console.error(e)
        }
      }
    } else {
      if (!this.messagesToBeSigned[accountAddr]) this.messagesToBeSigned[accountAddr] = []
      if (this.messagesToBeSigned[accountAddr].find((x) => x.fromUserRequestId === req.id)) return
      this.messagesToBeSigned[accountAddr].push({
        id,
        content: action,
        fromUserRequestId: req.id,
        signature: null,
        accountAddr
      })
    }
    this.emitUpdate()
  }

  // @TODO allow this to remove multiple OR figure out a way to debounce re-estimations
  // first one sounds more reasonble
  // although the second one can't hurt and can help (or no debounce, just a one-at-a-time queue)
  removeUserRequest(id: bigint) {
    const req = this.userRequests.find((uReq) => uReq.id === id)
    if (!req) return

    // remove from the request queue
    this.userRequests.splice(this.userRequests.indexOf(req), 1)

    // update the pending stuff to be signed
    const { action, accountAddr, networkId } = req
    if (action.kind === 'call') {
      // @TODO ensure acc info, re-estimate
      const accountOp = this.makeAccountOpFromUserRequests(accountAddr, networkId)
      if (accountOp)
        this.accountOpsToBeSigned[accountAddr][networkId] = { accountOp, estimation: null }
    } else {
      this.messagesToBeSigned[accountAddr] = this.messagesToBeSigned[accountAddr].filter(
        (x) => x.fromUserRequestId !== id
      )
    }
    this.emitUpdate()
  }

  async reestimateCurrentAccountOp(accountAddr: AccountId, networkId: NetworkId) {
    const accountOp = this.accountOpsToBeSigned[accountAddr][networkId]?.accountOp
    // non fatal, no need to do anything
    if (!accountOp) return
    await this.estimateAccountOp(accountOp)
  }

  // @TODO: protect this from race conditions/simultanous executions
  private async estimateAccountOp(accountOp: AccountOp) {
    await this.initialLoadPromise
    // new accountOps should have spoof signatures so that they can be easily simulated
    // this is not used by the Estimator, because it iterates through all associatedKeys and
    // it knows which ones are authenticated, and it can generate it's own spoofSig
    // @TODO
    // accountOp.signature = `${}03`

    // TODO check if needed data in accountStates are available
    // this.accountStates[accountOp.accountAddr][accountOp.networkId].
    const account = this.accounts.find((x) => x.addr === accountOp.accountAddr)
    if (!account)
      throw new Error(`estimateAccountOp: ${accountOp.accountAddr}: account does not exist`)
    const network = this.settings.networks.find((x) => x.id === accountOp.networkId)
    if (!network)
      throw new Error(`estimateAccountOp: ${accountOp.networkId}: network does not exist`)
    const [, estimation] = await Promise.all([
      // NOTE: we are not emitting an update here because the portfolio controller will do that
      // NOTE: the portfolio controller has it's own logic of constructing/caching providers, this is intentional, as
      // it may have different needs
      this.portfolio.updateSelectedAccount(
        this.accounts,
        this.settings.networks,
        accountOp.accountAddr,
        Object.fromEntries(
          Object.entries(this.accountOpsToBeSigned[accountOp.accountAddr])
            .filter(([, accOp]) => accOp)
            .map(([networkId, x]) => [networkId, [x!.accountOp]])
        )
      ),
      // @TODO nativeToCheck: pass all EOAs,
      // @TODO feeTokens: pass a hardcoded list from settings
      estimate(this.#providers[accountOp.networkId], network, account, accountOp, [], [])
      // @TODO refresh the estimation
    ])
    this.accountOpsToBeSigned[accountOp.accountAddr][accountOp.networkId]!.estimation = estimation
    console.log(estimation)
  }

  broadcastSignedAccountOp(accountOp) {}

  broadcastSignedMessage(signedMessage: Message) {
    this.activity.addSignedMessage(signedMessage, signedMessage.accountAddr)
    this.removeUserRequest(signedMessage.id)
    this.onResolveDappRequest({ hash: signedMessage.signature }, signedMessage.id)
    this.emitUpdate()
  }
}
