import { TypedDataDomain, TypedDataField } from 'ethers'
import { SubmittedAccountOp } from 'libs/accountOp/submittedAccountOp'
import { SiweMessage as ViemSiweMessage } from 'viem/siwe'

import { AccountOp } from '../libs/accountOp/accountOp'
import { PaymasterService } from '../libs/erc7677/types'
import { AccountId } from './account'
import { AutoLoginStatus, SiweValidityStatus } from './autoLogin'
import { Dapp, DappProviderRequest } from './dapp'
import { Hex } from './hex'
import { EIP7702Signature } from './signatures'

// @TODO: move this type and it's deps (PlainTextMessage, TypedMessage) to another place,
// probably interfaces
export interface Message {
  fromRequestId: string | number
  content:
    | (PlainTextMessageUserRequest['meta']['params'] & {
        kind: PlainTextMessageUserRequest['kind']
      })
    | (TypedMessageUserRequest['meta']['params'] & { kind: TypedMessageUserRequest['kind'] })
    | (AuthorizationUserRequest['meta']['params'] & { kind: AuthorizationUserRequest['kind'] })
    | (SiweMessageUserRequest['meta']['params'] & { kind: SiweMessageUserRequest['kind'] })

  accountAddr:
    | PlainTextMessageUserRequest['meta']['accountAddr']
    | TypedMessageUserRequest['meta']['accountAddr']
    | AuthorizationUserRequest['meta']['accountAddr']
    | SiweMessageUserRequest['meta']['accountAddr']
  chainId:
    | PlainTextMessageUserRequest['meta']['chainId']
    | TypedMessageUserRequest['meta']['chainId']
    | AuthorizationUserRequest['meta']['chainId']
    | SiweMessageUserRequest['meta']['chainId']
  signature: EIP7702Signature | string | null
}

interface UserRequestBase {
  id: string | number
  kind: string
  meta: {
    pendingToRemove?: boolean
    [key: string]: any
  }
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
  meta: UserRequestBase['meta'] & {
    accountAddr: string
    chainId: bigint
    paymasterService?: PaymasterService
    walletSendCallsVersion?: string
    setDelegation?: boolean
    activeRouteId?: string
    isSwapAndBridgeCall?: boolean
    topUpAmount?: bigint
  }
  accountOp: AccountOp
}

export interface PlainTextMessageUserRequest extends UserRequestBase {
  kind: 'message'
  meta: UserRequestBase['meta'] & {
    params: { message: Hex }
    accountAddr: AccountId
    chainId: bigint
  }
}

export interface SiweMessageUserRequest extends UserRequestBase {
  kind: 'siwe'
  meta: UserRequestBase['meta'] & {
    params: {
      message: Hex
      parsedMessage: ViemSiweMessage
      siweValidityStatus: SiweValidityStatus
      autoLoginStatus: AutoLoginStatus
      isAutoLoginEnabledByUser: boolean
      autoLoginDuration: number
    }
    accountAddr: AccountId
    chainId: bigint
  }
}

export interface TypedMessageUserRequest extends UserRequestBase {
  kind: 'typedMessage'
  meta: UserRequestBase['meta'] & {
    params: {
      domain: TypedDataDomain
      types: Record<string, Array<TypedDataField>>
      message: Record<string, any>
      primaryType: keyof Record<string, Array<TypedDataField>>
    }
    accountAddr: AccountId
    chainId: bigint
  }
}

export interface AuthorizationUserRequest extends UserRequestBase {
  kind: 'authorization-7702'
  meta: UserRequestBase['meta'] & {
    params: {
      message: Hex
      contractAddr: Hex
      nonce: bigint
    }
    accountAddr: AccountId
    chainId: bigint
  }
}

export interface BenzinUserRequest extends UserRequestBase {
  kind: 'benzin'
  meta: UserRequestBase['meta'] & {
    submittedAccountOp?: SubmittedAccountOp
    identifiedBy?: SubmittedAccountOp['identifiedBy']
    txnId: SubmittedAccountOp['txnId'] | null
    userOpHash: string | null
    accountAddr: string
    chainId: bigint
  }
}

export interface SwitchAccountRequest extends UserRequestBase {
  kind: 'switchAccount'
  meta: UserRequestBase['meta'] & {
    accountAddr: string
    switchToAccountAddr: string
    nextRequestKind: UserRequest['kind']
    pendingToRemove?: boolean
  }
}
export interface WalletAddEthereumChainRequest extends UserRequestBase {
  kind: 'walletAddEthereumChain'
  meta: UserRequestBase['meta'] & {
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
}

export interface DappConnectRequest extends UserRequestBase {
  kind: 'dappConnect'
  meta: UserRequestBase['meta'] & { params: any }
}

export interface WalletWatchAssetRequest extends UserRequestBase {
  kind: 'walletWatchAsset'
  meta: UserRequestBase['meta'] & { params: any }
}

export interface GetEncryptionPublicKeyRequest extends UserRequestBase {
  kind: 'ethGetEncryptionPublicKey'
  meta: UserRequestBase['meta'] & { params: any }
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
  | GetEncryptionPublicKeyRequest

export type SignUserRequest =
  | CallsUserRequest
  | PlainTextMessageUserRequest
  | TypedMessageUserRequest
  | SiweMessageUserRequest
  | AuthorizationUserRequest

export type RequestPosition = 'first' | 'last'

export type RequestExecutionType = 'queue' | 'queue-but-open-request-window' | 'open-request-window'

export type OpenRequestWindowParams = {
  skipFocus?: boolean
  baseWindowId?: number
}
