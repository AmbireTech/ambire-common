import { TokenResult } from '@/libs/portfolio'
import { FeeExemptionReason } from '@/libs/swapAndBridge/fee'

import { ControllerInterface } from './controller'
import {
  CowSwapOrderCreation,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeToToken
} from './swapAndBridge'

export type ILimitOrdersController = ControllerInterface<
  InstanceType<typeof import('../controllers/limitOrders/limitOrders').LimitOrdersController>
>

export type LimitOrderData = {
  chainId: number
  isEthFlow: boolean
  order: CowSwapOrderCreation
  orderUid: string
}

export type PreparedLimitOrder = LimitOrderData & {
  currentMarketBuyAmount: string
  feePercent: number
  feeExemptionReason?: FeeExemptionReason
  fromToken: TokenResult
  targetBuyAmount: string
  toToken: SwapAndBridgeToToken
  userTx: SwapAndBridgeSendTxRequest
}

export type LimitOrderMarketQuote = Pick<
  PreparedLimitOrder,
  'currentMarketBuyAmount' | 'feePercent' | 'feeExemptionReason'
>

export type LimitOrderFormStatus =
  | 'EMPTY'
  | 'INVALID'
  | 'PREPARING'
  | 'READY_TO_ESTIMATE'
  | 'READY_TO_SUBMIT'
  | 'PROCEEDED'
  | 'PLACING'
  | 'PLACED'
  | 'FAILED'

export type LimitOrderPlacementStatus = 'INITIAL' | 'PLACING' | 'PLACED' | 'FAILED'
