import { TypedDataDomain, TypedDataField } from 'ethers'
import { SiweMessage as ViemSiweMessage } from 'viem/siwe'

import { AccountOp } from '../libs/accountOp/accountOp'
import { PaymasterService } from '../libs/erc7677/types'
import { AccountId } from './account'
import { SignMessageAction } from './actions'
import { AutoLoginStatus, SiweValidityStatus } from './autoLogin'
import { Dapp, DappProviderRequest } from './dapp'
import { Hex } from './hex'
import { EIP7702Signature } from './signatures'

// @TODO: move this type and it's deps (PlainTextMessage, TypedMessage) to another place,
// probably interfaces
export interface Message {
  fromActionId: SignMessageAction['id']
  accountAddr: AccountId
  chainId: bigint
  content:
    | PlainTextMessageUserRequest
    | TypedMessageUserRequest
    | AuthorizationUserRequest
    | SiweMessageUserRequest
  signature: EIP7702Signature | string | null
}

interface UserRequestBase {
  id: string | number
  kind: string
  meta: { [key: string]: any }
  dappPromises: {
    dapp: Dapp | null
    session: DappProviderRequest['session']
    meta: {
      isWalletSendCalls?: boolean
    }
    resolve: (data: any) => void
    reject: (data: any) => void
  }[]
}

export interface CallsUserRequest extends UserRequestBase {
  kind: 'calls'
  meta: {
    accountAddr: string
    chainId: bigint
    paymasterService?: PaymasterService
    walletSendCallsVersion?: string
    setDelegation?: boolean
    activeRouteId?: string
    isSwapAndBridgeCall?: boolean
  }
  accountOp: AccountOp
}

export interface PlainTextMessageUserRequest extends UserRequestBase {
  kind: 'message'
  meta: {
    message: Hex
    accountAddr: AccountId
  }
}

export interface SiweMessageUserRequest extends UserRequestBase {
  kind: 'siwe'
  meta: {
    message: Hex
    parsedMessage: ViemSiweMessage
    siweValidityStatus: SiweValidityStatus
    autoLoginStatus: AutoLoginStatus
    isAutoLoginEnabledByUser: boolean
    autoLoginDuration: number
    accountAddr: AccountId
  }
}

export interface TypedMessageUserRequest extends UserRequestBase {
  kind: 'typedMessage'
  meta: {
    domain: TypedDataDomain
    types: Record<string, Array<TypedDataField>>
    message: Record<string, any>
    primaryType: keyof Record<string, Array<TypedDataField>>
    accountAddr: AccountId
  }
}

export interface AuthorizationUserRequest extends UserRequestBase {
  kind: 'authorization-7702'
  meta: {
    accountAddr: AccountId
    chainId: bigint
    nonce: bigint
    contractAddr: Hex
    message: Hex
  }
}

export interface BenzinUserRequest extends UserRequestBase {
  kind: 'benzin'
}

export interface SwitchAccountRequest extends UserRequestBase {
  kind: 'switchAccount'
  meta: {
    accountAddr: string
    switchToAccountAddr: string
    nextRequestKind: UserRequest['kind']
  }
}

export type UserRequest =
  | CallsUserRequest
  | PlainTextMessageUserRequest
  | TypedMessageUserRequest
  | SiweMessageUserRequest
  | AuthorizationUserRequest
  | BenzinUserRequest
  | SwitchAccountRequest
// | UserRequestBase
