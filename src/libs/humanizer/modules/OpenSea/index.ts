import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { stringify } from '../../../richJson/richJson'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getToken,
  isHexCall
} from '../../utils'

const fulfillBasicOrderEfficientAbi = parseAbi([
  'function fulfillBasicOrder_efficient_6GL6yc((address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, (uint256 amount, address recipient)[] additionalRecipients, bytes signature) args) payable returns (bool fulfilled)'
] as const)
const fulfillBasicOrderAbi = parseAbi([
  'function fulfillBasicOrder((address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, (uint256 amount, address recipient)[] additionalRecipients, bytes signature) args) payable returns (bool fulfilled)'
])

// using the abi as json here because otherwise viem is not able to determine the type of the first param
const fulfillAvailableAdvancedOrdersAbi = [
  {
    name: 'fulfillAvailableAdvancedOrders',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'advancedOrders',
        type: 'tuple[]',
        components: [
          {
            name: 'parameters',
            type: 'tuple',
            components: [
              { name: 'offerer', type: 'address' },
              { name: 'zone', type: 'address' },
              {
                name: 'offer',
                type: 'tuple[]',
                components: [
                  { name: 'itemType', type: 'uint8' },
                  { name: 'token', type: 'address' },
                  { name: 'identifierOrCriteria', type: 'uint256' },
                  { name: 'startAmount', type: 'uint256' },
                  { name: 'endAmount', type: 'uint256' }
                ]
              },
              {
                name: 'consideration',
                type: 'tuple[]',
                components: [
                  { name: 'itemType', type: 'uint8' },
                  { name: 'token', type: 'address' },
                  { name: 'identifierOrCriteria', type: 'uint256' },
                  { name: 'startAmount', type: 'uint256' },
                  { name: 'endAmount', type: 'uint256' },
                  { name: 'recipient', type: 'address' }
                ]
              },
              { name: 'orderType', type: 'uint8' },
              { name: 'startTime', type: 'uint256' },
              { name: 'endTime', type: 'uint256' },
              { name: 'zoneHash', type: 'bytes32' },
              { name: 'salt', type: 'uint256' },
              { name: 'conduitKey', type: 'bytes32' },
              { name: 'totalOriginalConsiderationItems', type: 'uint256' }
            ]
          },
          { name: 'numerator', type: 'uint120' },
          { name: 'denominator', type: 'uint120' },
          { name: 'signature', type: 'bytes' },
          { name: 'extraData', type: 'bytes' }
        ]
      },
      {
        name: 'criteriaResolvers',
        type: 'tuple[]',
        components: [
          { name: 'orderIndex', type: 'uint256' },
          { name: 'side', type: 'uint8' },
          { name: 'index', type: 'uint256' },
          { name: 'identifier', type: 'uint256' },
          { name: 'criteriaProof', type: 'bytes32[]' }
        ]
      },
      {
        name: 'offerFulfillments',
        type: 'tuple[][]',
        components: [
          { name: 'orderIndex', type: 'uint256' },
          { name: 'itemIndex', type: 'uint256' }
        ]
      },
      {
        name: 'considerationFulfillments',
        type: 'tuple[][]',
        components: [
          { name: 'orderIndex', type: 'uint256' },
          { name: 'itemIndex', type: 'uint256' }
        ]
      },
      { name: 'fulfillerConduitKey', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'maximumFulfilled', type: 'uint256' }
    ],
    outputs: [
      { name: 'availableOrders', type: 'bool[]' },
      {
        name: 'executions',
        type: 'tuple[]',
        components: [
          {
            name: 'item',
            type: 'tuple',
            components: [
              { name: 'itemType', type: 'uint8' },
              { name: 'token', type: 'address' },
              { name: 'identifier', type: 'uint256' },
              { name: 'amount', type: 'uint256' },
              { name: 'recipient', type: 'address' }
            ]
          },
          { name: 'offerer', type: 'address' },
          { name: 'conduitKey', type: 'bytes32' }
        ]
      }
    ]
  }
] as const

const fulfillAdvancedOrderAbi = parseAbi([
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
  const { parameters: params, numerator: num, denominator: denum } = order
  const { offer: offers, consideration, endTime } = params
  const items = offers.map((o: any): Order['items'][0] => {
    const { token: address, identifierOrCriteria: id, startAmount: fromAmount, endAmount } = o
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
    const { itemType: type, token, identifierOrCriteria: tokenId, endAmount } = o
    if (Number(type) === 0 || Number(type) === 1)
      tokenPayments[token] = (tokenPayments[token] || 0n) + parsePrice(endAmount, num, denum)
    if (Number(type) === 2 || Number(type) === 3)
      payment.push({ address: token as string, amountOrId: BigInt(tokenId) })
  })
  Object.entries(tokenPayments).forEach(([address, amountOrId]) => {
    payment.push({ address, amountOrId })
  })
  return { items, payment, end: BigInt(endTime) }
}

const dedupe1155Orders = (orders: Order[]): any[] => {
  if (!orders[0] || orders.length <= 30) return orders
  const uniqueOrders = [...new Set(orders.map((o) => stringify(o)))]
  if (uniqueOrders.length > 1) return orders
  if (orders[0].items.length > 1) return orders
  if (orders[0].payment.length > 1) return orders
  // if (uniqueOrders.items.length > 1) return orders
  const correctNumberOfOrders = BigInt(orders.length - 30)
  const finalOrder = orders[0]
  if (!finalOrder.items[0]) return orders
  if (!finalOrder.payment[0]) return orders
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

export const openSeaModule: HumanizerCallModule = (accountOp: AccountOp, call: IrCall) => {
  if (!call.to || !isHexCall(call)) return call
  if (
    [
      toFunctionSelector(fulfillBasicOrderEfficientAbi[0]),
      toFunctionSelector(fulfillBasicOrderAbi[0])
    ].some((sel) => call.data.startsWith(sel))
  ) {
    let argsParam: any
    if (call.data.startsWith(toFunctionSelector(fulfillBasicOrderAbi[0]))) {
      const { args } = decodeFunctionData({ abi: fulfillBasicOrderAbi, data: call.data })
      argsParam = args[0]
    } else {
      const { args } = decodeFunctionData({
        abi: fulfillBasicOrderEfficientAbi,
        data: call.data
      })
      argsParam = args[0]
    }

    const { considerationToken, considerationAmount, offerToken, offerIdentifier, endTime } =
      argsParam

    return {
      ...call,
      fullVisualization: [
        getAction('Buy'),
        getToken(offerToken, offerIdentifier),
        getLabel('for'),
        getToken(considerationToken, considerationAmount),
        getDeadline(endTime)
      ]
    }
  }

  if (call.data.startsWith(toFunctionSelector(fulfillAvailableAdvancedOrdersAbi[0]))) {
    const { args } = decodeFunctionData({
      abi: fulfillAvailableAdvancedOrdersAbi,
      data: call.data
    })
    const [orders] = args

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
  if (call.data.startsWith(toFunctionSelector(fulfillAdvancedOrderAbi[0]))) {
    const { args } = decodeFunctionData({
      abi: fulfillAdvancedOrderAbi,
      data: call.data
    })
    const [order] = args
    const parsedOrder: Order = parseOrder(order)
    const fullVisualization = humanizerOrder(parsedOrder)
    return { ...call, fullVisualization }
  }

  return call
}
