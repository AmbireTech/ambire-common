import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { parse, stringify } from '../../../richJson/richJson'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getDeadline, getLabel, getToken } from '../../utils'

const iface = new Interface([
  'function fulfillBasicOrder_efficient_6GL6yc(tuple(address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, tuple(uint256 amount, address recipient)[] additionalRecipients, bytes signature) args) payable returns (bool fulfilled)',
  'function fulfillBasicOrder(tuple(address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, tuple(uint256 amount, address recipient)[] additionalRecipients, bytes signature) args) payable returns (bool fulfilled)',
  'function fulfillAvailableAdvancedOrders(((address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 totalOriginalConsiderationItems) parameters, uint120 numerator, uint120 denominator, bytes signature, bytes extraData)[], (uint256 orderIndex, uint8 side, uint256 index, uint256 identifier, bytes32[] criteriaProof)[], (uint256 orderIndex, uint256 itemIndex)[][], (uint256 orderIndex, uint256 itemIndex)[][], bytes32 fulfillerConduitKey, address recipient, uint256 maximumFulfilled) payable returns (bool[], ((uint8 itemType, address token, uint256 identifier, uint256 amount, address recipient) item, address offerer, bytes32 conduitKey)[])',
  'function fulfillAdvancedOrder(((address offerer, address zone, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount)[] offer, (uint8 itemType, address token, uint256 identifierOrCriteria, uint256 startAmount, uint256 endAmount, address recipient)[] consideration, uint8 orderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 conduitKey, uint256 totalOriginalConsiderationItems) parameters, uint120 numerator, uint120 denominator, bytes signature, bytes extraData), (uint256 orderIndex, uint8 side, uint256 index, uint256 identifier, bytes32[] criteriaProof)[], bytes32 fulfillerConduitKey, address recipient) payable returns (bool fulfilled)'
])

interface Order {
  items: { address: string; id: bigint }[]
  payment: { address: string; amountOrId: bigint }[]
  end: bigint
}
const parseOrder = (order: any): Order => {
  const [
    params,
    priceNumerator,
    priceDenumerator
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
      id
      // ,fromAmount
      // ,endAmount
    ] = o
    return { address, id }
  })
  const payment: Order['payment'][0][] = []
  const tokenPayments: { [addr: string]: bigint } = {}
  consideration.forEach((o: any) => {
    const [
      type,
      token,
      tokenId,
      fromAmount
      // ,endAmount
    ] = o
    if (type === 0n || type === 1n)
      tokenPayments[token] =
        (tokenPayments[token] || 0n) + BigInt((fromAmount * priceNumerator) / priceDenumerator)
    if (type === 2n || type === 3n)
      payment.push({ address: token as string, amountOrId: BigInt(tokenId) })
  })
  Object.entries(tokenPayments).forEach(([address, amountOrId]) => {
    payment.push({ address, amountOrId })
  })
  return { items, payment, end: BigInt(endTime) }
}
const humanizerOrder = ({ items, payment, end }: Order) => {
  return [
    getAction('Buy'),
    ...items.map(({ address, id }) => getToken(address, id)),
    getLabel('for'),
    ...payment.map(({ address, amountOrId }) => getToken(address, amountOrId)),
    getDeadline(end)
  ]
}

export const openSeaModule: HumanizerCallModule = (accountOp: AccountOp, irCalls: IrCall[]) => {
  return irCalls.map((call: IrCall) => {
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
      let [orders] = iface.decodeFunctionData('fulfillAvailableAdvancedOrders', call.data)
      // deduplicate same orders for eip1155 tokens
      orders = [...new Set(orders.map((o: any) => stringify(o)))].map((o: any) =>
        parse(o as string)
      )
      // orders = removeRepeating(orders)
      const totalOrders: Order[] = orders.map((o: any) => parseOrder(o))
      const fullVisualization = totalOrders.flat().map(humanizerOrder).flat()
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
