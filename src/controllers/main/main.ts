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
  // @TODO: clean
  // accountOpsToBeSigned: Map<AccountId, Map<NetworkId, AccountOp[]>> = new Map()
  accountOpsToBeConfirmed: Map<AccountId, Map<NetworkId, AccountOp[]>> = new Map()
  messagesToBeSigned: Map<AccountId, UniversalMessage[]> = new Map()

  constructor(storage: Storage) {
    this.storage = storage
    // Load userRequests from storage and emit that we have updated
    // @TODO
  }

  public get accountOpsToBeSigned(): Map<AccountId, Map<NetworkId, any>> {
    const result = new Map()
    for (const req of this.userRequests)  {
      if (req.action.kind !== 'call') continue
      if (!result.has(req.accountId)) result.set(req.accountId, new Map())
      if (!result.get(req.accountId)!.has(req.networkId)) result.get(req.accountId)!.set(req.networkId, [])
      result.get(req.accountId)!.get(req.networkId)!.push(req)
    }
    return result
  }
}
