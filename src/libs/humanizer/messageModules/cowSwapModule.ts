import { isAddress, isHex, zeroAddress } from 'viem'

import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule, HumanizerVisualization } from '../interfaces'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../utils'

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

export const cowSwapModule: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'typedMessage') return { fullVisualization: [] }

  const tm = message.content
  const verifyingContract = tm.domain.verifyingContract
  if (
    !verifyingContract ||
    !isAddress(verifyingContract) ||
    verifyingContract.toLowerCase() !== COW_SWAP_SETTLEMENT_ADDRESS ||
    tm.domain.name !== 'Gnosis Protocol' ||
    tm.domain.version !== 'v2'
  ) {
    return { fullVisualization: [] }
  }

  if (tm.primaryType === 'OrderCancellations' && tm.types.OrderCancellations) {
    const { orderUids } = tm.message
    if (!Array.isArray(orderUids) || !orderUids.length) return { fullVisualization: [] }

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

  if (tm.primaryType !== 'Order' || !tm.types.Order) return { fullVisualization: [] }

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
    return { fullVisualization: [] }
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
