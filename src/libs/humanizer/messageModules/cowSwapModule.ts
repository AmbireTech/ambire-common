import { isAddress, zeroAddress } from 'viem'

import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule, HumanizerVisualization } from '../interfaces'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../utils'

const COW_SWAP_SETTLEMENT_ADDRESS = '0x9008d19f58aabd9ed0d60971565aa8510560ab41'

const toBigInt = (value: unknown): bigint | null => {
  try {
    if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string') {
      return BigInt(value)
    }

    if (
      value &&
      typeof value === 'object' &&
      '$bigint' in value &&
      typeof value.$bigint === 'string'
    ) {
      return BigInt(value.$bigint)
    }
  } catch {
    return null
  }

  return null
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
    tm.domain.version !== 'v2' ||
    tm.primaryType !== 'Order' ||
    !tm.types.Order
  ) {
    return { fullVisualization: [] }
  }

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
  const sellAmount = toBigInt(rawSellAmount)
  const buyAmount = toBigInt(rawBuyAmount)
  const validTo = toBigInt(rawValidTo)
  const feeAmount = toBigInt(rawFeeAmount) || 0n
  const chainId = toBigInt(tm.domain.chainId) || message.chainId

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
