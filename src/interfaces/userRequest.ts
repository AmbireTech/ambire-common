import { SignMessageAction } from 'controllers/actions/actions'
import { TypedDataDomain, TypedDataField } from 'ethers'

import { PaymasterService } from '../libs/erc7677/types'
import { AccountId } from './account'
import { DappProviderRequest } from './dapp'
import { Hex } from './hex'
import { NetworkId } from './network'
import { EIP7702Signature } from './signatures'

export interface Calls {
  kind: 'calls'
  calls: {
    to: string
    value: bigint
    data: string
    id?: string
  }[]
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

export interface Authorization {
  kind: 'authorization-7702'
  chainId: bigint
  nonce: bigint
  contractAddr: Hex
  message: Hex
  // a list of all the networks that are going to be affected by this
  affectedNetworks?: string[]
}

// @TODO: move this type and it's deps (PlainTextMessage, TypedMessage) to another place,
// probably interfaces
export interface Message {
  fromActionId: SignMessageAction['id']
  accountAddr: AccountId
  networkId: NetworkId
  content: PlainTextMessage | TypedMessage | Authorization
  signature: EIP7702Signature | string | null
}

export interface SignUserRequest {
  id: string | number
  action: Calls | PlainTextMessage | TypedMessage | Authorization | { kind: 'benzin' }
  session?: DappProviderRequest['session']
  meta: {
    isSignAction: true
    accountAddr: AccountId
    networkId: NetworkId
    paymasterService?: PaymasterService
    isWalletSendCalls?: boolean
    submittedAccountOp?: any
    [key: string]: any
  }
  // defined only when SignUserRequest is built from a DappRequest
  dappPromise?: {
    session: { name: string; origin: string; icon: string }
    resolve: (data: any) => void
    reject: (data: any) => void
  }
}

export interface DappUserRequest {
  id: string | number
  action: {
    kind: Exclude<string, 'calls' | 'message' | 'typedMessage' | 'benzin' | 'switchAccount'>
    params: any
  }
  session: DappProviderRequest['session']
  meta: {
    isSignAction: false
    [key: string]: any
  }
  dappPromise: {
    session: { name: string; origin: string; icon: string }
    resolve: (data: any) => void
    reject: (data: any) => void
  }
}

export type UserRequest = DappUserRequest | SignUserRequest
