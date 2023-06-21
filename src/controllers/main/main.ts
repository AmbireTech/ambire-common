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
export interface Message {
  kind: 'message'
  message: string | Uint8Array
}
export interface TypedMessage {
  kind: 'typedMessage'
  domain: TypedDataDomain
  types: Record<string, Array<TypedDataField>>
  value: Record<string, any>
}
export type UniversalMessage = Message | TypedMessage

export interface UserRequest {
  // Unlike the AccountOp, which we compare by content,
  // we need a distinct identifier here that's set by whoever is posting the request
  // the requests cannot be compared by content because it's valid for a user to post two or more identical ones
  // while for AccountOps we do only care about their content in the context of simulations
  id: bigint
  added: bigint // timestamp
  networkId: NetworkId
  accountId: AccountId
  forceNonce: bigint | null
  // either-or here between call and a message, plus different types of messages
  action: Call | Message | TypedMessage
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
  messagesToBeSigned: { [key: string]: UniversalMessage[] } = {}

  constructor(storage: Storage) {
    this.storage = storage
    // Load userRequests from storage and emit that we have updated
    // @TODO
  }

  addUserRequest(req: UserRequest) {
    this.userRequests.push(req)
    if (req.action.kind === 'call') {
      // @TODO
    } else {
      // @TODO
    }
  }

  resolveAccountOp() {
  }

  resolveMessage() {
  }
}
