import {
  decodeAbiParameters,
  decodeFunctionData,
  isHex,
  parseAbi,
  parseAbiParameters,
  toFunctionSelector,
  zeroAddress
} from 'viem'

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
  let decoded: readonly [
    string,
    string,
    string,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    string
  ]
  try {
    decoded = decodeAbiParameters(twapStaticInputAbiParams, staticInput) as typeof decoded
  } catch {
    return null
  }
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

const CowSwapModule: HumanizerCallModule = (accountOp: AccountOp, call: IrCall) => {
  const matcher: Record<string, (call: HexIrCall) => HumanizerVisualization[]> = {
    [toFunctionSelector(swapAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: swapAbi, data: call.data })
      const [, tokens, order] = args

      return [getAction('Swap'), ...getOrderVisualization(accountOp, tokens, order)]
    },
    [toFunctionSelector(settleAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: settleAbi, data: call.data })
      const [tokens, , trades] = args
      return getSettlementVisualization(accountOp, tokens, trades)
    },
    [toFunctionSelector(setPreSignatureAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: setPreSignatureAbi, data: call.data })
      const [orderUid, signed] = args

      return [
        getAction(signed ? 'Pre-sign CowSwap order' : 'Cancel CowSwap order'),
        ...getOrderUidVisualization(orderUid)
      ]
    },
    [toFunctionSelector(invalidateOrderAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: invalidateOrderAbi, data: call.data })
      const [orderUid] = args

      return [getAction('Cancel CowSwap order'), ...getOrderUidVisualization(orderUid)]
    },
    [toFunctionSelector(freeFilledAmountStorageAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: freeFilledAmountStorageAbi, data: call.data })
      const [orderUids] = args

      return [getAction('Clear CowSwap filled amount storage'), getLabel(orderUids.length)]
    },
    [toFunctionSelector(freePreSignatureStorageAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: freePreSignatureStorageAbi, data: call.data })
      const [orderUids] = args

      return [getAction('Clear CowSwap pre-signature storage'), getLabel(orderUids.length)]
    },
    [toFunctionSelector(createAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: createAbi, data: call.data })
      const [params] = args

      return getConditionalOrderVisualization(accountOp, params)
    },
    [toFunctionSelector(createWithContextAbi[0])]: (call) => {
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

  const match = matcher[call.data.slice(0, 10)]
  if (!match) return call

  return { ...call, fullVisualization: match({ ...call, to: call.to || zeroAddress }) }
}

export default CowSwapModule
