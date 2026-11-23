import { isAddress, isHex, zeroAddress } from 'viem'

import {
  HumanizerTypedMessage,
  HumanizerTypedMessageFunction,
  HumanizerVisualization
} from '../interfaces'
import {
  ExpectedTypedData,
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getToken,
  isExactTypedData
} from '../utils'

/** CoW Protocol order, as the settlement contract signs it (same as `orderTypes` in `services/cowswap/helper`) */
const COW_SWAP_ORDER_TYPED_DATA: ExpectedTypedData = {
  primaryType: 'Order',
  types: {
    Order: [
      { name: 'sellToken', type: 'address' },
      { name: 'buyToken', type: 'address' },
      { name: 'receiver', type: 'address' },
      { name: 'sellAmount', type: 'uint256' },
      { name: 'buyAmount', type: 'uint256' },
      { name: 'validTo', type: 'uint32' },
      { name: 'appData', type: 'bytes32' },
      { name: 'feeAmount', type: 'uint256' },
      { name: 'kind', type: 'string' },
      { name: 'partiallyFillable', type: 'bool' },
      { name: 'sellTokenBalance', type: 'string' },
      { name: 'buyTokenBalance', type: 'string' }
    ]
  }
}

/** CoW Protocol order cancellations, as the CoW Protocol API checks them */
const COW_SWAP_ORDER_CANCELLATIONS_TYPED_DATA: ExpectedTypedData = {
  primaryType: 'OrderCancellations',
  types: { OrderCancellations: [{ name: 'orderUids', type: 'bytes[]' }] }
}

const COW_SWAP_SETTLEMENT_ADDRESS = '0x9008d19f58aabd9ed0d60971565aa8510560ab41'

const getOrderUidVisualization = (
  orderUid: string,
  accountAddr: string
): HumanizerVisualization[] => {
  if (!isHex(orderUid) || orderUid.length !== 114) {
    return [getLabel(`with order ID ${orderUid.slice(0, 8)}...${orderUid.slice(-6)}`)]
  }

  const owner = `0x${orderUid.slice(66, 106)}`
  const validTo = BigInt(`0x${orderUid.slice(106)}`)

  return [
    getLabel(`with order ID ${orderUid.slice(0, 8)}...${orderUid.slice(-6)}`),
    ...(owner.toLowerCase() !== accountAddr.toLowerCase()
      ? [getLabel('owned by'), getAddressVisualization(owner)]
      : []),
    getDeadline(validTo)
  ]
}

/** Tells if the message is signed for the CoW Protocol settlement contract */
const isCowSwapMessage = (message: HumanizerTypedMessage): boolean => {
  const { domain } = message.content
  const verifyingContract = domain.verifyingContract
  return (
    !!verifyingContract &&
    isAddress(verifyingContract) &&
    verifyingContract.toLowerCase() === COW_SWAP_SETTLEMENT_ADDRESS &&
    domain.name === 'Gnosis Protocol' &&
    domain.version === 'v2'
  )
}

/** Humanizes the cancellation of CoW Swap orders (primary type `OrderCancellations`) */
export const humanizeCowSwapOrderCancellations: HumanizerTypedMessageFunction = (message) => {
  const tm = message.content
  if (!isCowSwapMessage(message) || !isExactTypedData(tm, COW_SWAP_ORDER_CANCELLATIONS_TYPED_DATA))
    return null

  const { orderUids } = tm.message
  if (!Array.isArray(orderUids) || !orderUids.length) return null

  return {
    fullVisualization: [
      getAction(orderUids.length === 1 ? 'Cancel CowSwap order' : 'Cancel CowSwap orders'),
      ...orderUids.flatMap((orderUid, index) => [
        ...(index ? [getLabel('and')] : []),
        ...getOrderUidVisualization(orderUid, message.accountAddr)
      ])
    ]
  }
}

/** Humanizes a CoW Swap order (primary type `Order`) */
export const humanizeCowSwapOrder: HumanizerTypedMessageFunction = (message) => {
  const tm = message.content
  if (!isCowSwapMessage(message) || !isExactTypedData(tm, COW_SWAP_ORDER_TYPED_DATA)) return null

  const {
    sellToken,
    buyToken,
    sellAmount: rawSellAmount,
    buyAmount: rawBuyAmount,
    validTo: rawValidTo,
    kind,
    receiver,
    feeAmount: rawFeeAmount
  } = tm.message
  const sellAmount = BigInt(rawSellAmount)
  const buyAmount = BigInt(rawBuyAmount)
  const validTo = BigInt(rawValidTo)
  const feeAmount = rawFeeAmount ? BigInt(rawFeeAmount) : 0n
  const chainId = tm.domain.chainId ? BigInt(tm.domain.chainId) : message.chainId

  if (
    !isAddress(sellToken) ||
    !isAddress(buyToken) ||
    sellAmount === null ||
    buyAmount === null ||
    validTo === null ||
    !['buy', 'sell'].includes(kind)
  ) {
    return null
  }

  const fullVisualization: HumanizerVisualization[] =
    kind === 'buy'
      ? [
          getAction('Place an order to Buy'),
          getToken(buyToken, buyAmount, chainId),
          getLabel('for up to'),
          getToken(sellToken, sellAmount, chainId)
        ]
      : [
          getAction('Place an order to Sell'),
          getToken(sellToken, sellAmount, chainId),
          getLabel('for at least'),
          getToken(buyToken, buyAmount, chainId)
        ]

  if (feeAmount > 0n) {
    fullVisualization.push(getLabel('including fee'), getToken(sellToken, feeAmount, chainId))
  }

  if (
    typeof receiver === 'string' &&
    isAddress(receiver) &&
    receiver.toLowerCase() !== zeroAddress &&
    receiver.toLowerCase() !== message.accountAddr.toLowerCase()
  ) {
    fullVisualization.push(getLabel('to'), getAddressVisualization(receiver))
  }

  fullVisualization.push(getDeadline(validTo))

  return { fullVisualization }
}
