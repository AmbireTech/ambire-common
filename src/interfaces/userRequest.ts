import { TypedDataDomain, TypedDataField } from 'ethers'
// TODO: impl these 2 types in the project (they introduce many optional props that are
// not well handled in our codebase)
// import { AddEthereumChainParameter, WatchAssetParams } from 'viem'
import { SiweMessage as ViemSiweMessage } from 'viem/siwe'

import { Call } from '@/libs/accountOp/types'

import { SubmittedAccountOp } from '../libs/accountOp/submittedAccountOp'
import { PaymasterService } from '../libs/erc7677/types'
import { AccountId } from './account'
import { AutoLoginStatus, SiweValidityStatus } from './autoLogin'
import { Dapp, DappProviderRequest } from './dapp'
import { Hex } from './hex'
import { ISignAccountOpController } from './signAccountOp'
import { EIP7702Signature } from './signatures'
import { SwapAndBridgeQuote, SwapAndBridgeSendTxRequest } from './swapAndBridge'

import type { SafeMultisigTransactionResponse } from '@safe-global/types-kit'
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

  accountAddr: string
  chainId: bigint
  signature: EIP7702Signature | string | null
}

/**
 * What an app's request flow hands over, before it is attached to a user request. The `meta`
 * a `DappPromise` carries is only known once the payload has been read, so it is added when
 * the request is built rather than by whoever raised it.
 */
export type PendingDappPromise = {
  id: string
  session: DappProviderRequest['session']
  resolve: (data: any) => void
  reject: (data: any) => void
}

/** A dapp promise once it is attached to a user request. */
export type DappPromise = PendingDappPromise & {
  meta: { isWalletSendCalls?: boolean }
}

/**
 * One app request waiting its turn behind the requests it would collide with. `settle` and
 * `fail` answer the caller that is waiting on `build`, which is a different thing from the
 * app's own promise - a request can be added successfully and still leave the app waiting for
 * the user.
 */
export type DappRequestQueueItem = {
  request: DappProviderRequest
  dappPromise: PendingDappPromise
  dapp: Dapp | null
  settle: () => void
  fail: (error: any) => void
}

/** One transaction request, validated and ready to go into a batch. */
export type DappCallsRequestParams = {
  calls: Call[]
  meta: CallsUserRequest['meta']
  dappPromise: CallsUserRequest['dappPromises'][number]
}

interface UserRequestBase<DP = DappPromise[]> {
  id: string | number
  kind: string
  meta: {
    pendingToRemove?: boolean
    [key: string]: any
  }
  dappPromises: DP
}

export interface CallsUserRequest extends UserRequestBase<DappPromise[]> {
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
    safeTxnProps?: { txnId: Hex; signature: Hex; nonce: bigint }
    safeTx?: SafeMultisigTransactionResponse
    swapTxn?: SwapAndBridgeSendTxRequest
    quote?: SwapAndBridgeQuote
  }
  signAccountOp: ISignAccountOpController
}

export interface PlainTextMessageUserRequest extends UserRequestBase<[] | [DappPromise]> {
  kind: 'message'
  meta: UserRequestBase['meta'] & {
    params: { message: Hex }
    accountAddr: AccountId
    chainId: bigint
    keepRequestAlive?: boolean
    signed?: string[]
    hash?: Hex
    created?: number
    signatures?: Hex[]
    // set for Safe messages co-signed from another device, where there is no live
    // dapp session; recovered from the Safe message's `origin` field
    dappName?: string
    dappUrl?: string
  }
}

export interface SiweMessageUserRequest extends UserRequestBase<[DappPromise]> {
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
    keepRequestAlive?: boolean
    signed?: string[]
    hash?: Hex
    created?: number
  }
}

export interface TypedMessageUserRequest extends UserRequestBase<[] | [DappPromise]> {
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
    keepRequestAlive?: boolean
    signed?: string[]
    hash?: Hex
    created?: number
    signatures?: Hex[]
    // set for Safe messages co-signed from another device, where there is no live
    // dapp session; recovered from the Safe message's `origin` field
    dappName?: string
    dappUrl?: string
  }
}

export interface AuthorizationUserRequest extends UserRequestBase<[]> {
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

export interface BenzinUserRequest extends UserRequestBase<[]> {
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
export interface WalletAddEthereumChainRequest extends UserRequestBase<[DappPromise]> {
  kind: 'walletAddEthereumChain'
  meta: UserRequestBase['meta'] & {
    // TODO: impl AddEthereumChainParameter
    params: [any]
    [key: string]: any
  }
}

export interface SwapAndBridgeRequest extends UserRequestBase<[]> {
  kind: 'swapAndBridge'
}

export interface TransferRequest extends UserRequestBase<[]> {
  kind: 'transfer'
}

export interface UnlockRequest extends UserRequestBase<[DappPromise]> {
  kind: 'unlock'
}

export interface DappConnectRequest extends UserRequestBase<[DappPromise]> {
  kind: 'dappConnect'
}

export interface WalletWatchAssetRequest extends UserRequestBase<[DappPromise]> {
  kind: 'walletWatchAsset'
  meta: UserRequestBase['meta'] & {
    // TODO: impl WatchAssetParams
    params: any
  }
}

export interface GetEncryptionPublicKeyRequest extends UserRequestBase<[DappPromise]> {
  kind: 'ethGetEncryptionPublicKey'
  meta: UserRequestBase['meta'] & { params: [address: string] }
}

export interface DecryptRequest extends UserRequestBase<[DappPromise]> {
  kind: 'ethDecrypt'
  meta: UserRequestBase['meta'] & { params: [encryptedData: string, address: string] }
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
  | DecryptRequest

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
