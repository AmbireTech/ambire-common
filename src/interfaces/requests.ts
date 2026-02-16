import { EIP712TypedData } from '@safe-global/types-kit'

import { TokenResult } from '../libs/portfolio'
import { ControllerInterface } from './controller'
import { DappProviderRequest } from './dapp'
import { Hex } from './hex'
import { SwapAndBridgeActiveRoute } from './swapAndBridge'
import { CallsUserRequest, RequestExecutionType, RequestPosition } from './userRequest'

export type IRequestsController = ControllerInterface<
  InstanceType<typeof import('../controllers/requests/requests').RequestsController>
>

export type BuildRequest =
  | {
      type: 'dappRequest'
      params: {
        request: DappProviderRequest
        dappPromise: {
          id: string
          session: DappProviderRequest['session']
          resolve: (data: any) => void
          reject: (data: any) => void
        }
      }
    }
  | {
      type: 'calls'
      params: {
        userRequestParams: {
          calls: CallsUserRequest['signAccountOp']['accountOp']['calls']
          meta: CallsUserRequest['meta']
        }
        position?: RequestPosition
        executionType?: RequestExecutionType
        allowAccountSwitch?: boolean
        skipFocus?: boolean
      }
    }
  | {
      type: 'transferRequest'
      params: {
        amount: string
        amountInFiat: bigint
        recipientAddress: string
        selectedToken: TokenResult
        executionType: RequestExecutionType
      }
    }
  | {
      type: 'swapAndBridgeRequest'
      params: {
        openActionWindow: boolean
        activeRouteId?: SwapAndBridgeActiveRoute['activeRouteId']
        windowId?: number
      }
    }
  | {
      type: 'claimWalletRequest' | 'mintVestingRequest'
      params: {
        token: TokenResult
        windowId?: number
      }
    }
  | {
      type: 'intentRequest'
      params: {
        amount: string
        recipientAddress: string
        selectedToken: TokenResult
        executionType: RequestExecutionType
      }
    }
  | {
      type: 'safeSignMessageRequest'
      params: {
        chainId: bigint
        signed: string[]
        message: Hex | EIP712TypedData
        messageHash: Hex
        created: number
      }
    }
