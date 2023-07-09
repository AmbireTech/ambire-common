import { TypedDataDomain, TypedDataField, JsonRpcProvider } from 'ethers'
import { Storage } from '../../interfaces/storage'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
import { Account, AccountId, AccountOnchainState } from '../../interfaces/account'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { PortfolioController } from '../portfolio'
import { Keystore, Key } from '../../libs/keystore/keystore'
import { networks } from '../../consts/networks'
import EventEmitter from '../eventEmitter'
import { getAccountState } from '../../libs/accountState/accountState'
import { estimate } from '../../libs/estimate/estimate'

// @TODO move to interfaces/userRequest.ts?
export interface Call {
  kind: 'call'
  to: string
  value: bigint
  data: string
}
export interface PlainTextMessage {
  kind: 'message'
  message: string | Uint8Array
}
export interface TypedMessage {
  kind: 'typedMessage'
  domain: TypedDataDomain
  types: Record<string, Array<TypedDataField>>
  value: Record<string, any>
}
// @TODO: move this type and it's deps (PlainTextMessage, TypedMessage) to another place,
// probably interfaces
export interface SignedMessage {
  content: PlainTextMessage | TypedMessage
  signature: string | null
  fromUserRequestId?: bigint
}

export interface UserRequest {
  // Unlike the AccountOp, which we compare by content,
  // we need a distinct identifier here that's set by whoever is posting the request
  // the requests cannot be compared by content because it's valid for a user to post two or more identical ones
  // while for AccountOps we do only care about their content in the context of simulations
  id: bigint
  added: bigint // timestamp
  networkId: NetworkId
  accountAddr: AccountId
  forceNonce: bigint | null
  // either-or here between call and a message, plus different types of messages
  action: Call | PlainTextMessage | TypedMessage
}
// type State = Map<AccountId, Map<NetworkId, any>>

export type AccountStates = {
  [accountId: string]: {
    [networkId: string]: AccountOnchainState
  }
}

export class MainController extends EventEmitter {
  private storage: Storage

  private keystore: Keystore

  private initialLoadPromise: Promise<void>

  isReady: boolean = false

  // this is not private cause you're supposed to directly access it
  portfolio: PortfolioController

  // @TODO emailVaults
  // @TODO read networks from settings
  accounts: Account[] = []

  accountStates: AccountStates = {}

  keys: Key[] = []

  selectedAccount: string | null = null

  // @TODO: structure
  settings: { networks: NetworkDescriptor[] }

  userRequests: UserRequest[] = []

  // The reason we use a map structure and not a flat array is:
  // 1) it's easier in the UI to deal with structured data rather than having to .find/.filter/etc. all the time
  // 2) it's easier to mutate this - to add/remove accountOps, to find the right accountOp to extend, etc.
  // accountAddr => networkId => accountOp
  accountOpsToBeSigned: { [key: string]: { [key: string]: AccountOp | null } } = {}

  accountOpsToBeConfirmed: { [key: string]: { [key: string]: AccountOp } } = {}

  // accountAddr => UniversalMessage[]
  messagesToBeSigned: { [key: string]: SignedMessage[] } = {}

  constructor(storage: Storage) {
    super()
    this.storage = storage
    this.portfolio = new PortfolioController(storage)
    // @TODO: KeystoreSigners
    this.keystore = new Keystore(storage, {})
    this.initialLoadPromise = this.load()
    this.settings = { networks }
    // Load userRequests from storage and emit that we have updated
    // @TODO
  }

  private async load(): Promise<void> {
    ;[this.keys, this.accounts] = await Promise.all([
      this.keystore.getKeys(),
      this.storage.get('accounts', [])
    ])
    // @TODO reload those
    // @TODO error handling here
    this.accountStates = await this.getAccountsInfo(this.accounts)
    this.isReady = true
    this.emitUpdate()
  }

  private async getAccountsInfo(accounts: Account[]): Promise<AccountStates> {
    const result = await Promise.all(
      this.settings.networks.map((network: NetworkDescriptor) => {
        // @TODO cache provider
        const provider = new JsonRpcProvider(network.rpcUrl)
        return getAccountState(provider, network, accounts)
      })
    )

    const states = accounts.map((acc: Account, accIndex: number) => {
      return [
        acc.addr,
        Object.fromEntries(this.settings.networks.map((network: NetworkDescriptor, netIndex: number) => {
          return [network.id, result[netIndex][accIndex]]
        }))
      ]
    })

    return Object.fromEntries(states)
  }

  private async ensureAccountInfo(accountAddr: AccountId, networkId: NetworkId) {
    // Wait for the current load to complete
    await this.initialLoadPromise
    // Initial sanity check: does this account even exist?
    if (!this.accounts.find(x => x.addr === accountAddr)) throw new Error(`ensureAccountInfo: called for non-existant acc ${accountAddr}`)
    // If this still didn't work, re-load
    // @TODO: should we re-start the whole load or only specific things?
    if (!this.accountStates[accountAddr]?.[networkId]) await (this.initialLoadPromise = this.load())
    // If this still didn't work, throw error: this prob means that we're calling for a non-existant acc/network
    if (!this.accountStates[accountAddr]?.[networkId]) throw new Error(`ensureAccountInfo: acc info for ${accountAddr} on ${networkId} was not retrieved`)
  }

  private getAccountOp(accountAddr: AccountId, networkId: NetworkId): AccountOp | null {
    const account = this.accounts.find(x => x.addr === accountAddr)
    if (!account) throw new Error(`getAccountOp: tried to run for non-existant account ${accountAddr}`)
    // @TODO consider bringing back functional style if we can figure out how not to trip up the TS compiler
    /*const calls = this.userRequests
        .filter(req => req.action.kind === 'call' && req.networkId === networkId && req.accountAddr === accountAddr)
        .map(req => ({ ...req.action, fromUserRequestId: req.id }))
        // only take the first one for EOAs
        .slice(0, account.creation ? Infinity : 1)
    */
    const calls = []
    for (const req of this.userRequests) {
      if (req.action.kind === 'call' && req.networkId === networkId && req.accountAddr === accountAddr) {
        const { to, value, data } = req.action
        calls.push({ to, value, data, fromUserRequestId: req.id })
      }
      // only the first one for EOAs
      if (!account.creation) break
    }

    if (!calls.length) return null

    // @TODO keep old properties from the current one!
    return {
      accountAddr,
      networkId,
      signingKeyAddr: null,
      gasLimit: null,
      gasFeePayment: null,
      // We use the AccountInfo to determine
      nonce: this.accountStates[accountAddr][networkId].nonce,
      // @TODO set this to a spoofSig based on accountState
      signature: null,
      // @TODO from pending recoveries
      accountOpToExecuteBefore: null,
      calls
     }
  }

  async addUserRequest(req: UserRequest) {
    this.userRequests.push(req)
    const { action, accountAddr, networkId } = req
    if (!this.settings.networks.find(x => x.id === networkId)) throw new Error(`addUserRequest: ${networkId}: network does not exist`)
    if (action.kind === 'call') {
      // @TODO: if EOA, only one call per accountOp
      if (!this.accountOpsToBeSigned[accountAddr]) this.accountOpsToBeSigned[accountAddr] = {}
      // @TODO
      // one solution would be to, instead of checking, have a promise that we always await here, that is responsible for fetching
      // account data; however, this won't work with EOA accountOps, which have to always pick the first userRequest for a particular acc/network,
      // and be recalculated when one gets dismissed
      // although it could work like this: 1) await the promise, 2) check if exists 3) if not, re-trigger the promise; 
      // 4) manage recalc on removeUserRequest too in order to handle EOAs
      await this.ensureAccountInfo(accountAddr, networkId)
      const accountOp = this.getAccountOp(accountAddr, networkId)
      this.accountOpsToBeSigned[accountAddr][networkId] = accountOp
      try {
        if (accountOp) await this.estimateAccountOp(accountOp)
      } catch(e) {
        // @TODO: unified wrapper for controller errors
        console.error(e)
      }
    } else {
      if (!this.messagesToBeSigned[accountAddr]) this.messagesToBeSigned[accountAddr] = []
      if (this.messagesToBeSigned[accountAddr].find((x) => x.fromUserRequestId === req.id)) return
      this.messagesToBeSigned[accountAddr].push({
        content: action,
        fromUserRequestId: req.id,
        signature: null
      })
    }
    // @TODO emit update
  }

  removeUserRequest(id: bigint) {
    const req = this.userRequests.find(req => req.id === id)
    if (!req) throw new Error(`removeUserRequest: request with id ${id} not found`)

    // remove from the request queue
    this.userRequests.splice(this.userRequests.indexOf(req), 1)

    // update the pending stuff to be signed
    const { action, accountAddr, networkId } = req
    if (action.kind === 'call') {
      // @TODO ensure acc info, re-estimate
      this.accountOpsToBeSigned[accountAddr][networkId] = this.getAccountOp(accountAddr, networkId)
    }
    else this.messagesToBeSigned[accountAddr] = this.messagesToBeSigned[accountAddr].filter(x => x.fromUserRequestId !== id)
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
    const account = this.accounts.find(x => x.addr === accountOp.accountAddr)
    if (!account) throw new Error(`estimateAccountOp: ${accountOp.accountAddr}: account does not exist`)
    const network = this.settings.networks.find(x => x.id === accountOp.networkId)
    if (!network) throw new Error(`estimateAccountOp: ${accountOp.networkId}: network does not exist`)
    // @TODO cache providers
    const provider = new JsonRpcProvider(network.rpcUrl)
    const [, estimation] = await Promise.all([
      // NOTE: we are not emitting an update here because the portfolio controller will do that
      this.portfolio.updateSelectedAccount(
        this.accounts,
        this.settings.networks,
        accountOp.accountAddr,
        Object.fromEntries(
          Object.entries(this.accountOpsToBeSigned[accountOp.accountAddr])
          .filter(([_, accountOp]) => accountOp)
          .map(
            ([networkId, accountOp]) => [networkId, [accountOp!]]
          )
        )
      ),
      // @TODO nativeToCheck: pass all EOAs,
      // @TODO feeTokens: pass a hardcoded list from settings
      estimate(provider, network, account, accountOp, [], [])
      // @TODO refresh the estimation
    ])
    console.log(estimation)
  }

  // when an accountOp is signed; should this be private and be called by
  // the method that signs it?
  resolveAccountOp() {}

  // when a message is signed; same comment applies: should this be private?
  resolveMessage() {}
}
