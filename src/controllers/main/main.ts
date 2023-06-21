import { Storage } from '../../interfaces/storage'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
import { Account, AccountId } from '../../interfaces/account'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { TypedDataDomain, TypedDataField } from 'ethers'

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
// import fetch from 'node-fetch'
// import { JsonRpcProvider } from 'ethers'

// type State = Map<AccountId, Map<NetworkId, any>>

export class MainController {
  private storage: any
  // @TODO emailVaults
  // @TODO read networks from settings
  accounts: Account[] = []
  selectedAccount: string | null = null

  userRequests: UserRequest[] = []
  // accountAddr => networkId => accountOp
  accountOpsToBeSigned: { [key: string]: { [key: string]: AccountOp }} = {}
  accountOpsToBeConfirmed: { [key: string]: { [key: string]: AccountOp }} = {}
  // accountAddr => UniversalMessage[]
  messagesToBeSigned: { [key: string]: SignedMessage[] } = {}

  constructor(storage: Storage) {
    this.storage = storage
    // Load userRequests from storage and emit that we have updated
    // @TODO
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
          // @TODO: from monitored nonce? or use the estimate to determine?
          nonce: null,
          signature: null,
          // @TODO from pending recoveries
          accountOpToExecuteBefore: null,
          calls: []
        }
      }
      const accountOp = this.accountOpsToBeSigned[accountAddr][networkId]
      accountOp.calls.push({ ...action, fromUserRequestId: req.id })
      // @TODO
    } else {
      if (!this.messagesToBeSigned[accountAddr]) this.messagesToBeSigned[accountAddr] = []
      if (this.messagesToBeSigned[accountAddr].find(x => x.fromUserRequestId === req.id)) return
      this.messagesToBeSigned[accountAddr].push({
        content: action,
        fromUserRequestId: req.id,
        signature: null
      })
      // @TODO
    }
    // @TODO fire update
  }

  resolveAccountOp() {
  }

  resolveMessage() {
  }
}
