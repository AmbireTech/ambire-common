import { TypedDataDomain, TypedDataField } from 'ethers'

import { HumanizerFragment } from 'libs/humanizer/interfaces'
import { AccountId } from './account'
import { NetworkId } from './networkDescriptor'

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
  message: Record<string, any>
  primaryType: keyof TypedMessage['types']
}
// @TODO: move this type and it's deps (PlainTextMessage, TypedMessage) to another place,
// probably interfaces
export interface Message {
  id: number
  accountAddr: AccountId
  content: PlainTextMessage | TypedMessage
  signature: string | null
  fromUserRequestId?: number
  // those are the async non glabal data fragments that are obtained via the humanizer and stored
  // in the Message so we can visualize it better and fater later
  humanizerFragments?: HumanizerFragment[]
  networkId: NetworkId
}

export interface UserRequest {
  // Unlike the AccountOp, which we compare by content,
  // we need a distinct identifier here that's set by whoever is posting the request
  // the requests cannot be compared by content because it's valid for a user to post two or more identical ones
  // while for AccountOps we do only care about their content in the context of simulations
  id: number
  networkId: NetworkId
  accountAddr: AccountId
  // TODO: The dApp could define a nonce for the request, but this could not be
  // applicable, because the dApp will check this as a EOA. Double check.
  forceNonce: bigint | null
  // either-or here between call and a message, plus different types of messages
  action: Call | PlainTextMessage | TypedMessage
}
