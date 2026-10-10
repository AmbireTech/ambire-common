import {
  decodeAbiParameters,
  decodeFunctionData,
  isHex,
  parseAbi,
  parseAbiParameters,
  toFunctionSelector,
  zeroAddress
} from 'viem'

import { CowSwapOrderStruct } from '../../../../interfaces/swapAndBridge'
import { getCowSwapOrderUid } from '../../../../services/cowswap/helper'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerVisualization, IrCall } from '../../interfaces'
import {
  HexIrCall,
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getRecipientText,
  getToken,
  isHexCall
} from '../../utils'

const settleAbi = [
  {
    type: 'function',
    name: 'settle',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'tokens',
        type: 'address[]',
        internalType: 'address[]'
      },
      {
        name: 'clearingPrices',
        type: 'uint256[]',
        internalType: 'uint256[]'
      },
      {
        name: 'trades',
        type: 'tuple[]',
        internalType: 'tuple[]',
        components: [
          { name: 'sellTokenIndex', type: 'uint256', internalType: 'uint256' },
          { name: 'buyTokenIndex', type: 'uint256', internalType: 'uint256' },
          { name: 'receiver', type: 'address', internalType: 'address' },
          { name: 'sellAmount', type: 'uint256', internalType: 'uint256' },
          { name: 'buyAmount', type: 'uint256', internalType: 'uint256' },
          { name: 'validTo', type: 'uint32', internalType: 'uint32' },
          { name: 'appData', type: 'bytes32', internalType: 'bytes32' },
          { name: 'feeAmount', type: 'uint256', internalType: 'uint256' },
          { name: 'flags', type: 'uint256', internalType: 'uint256' },
          { name: 'executedAmount', type: 'uint256', internalType: 'uint256' },
          { name: 'signature', type: 'bytes', internalType: 'bytes' }
        ]
      },
      {
        name: 'interactions',
        type: 'tuple[][3]',
        internalType: 'tuple[][3]',
        components: [
          { name: 'target', type: 'address', internalType: 'address' },
          { name: 'value', type: 'uint256', internalType: 'uint256' },
          { name: 'callData', type: 'bytes', internalType: 'bytes' }
        ]
      }
    ],
    outputs: []
  }
] as const
const COW_SWAP_SETTLEMENT_ADDRESS = '0x9008d19f58aabd9ed0d60971565aa8510560ab41'
// ComposableCoW lets an account (typically a Safe) authorize a conditional order (e.g. a TWAP)
// that CoW's off-chain watchers later fill in parts via `settle`, so the humanization here
// describes the intent that is being authorized, not any single fill
const COMPOSABLE_COW_ADDRESS = '0xfdafc9d1902f4e0b84f65f49f244b32b31013b74'
// deployed at the same address on every network CoW supports (deterministic CREATE2 deployment)
const TWAP_HANDLER_ADDRESS = '0x6cf1e9ca41f7611def408122793c358a3d11e5a5'

const conditionalOrderParamsTuple = '(address handler,bytes32 salt,bytes staticInput) params'
const createAbi = parseAbi([`function create(${conditionalOrderParamsTuple}, bool dispatch)`])
const createWithContextAbi = parseAbi([
  `function createWithContext(${conditionalOrderParamsTuple}, address factory, bytes data, bool dispatch)`
])

const twapStaticInputAbiParams = parseAbiParameters(
  'address sellToken, address buyToken, address receiver, uint256 partSellAmount, uint256 minPartLimit, uint256 t0, uint256 n, uint256 t, uint256 span, bytes32 appData'
)

const tradeTuple =
  '(uint256 sellTokenIndex,uint256 buyTokenIndex,address receiver,uint256 sellAmount,uint256 buyAmount,uint32 validTo,bytes32 appData,uint256 feeAmount,uint256 flags,uint256 executedAmount,bytes signature)'
const swapAbi = parseAbi([
  `function swap((bytes32 poolId,uint256 assetIn,uint256 assetOut,uint256 amount,bytes userData)[] swaps,address[] tokens,${tradeTuple} order)`
])

const setPreSignatureAbi = parseAbi(['function setPreSignature(bytes orderUid,bool signed)'])
const invalidateOrderAbi = parseAbi(['function invalidateOrder(bytes orderUid)'])
const freeFilledAmountStorageAbi = parseAbi(['function freeFilledAmountStorage(bytes[] orderUids)'])
const freePreSignatureStorageAbi = parseAbi(['function freePreSignatureStorage(bytes[] orderUids)'])

type CowSwapOrder = {
  sellTokenIndex: bigint
  buyTokenIndex: bigint
  receiver: string
  sellAmount: bigint
  buyAmount: bigint
  validTo: number
  feeAmount: bigint
}

const getTokenAtIndex = (tokens: readonly string[], index: bigint): string | null => {
  if (index > BigInt(Number.MAX_SAFE_INTEGER)) return null

  return tokens[Number(index)] || null
}

const getOrderUidVisualization = (orderUid: string): HumanizerVisualization[] => {
  const orderDeadine: null | HumanizerVisualization =
    !isHex(orderUid) || orderUid.length !== 114
      ? null
      : getDeadline(BigInt(`0x${orderUid.slice(-8)}`))

  const shortOrderUid = `${orderUid.slice(0, 8)}...${orderUid.slice(-6)}`
  const label = getLabel(`with order ID ${shortOrderUid}`)
  if (orderDeadine) return [label, orderDeadine]
  else return [label]
}

const NATIVE_TOKEN_PLACEHOLDER_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

/**
 * Returns the order attached to a pre-sign or cancel call only if it hashes to `orderUid` for the
 * acting account on this network - the order ID commits to every field of the order, so a match
 * proves the attached order is exactly the one the transaction refers to.
 */
const getVerifiedOrderStruct = (
  accountOp: AccountOp,
  call: HexIrCall,
  orderUid: string
): CowSwapOrderStruct | null => {
  const order = call.cowSwapOrder
  if (!order || (order.kind !== 'sell' && order.kind !== 'buy')) return null

  let expectedOrderUid: string
  try {
    expectedOrderUid = getCowSwapOrderUid({
      chainId: accountOp.chainId,
      order,
      owner: accountOp.accountAddr
    })
  } catch (error) {
    console.error('CowSwap humanizer: the order attached to the call could not be encoded', error)
    return null
  }

  return expectedOrderUid.toLowerCase() === orderUid.toLowerCase() ? order : null
}

const getOrderStructVisualization = (
  accountOp: AccountOp,
  order: CowSwapOrderStruct
): HumanizerVisualization[] => {
  const { chainId, accountAddr } = accountOp
  const buyTokenAddress =
    order.buyToken.toLowerCase() === NATIVE_TOKEN_PLACEHOLDER_ADDRESS ? zeroAddress : order.buyToken
  const sellTokenVisualization = getToken(order.sellToken, BigInt(order.sellAmount), chainId)
  const buyTokenVisualization = getToken(buyTokenAddress, BigInt(order.buyAmount), chainId)
  const feeAmount = BigInt(order.feeAmount)
  const receiver = order.receiver.toLowerCase() === zeroAddress ? accountAddr : order.receiver

  return [
    ...(order.kind === 'sell'
      ? [sellTokenVisualization, getLabel('for at least'), buyTokenVisualization]
      : [buyTokenVisualization, getLabel('for at most'), sellTokenVisualization]),
    ...(feeAmount > 0n
      ? [getLabel('plus a fee of'), getToken(order.sellToken, feeAmount, chainId)]
      : []),
    ...(order.partiallyFillable ? [getLabel('that can be filled in parts')] : []),
    ...getRecipientText(accountAddr, receiver),
    getDeadline(order.validTo)
  ]
}

const getOrderVisualization = (
  accountOp: AccountOp,
  tokens: readonly string[],
  order: CowSwapOrder
): HumanizerVisualization[] => {
  const sellToken = getTokenAtIndex(tokens, order.sellTokenIndex)
  const buyToken = getTokenAtIndex(tokens, order.buyTokenIndex)
  if (!sellToken || !buyToken) return []

  return [
    getToken(sellToken, order.sellAmount, accountOp.chainId),
    getLabel('for at least'),
    getToken(buyToken, order.buyAmount, accountOp.chainId),
    ...(order.feeAmount > 0n
      ? [getLabel('including fee'), getToken(sellToken, order.feeAmount, accountOp.chainId)]
      : []),
    ...getRecipientText(accountOp.accountAddr, order.receiver),
    getDeadline(BigInt(order.validTo))
  ]
}

const getSettlementVisualization = (
  accountOp: AccountOp,
  tokens: readonly string[],
  trades: readonly CowSwapOrder[]
): HumanizerVisualization[] => {
  if (!trades.length) return [getAction('Settle CowSwap orders')]

  const tradeVisualizations = trades
    .map((trade) => getOrderVisualization(accountOp, tokens, trade))
    .filter((visualization) => visualization.length)

  if (!tradeVisualizations.length) return [getAction('Settle CowSwap orders')]

  return [
    getAction(tradeVisualizations.length === 1 ? 'Settle CowSwap order' : 'Settle CowSwap orders'),
    ...tradeVisualizations.flatMap((visualization, index) => [
      ...(index ? [getLabel('and')] : []),
      ...visualization
    ])
  ]
}

type ConditionalOrderParams = {
  handler: string
  salt: `0x${string}`
  staticInput: `0x${string}`
}

const formatDurationText = (seconds: bigint): string => {
  if (seconds % 3600n === 0n) {
    const hours = seconds / 3600n
    return `${hours} hour${hours === 1n ? '' : 's'}`
  }
  if (seconds % 60n === 0n) {
    const minutes = seconds / 60n
    return `${minutes} minute${minutes === 1n ? '' : 's'}`
  }
  return `${seconds} second${seconds === 1n ? '' : 's'}`
}

const getTwapVisualization = (
  accountOp: AccountOp,
  staticInput: `0x${string}`
): HumanizerVisualization[] | null => {
  const decoded = decodeAbiParameters(twapStaticInputAbiParams, staticInput)

  const [sellToken, buyToken, receiver, partSellAmount, minPartLimit, t0, n, t] = decoded
  if (n <= 0n) return null

  const totalSellAmount = partSellAmount * n
  const totalMinBuyAmount = minPartLimit * n

  return [
    getToken(sellToken, totalSellAmount, accountOp.chainId),
    getLabel('for at least'),
    getToken(buyToken, totalMinBuyAmount, accountOp.chainId),
    getLabel(`split into ${n} parts, once every ${formatDurationText(t)}`),
    ...(t0 !== 0n ? [getLabel(`starting ${new Date(Number(t0) * 1000).toLocaleString()}`)] : []),
    ...getRecipientText(accountOp.accountAddr, receiver)
  ]
}

const getConditionalOrderVisualization = (
  accountOp: AccountOp,
  params: ConditionalOrderParams
): HumanizerVisualization[] => {
  const handler = params.handler.toLowerCase()

  if (handler === TWAP_HANDLER_ADDRESS) {
    const twapVisualization = getTwapVisualization(accountOp, params.staticInput)
    if (twapVisualization) return [getAction('Create CoW TWAP order'), ...twapVisualization]
  }

  // an unrecognized conditional order handler (e.g. a limit order or a custom strategy) -
  // we can't decode `staticInput` without knowing its shape, so at least identify the handler
  return [
    getAction('Create CoW conditional order'),
    getLabel('via'),
    getAddressVisualization(handler)
  ]
}

const swapSelector = toFunctionSelector(swapAbi[0])
const settleSelector = toFunctionSelector(settleAbi[0])
const setPreSignatureSelector = toFunctionSelector(setPreSignatureAbi[0])
const invalidateOrderSelector = toFunctionSelector(invalidateOrderAbi[0])
const freeFilledAmountStorageSelector = toFunctionSelector(freeFilledAmountStorageAbi[0])
const freePreSignatureStorageSelector = toFunctionSelector(freePreSignatureStorageAbi[0])
const createSelector = toFunctionSelector(createAbi[0])
const createWithContextSelector = toFunctionSelector(createWithContextAbi[0])

// Pre-sign and cancel calls contain only the order ID. When the call carries the order it refers
// to and that order hashes to the same ID, show the order itself instead of its ID
const humanizeOrderUidCallWithVerifiedOrder = (
  accountOp: AccountOp,
  call: HexIrCall
): IrCall | null => {
  if (!call.cowSwapOrder) return null

  const selector = call.data.slice(0, 10)
  let orderUid: string
  let isCancellation: boolean
  if (selector === setPreSignatureSelector) {
    const { args } = decodeFunctionData({ abi: setPreSignatureAbi, data: call.data })
    const [decodedOrderUid, signed] = args
    orderUid = decodedOrderUid
    isCancellation = !signed
  } else if (selector === invalidateOrderSelector) {
    const { args } = decodeFunctionData({ abi: invalidateOrderAbi, data: call.data })
    const [decodedOrderUid] = args
    orderUid = decodedOrderUid
    isCancellation = true
  } else {
    return null
  }

  const order = getVerifiedOrderStruct(accountOp, call, orderUid)
  if (!order) return null

  const orderVisualization = getOrderStructVisualization(accountOp, order)
  const actionVisualization = isCancellation
    ? [getAction('Cancel CowSwap order'), getLabel(order.kind === 'sell' ? 'to swap' : 'to buy')]
    : [getAction(order.kind === 'sell' ? 'Swap' : 'Buy')]

  return {
    ...call,
    fullVisualization: [...actionVisualization, ...orderVisualization],
    preferredOverErc7730: true
  }
}

const CowSwapModule: HumanizerCallModule = (accountOp: AccountOp, call: IrCall) => {
  const matcher: Record<string, (call: HexIrCall) => HumanizerVisualization[]> = {
    [swapSelector]: (call) => {
      const { args } = decodeFunctionData({ abi: swapAbi, data: call.data })
      const [, tokens, order] = args

      return [getAction('Swap'), ...getOrderVisualization(accountOp, tokens, order)]
    },
    [settleSelector]: (call) => {
      const { args } = decodeFunctionData({ abi: settleAbi, data: call.data })
      const [tokens, , trades] = args
      return getSettlementVisualization(accountOp, tokens, trades)
    },
    [setPreSignatureSelector]: (call) => {
      const { args } = decodeFunctionData({ abi: setPreSignatureAbi, data: call.data })
      const [orderUid, signed] = args

      return [
        getAction(signed ? 'Pre-sign CowSwap order' : 'Cancel CowSwap order'),
        ...getOrderUidVisualization(orderUid)
      ]
    },
    [invalidateOrderSelector]: (call) => {
      const { args } = decodeFunctionData({ abi: invalidateOrderAbi, data: call.data })
      const [orderUid] = args

      return [getAction('Cancel CowSwap order'), ...getOrderUidVisualization(orderUid)]
    },
    [freeFilledAmountStorageSelector]: (call) => {
      const { args } = decodeFunctionData({ abi: freeFilledAmountStorageAbi, data: call.data })
      const [orderUids] = args

      return [getAction('Clear CowSwap filled amount storage'), getLabel(orderUids.length)]
    },
    [freePreSignatureStorageSelector]: (call) => {
      const { args } = decodeFunctionData({ abi: freePreSignatureStorageAbi, data: call.data })
      const [orderUids] = args

      return [getAction('Clear CowSwap pre-signature storage'), getLabel(orderUids.length)]
    },
    [createSelector]: (call) => {
      const { args } = decodeFunctionData({ abi: createAbi, data: call.data })
      const [params] = args

      return getConditionalOrderVisualization(accountOp, params)
    },
    [createWithContextSelector]: (call) => {
      const { args } = decodeFunctionData({ abi: createWithContextAbi, data: call.data })
      const [params] = args

      return getConditionalOrderVisualization(accountOp, params)
    }
  }

  if (call.fullVisualization || !isHexCall(call)) return call
  if (
    call.to?.toLowerCase() !== COW_SWAP_SETTLEMENT_ADDRESS &&
    call.to?.toLowerCase() !== COMPOSABLE_COW_ADDRESS
  )
    return call

  const hexCall = { ...call, to: call.to || zeroAddress }
  const callWithVerifiedOrder = humanizeOrderUidCallWithVerifiedOrder(accountOp, hexCall)
  if (callWithVerifiedOrder) return callWithVerifiedOrder

  const match = matcher[call.data.slice(0, 10)]
  if (!match) return call

  return { ...call, fullVisualization: match(hexCall) }
}

export default CowSwapModule
