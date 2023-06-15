import { Storage } from '../../interfaces/storage'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Account } from '../../interfaces/account'
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

export interface UserRequest {
  id: bigint
  added: bigint // timestamp
  chainId: bigint
  accountId: string
  // either-or here between call and a message, plus different types of messages
  action: Call | Message | TypedMessage
}
// import fetch from 'node-fetch'
// import { JsonRpcProvider } from 'ethers'

// type State = Map<AccountId, Map<NetworkId, any>>

export class MainController {
  private storage: any
  userRequests: UserRequest[] = []

  constructor(storage: Storage) {
    this.storage = storage
    // Load userRequests from storage and emit that we have updated
    // @TODO
  }

  
}
