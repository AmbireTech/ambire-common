import { TypedDataDomain, TypedDataField } from 'ethers'
import { NetworkId } from './networkDescriptor'
import { AccountId } from './account'

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
