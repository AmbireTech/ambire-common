import { TypedDataDomain, TypedDataField, JsonRpcProvider } from 'ethers'
import { BinaryOperatorToken } from 'typescript'
import { Storage } from '../../interfaces/storage'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
import { Account, AccountId, AccountOnchainState } from '../../interfaces/account'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { PortfolioController } from '../portfolio'
import { Keystore, Key } from '../../libs/keystore/keystore'
import { networks } from '../../consts/networks'
import { getAccountInfo } from '../../libs/accountInfo/accountInfo'
import EventEmitter from '../eventEmitter'

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
  accountOpsToBeSigned: { [key: string]: { [key: string]: AccountOp } } = {}

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
    this.accountStates = await this.getAccountsInfo(this.accounts)
    this.isReady = true
  }

  public get currentAccountStates(): AccountStates {
    return this.accountStates
  }

  private async getAccountsInfo(accounts: Account[]): Promise<AccountStates> {
    const result = await Promise.all(
      this.settings.networks.map((network: NetworkDescriptor) => {
        const provider = new JsonRpcProvider(network.rpcUrl)
        return getAccountInfo(provider, network, accounts)
      })
    )

    const states = accounts.map((acc: Account, accIndex: number) => {
      return [
        acc.addr,
        this.settings.networks.map((network: NetworkDescriptor, netIndex: number) => {
          return [network.id, result[netIndex][accIndex]]
        })
      ]
    })

    return Object.fromEntries(states)
  }

  addUserRequest(req: UserRequest) {
    this.userRequests.push(req)
    const { action, accountAddr, networkId } = req
    if (action.kind === 'call') {
      if (!this.accountOpsToBeSigned[accountAddr]) this.accountOpsToBeSigned[accountAddr] = {}
      if (!this.accountOpsToBeSigned[accountAddr][networkId]) {
        this.accountOpsToBeSigned[accountAddr][networkId] = {
          accountAddr,
          networkId,
          signingKeyAddr: null,
          gasLimit: null,
          gasFeePayment: null,
          // @TODO: use the AccountInfo to determine; alternatively, can we use the Estimator and not need a nonce before that?
          nonce: null,
          // this will be set to a spoofSig in updateAccountOp
          signature: null,
          // @TODO from pending recoveries
          accountOpToExecuteBefore: null,
          calls: []
        }
      }
      const accountOp = this.accountOpsToBeSigned[accountAddr][networkId]
      accountOp.calls.push({ ...action, fromUserRequestId: req.id })
      this.updateAccountOp(accountOp)
    } else {
      if (!this.messagesToBeSigned[accountAddr]) this.messagesToBeSigned[accountAddr] = []
      if (this.messagesToBeSigned[accountAddr].find((x) => x.fromUserRequestId === req.id)) return
      this.messagesToBeSigned[accountAddr].push({
        content: action,
        fromUserRequestId: req.id,
        signature: null
      })
      // @TODO
    }
    // @TODO emit update
  }

  private async updateAccountOp(accountOp: AccountOp) {
    await this.initialLoadPromise
    // new accountOps should have spoof signatures so that they can be easily simulated
    // this is not used by the Estimator, because it iterates through all associatedKeys and
    // it knows which ones are authenticated, and it can generate it's own spoofSig
    // @TODO
    // accountOp.signature = `${}03`
    await Promise.all([
      // NOTE: we are not emitting an update here because the portfolio controller will do that
      this.portfolio.updateSelectedAccount(
        this.accounts,
        this.settings.networks,
        accountOp.accountAddr,
        Object.fromEntries(
          Object.entries(this.accountOpsToBeSigned[accountOp.accountAddr]).map(
            ([networkId, accountOp]) => [networkId, [accountOp]]
          )
        )
      )
      // @TODO refresh the estimation
    ])
    // const provider =
  }

  // when an accountOp is signed; should this be private and be called by
  // the method that signs it?
  resolveAccountOp() {}

  // when a message is signed; same comment applies: should this be private?
  resolveMessage() {}
}
