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
  fromRequestId: SignMessageAction['id']
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
    pendingToRemove?: boolean
  }
}
export interface WalletAddEthereumChainRequest extends UserRequestBase {
  kind: 'walletAddEthereumChain'
  meta: {
    params: [
      {
        chainId: string
        chainName: string
        rpcUrls: string[]
        nativeCurrency: { name: string; symbol: string; decimals: number }
        iconUrls?: string[]
        blockExplorerUrls?: string[]
      }
    ]
    [key: string]: any
  }
}

export interface SwapAndBridgeRequest extends UserRequestBase {
  kind: 'swapAndBridge'
}

export interface TransferRequest extends UserRequestBase {
  kind: 'transfer'
}

export interface UnlockRequest extends UserRequestBase {
  kind: 'unlock'
  meta: {
    pendingToRemove?: boolean
  }
}

export interface DappConnectRequest extends UserRequestBase {
  kind: 'dappConnect'
  meta: { params: any }
}

export interface WalletWatchAssetRequest extends UserRequestBase {
  kind: 'walletWatchAsset'
  meta: { params: any }
}

export type UserRequest =
  | UnlockRequest
  | DappConnectRequest
  | WalletAddEthereumChainRequest
  | WalletWatchAssetRequest
  | CallsUserRequest
  | PlainTextMessageUserRequest
  | TypedMessageUserRequest
  | SiweMessageUserRequest
  | AuthorizationUserRequest
  | BenzinUserRequest
  | SwitchAccountRequest
  | SwapAndBridgeRequest
  | TransferRequest

export type SignUserRequest =
  | CallsUserRequest
  | PlainTextMessageUserRequest
  | TypedMessageUserRequest
  | SiweMessageUserRequest
  | AuthorizationUserRequest

export type RequestPosition = 'first' | 'last'

export type RequestExecutionType = 'queue' | 'queue-but-open-action-window' | 'open-action-window'

export type OpenRequestWindowParams = {
  skipFocus?: boolean
  baseWindowId?: number
}
