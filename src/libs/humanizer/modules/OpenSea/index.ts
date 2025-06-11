import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { stringify } from '../../../richJson/richJson'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../../utils'

const iface = new Interface([
  'function fulfillBasicOrder_efficient_6GL6yc(tuple(address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, tuple(uint256 amount, address recipient)[] additionalRecipients, bytes signature) args) payable returns (bool fulfilled)',
  'function fulfillBasicOrder(tuple(address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, tuple(uint256 amount, address recipient)[] additionalRecipients, bytes signature) args) payable returns (bool fulfilled)',
  'function fulfillAvailableAdvancedOrders(((address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 totalOriginalConsiderationItems) parameters, uint120 numerator, uint120 denominator, bytes signature, bytes extraData)[], (uint256 orderIndex, uint8 side, uint256 index, uint256 identifier, bytes32[] criteriaProof)[], (uint256 orderIndex, uint256 itemIndex)[][], (uint256 orderIndex, uint256 itemIndex)[][], bytes32 fulfillerConduitKey, address recipient, uint256 maximumFulfilled) payable returns (bool[], ((uint8 itemType, address token, uint256 identifier, uint256 amount, address recipient) item, address offerer, bytes32 conduitKey)[])',
  'function fulfillAdvancedOrder(((address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 totalOriginalConsiderationItems) parameters, uint120 numerator, uint120 denominator, bytes signature, bytes extraData), (uint256 orderIndex, uint8 side, uint256 index, uint256 identifier, bytes32[] criteriaProof)[], bytes32 fulfillerConduitKey, address recipient) payable returns (bool fulfilled)'
])

interface Order {
  items: { address: string; id: bigint; fromAmount: bigint; endAmount: bigint }[]
  payment: { address: string; amountOrId: bigint }[]
  end: bigint
}
const parsePrice = (price: bigint, numerator: bigint, denumerator: bigint): bigint =>
  BigInt((price * numerator) / denumerator)
const parseOrder = (order: any): Order => {
  const [
    params,
    num,
    denum
    // data2, data3
  ] = order
  const [
    ,
    ,
    // currentOwner
    // zone
    offers,
    consideration,
    ,
    ,
    // orderType
    // startTime
    endTime
    // zoneHash,
    // salt,
    // conduitKey
    // totalOriginalConsiderationItems
  ] = params
  const items = offers.map((o: any): Order['items'][0] => {
    const [
      ,
      // type
      address,
      id,
      fromAmount,
      endAmount
    ] = o
    return {
      address,
      id,
      fromAmount: parsePrice(fromAmount, num, denum),
      endAmount: parsePrice(endAmount, num, denum)
    }
  })
  const payment: Order['payment'][0][] = []
  const tokenPayments: { [addr: string]: bigint } = {}
  consideration.forEach((o: any) => {
    const [
      type,
      token,
      tokenId,
      ,
      // fromAmount
      endAmount
    ] = o
    if (type === 0n || type === 1n)
      tokenPayments[token] = (tokenPayments[token] || 0n) + parsePrice(endAmount, num, denum)
    if (type === 2n || type === 3n)
      payment.push({ address: token as string, amountOrId: BigInt(tokenId) })
  })
  Object.entries(tokenPayments).forEach(([address, amountOrId]) => {
    payment.push({ address, amountOrId })
  })
  return { items, payment, end: BigInt(endTime) }
}

const dedupe1155Orders = (orders: Order[]): any[] => {
  if (orders.length <= 30) return orders
  const uniqueOrders = [...new Set(orders.map((o) => stringify(o)))]
  if (uniqueOrders.length > 1) return orders
  if (orders[0].items.length > 1) return orders
  if (orders[0].payment.length > 1) return orders
  // if (uniqueOrders.items.length > 1) return orders
  const correctNumberOfOrders = BigInt(orders.length - 30)
  const finalOrder = orders[0]
  finalOrder.items[0].endAmount *= correctNumberOfOrders
  finalOrder.items[0].fromAmount *= correctNumberOfOrders
  finalOrder.payment[0].amountOrId *= correctNumberOfOrders
  return [finalOrder]
}
const humanizerOrder = ({ items, payment, end }: Order) => {
  return [
    getAction('Buy'),
    ...items
      .map(({ address, id, fromAmount }) =>
        fromAmount === 1n
          ? [getToken(address, id)]
          : [getLabel(fromAmount.toString(), true), getToken(address, id)]
      )
      .flat(),
    getLabel('for up to'),
    ...payment.map(({ address, amountOrId }) => getToken(address, amountOrId)),
    getDeadline(end)
  ]
}

export const openSeaModule: HumanizerCallModule = (accountOp: AccountOp, irCalls: IrCall[]) => {
  return irCalls.map((call: IrCall) => {
    if (!call.to) return call
    if (
      [
        iface.getFunction('fulfillBasicOrder_efficient_6GL6yc')!.selector,
        iface.getFunction('fulfillBasicOrder')!.selector
      ].includes(call.data.slice(0, 10))
    ) {
      let orders
      if (call.data.slice(0, 10) === iface.getFunction('fulfillBasicOrder')!.selector)
        orders = iface.decodeFunctionData('fulfillBasicOrder', call.data)
      else orders = iface.decodeFunctionData('fulfillBasicOrder_efficient_6GL6yc', call.data)

      const data = orders.map((i) => {
        const [
          considerationToken,
          considerationIdentifier,
          considerationAmount,
          ,
          ,
          // offerer,
          // zone,
          offerToken,
          offerIdentifier,
          ,
          ,
          // offerAmount,
          // basicOrderType,
          startTime,
          endTime
          // zoneHash,
          // salt,
          // offererConduitKey,
          // fulfillerConduitKey,
          // totalOriginalAdditionalRecipients,
          // additionalRecipients,
          // signature
        ] = i

        return {
          considerationToken,
          considerationIdentifier,
          considerationAmount,
          // offerer,
          // zone,
          offerToken,
          offerIdentifier,
          // offerAmount,
          // basicOrderType,
          startTime,
          endTime
          // zoneHash,
          // salt,
          // offererConduitKey,
          // fulfillerConduitKey,
          // totalOriginalAdditionalRecipients,
          // additionalRecipients,
          // signature
        }
      })
      if (data.length !== 1) return call
      return {
        ...call,
        fullVisualization: [
          getAction('Buy'),
          getToken(data[0].offerToken, data[0].offerIdentifier),
          getLabel('for'),
          getToken(data[0].considerationToken, data[0].considerationAmount),
          getDeadline(data[0].endTime)
        ]
      }
    }

    if (call.data.startsWith(iface.getFunction('fulfillAvailableAdvancedOrders')!.selector)) {
      const [orders] = iface.decodeFunctionData('fulfillAvailableAdvancedOrders', call.data)

      let totalOrders: Order[] = orders.map((o: any) => parseOrder(o))
      // opensea allows batch buy of 30 items at most
      // if we detect more than 30 orders, that means the dapp attempts to
      // execute n-30 EIP1155 orders that are being deduplicated accordingly on a contract level
      // dedupe1155Orders removes 30 repeating orders and merges the remaining n orders
      if (totalOrders.length > 30) totalOrders = dedupe1155Orders(totalOrders)
      // still not deduped
      if (totalOrders.length > 30)
        return {
          ...call,
          fullVisualization: [
            getAction('Buy NFTs'),
            getLabel('from'),
            getAddressVisualization(call.to)
          ]
        }
      const fullVisualization = totalOrders.map(humanizerOrder).flat()
      return { ...call, fullVisualization }
    }
    if (call.data.startsWith(iface.getFunction('fulfillAdvancedOrder')!.selector)) {
      const [order] = iface.decodeFunctionData('fulfillAdvancedOrder', call.data)
      const parsedOrder: Order = parseOrder(order)
      const fullVisualization = humanizerOrder(parsedOrder)
      return { ...call, fullVisualization }
    }

    return call
  })
}
