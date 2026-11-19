import {
  formatUnits,
  Interface,
  isAddress,
  keccak256,
  solidityPacked,
  toUtf8Bytes,
  TypedDataEncoder,
  ZeroAddress
} from 'ethers'
// viem's, because on mobile it is swapped for a native checksum (ethers' hashes in JS, ~1ms per
// address there) and the token list normalizes hundreds of addresses at once
import { getAddress } from 'viem'

import SwapAndBridgeProviderApiError from '@/classes/SwapAndBridgeProviderApiError'
import { FEE_COLLECTOR } from '@/consts/addresses'
import { SMALL_SWAP_MAX_USD } from '@/consts/safeguards/extremeSwapLoss'
import {
  CowSwapOrderCreation,
  CowSwapOrderStruct,
  SwapAndBridgeToToken
} from '@/interfaces/swapAndBridge'
import {
  COWSWAP_APP_CODE,
  COWSWAP_APP_DATA_VERSION,
  COWSWAP_BUY_NATIVE_TOKEN_ADDRESS,
  COWSWAP_ETH_FLOW_ADDRESS,
  COWSWAP_MIN_SLIPPAGE_BPS,
  COWSWAP_NETWORK_COST_INCREASE_PERCENT,
  COWSWAP_SETTLEMENT_ADDRESS,
  COWSWAP_SMALL_TRADE_MAX_SLIPPAGE_BPS,
  COWSWAP_SUPPORTED_CHAINS
} from '@/services/cowswap/constants'
import { CowSwapTokenListEntry } from '@/services/cowswap/types'

export const settlementInterface = new Interface([
  'function setPreSignature(bytes orderUid, bool signed)'
])
export const ethFlowInterface = new Interface([
  'function createOrder((address buyToken,address receiver,uint256 sellAmount,uint256 buyAmount,bytes32 appData,uint256 feeAmount,uint32 validTo,bool partiallyFillable,int64 quoteId) order) payable returns (bytes32 orderHash)'
])
const MAX_VALID_TO = 2 ** 32 - 1

const orderTypes = {
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

export const isCowSwapTokenListEntry = (value: unknown): value is CowSwapTokenListEntry => {
  if (!value || typeof value !== 'object') return false
  if (
    !('address' in value) ||
    !('chainId' in value) ||
    !('decimals' in value) ||
    !('name' in value) ||
    !('symbol' in value)
  )
    return false

  return (
    typeof value.address === 'string' &&
    isAddress(value.address) &&
    typeof value.chainId === 'number' &&
    Number.isInteger(value.chainId) &&
    typeof value.decimals === 'number' &&
    Number.isInteger(value.decimals) &&
    value.decimals >= 0 &&
    value.decimals <= 255 &&
    typeof value.name === 'string' &&
    !!value.name &&
    typeof value.symbol === 'string' &&
    !!value.symbol &&
    (!('logoURI' in value) || value.logoURI === undefined || typeof value.logoURI === 'string')
  )
}

export const normalizeCowSwapToken = (token: CowSwapTokenListEntry): SwapAndBridgeToToken => ({
  address: getAddress(token.address),
  chainId: token.chainId,
  decimals: token.decimals,
  icon: token.logoURI || '',
  name: token.name,
  symbol: token.symbol
})

export const getApiNetwork = (chainId: number) =>
  COWSWAP_SUPPORTED_CHAINS.find((chain) => chain.chainId === chainId)?.apiNetwork

export const getWrappedNativeTokenAddress = (chainId: number) =>
  COWSWAP_SUPPORTED_CHAINS.find((chain) => chain.chainId === chainId)?.wrappedNativeTokenAddress

export const normalizeBuyTokenAddress = (address: string) =>
  address.toLowerCase() === ZeroAddress.toLowerCase()
    ? COWSWAP_BUY_NATIVE_TOKEN_ADDRESS
    : getAddress(address)

/**
 * Reads the slippage from a CoW Swap smart slippage response
 * (`GET {chainId}/markets/{sellToken}-{buyToken}/slippageTolerance`). Returns null when the
 * response has none, including a zero slippage, which CoW Swap returns for pairs it has no
 * market data for
 */
export const parseSmartSlippageBps = (body: unknown): number | null => {
  if (!body || typeof body !== 'object' || !('slippageBps' in body)) return null

  const { slippageBps } = body
  if (typeof slippageBps !== 'number' || !Number.isSafeInteger(slippageBps)) return null
  if (slippageBps <= 0) return null

  return slippageBps
}

/**
 * The slippage of a CoW Swap order that covers price movement. CoW Swap's smart slippage
 * follows the volatility of the pair, so orders fill more often when the market moves, and it
 * is lower than the fixed slippage for stable pairs. It is capped so that the order never
 * allows a bigger loss than the swap screen considers normal:
 * - below `SMALL_SWAP_MAX_USD` it can go up to `COWSWAP_SMALL_TRADE_MAX_SLIPPAGE_BPS`
 * - for larger swaps, or when the swap value is unknown, it can only lower the fixed
 *   slippage, which keeps the possible loss around $100 at most
 * It is never below `COWSWAP_MIN_SLIPPAGE_BPS`, which takes over from the fixed slippage for
 * swaps above ~$2M
 */
export const getPriceSlippageBps = ({
  smartSlippageBps,
  fixedSlippageBps,
  fromAmountInUsd
}: {
  smartSlippageBps: number | null
  fixedSlippageBps: number
  fromAmountInUsd: number
}) => {
  const minFixedSlippageBps = Math.max(fixedSlippageBps, COWSWAP_MIN_SLIPPAGE_BPS)
  if (!smartSlippageBps) return minFixedSlippageBps

  const isKnownSmallTrade =
    Number.isFinite(fromAmountInUsd) && fromAmountInUsd > 0 && fromAmountInUsd < SMALL_SWAP_MAX_USD
  const maxSlippageBps = isKnownSmallTrade
    ? Math.max(minFixedSlippageBps, COWSWAP_SMALL_TRADE_MAX_SLIPPAGE_BPS)
    : minFixedSlippageBps

  return Math.min(smartSlippageBps, maxSlippageBps)
}

/**
 * The slippage, in bps of what is sold after the network cost, that lets the network cost
 * grow by `COWSWAP_NETWORK_COST_INCREASE_PERCENT` before the order settles. Rounded up, so
 * that the room is never smaller than intended
 */
export const getNetworkCostSlippageBps = ({
  networkFee,
  sellAmountAfterNetworkCost
}: {
  networkFee: bigint
  sellAmountAfterNetworkCost: bigint
}) => {
  if (networkFee <= 0n || sellAmountAfterNetworkCost <= 0n) return 0

  // percent * 100 = bps, so dividing this by the amount sold gives the increase in bps
  const allowedIncreaseTimesBps = networkFee * COWSWAP_NETWORK_COST_INCREASE_PERCENT * 100n

  return Number(
    (allowedIncreaseTimesBps + sellAmountAfterNetworkCost - 1n) / sellAmountAfterNetworkCost
  )
}

export const getProtocolFeeAmount = (buyAmount: bigint, protocolFeeBps: number) => {
  if (protocolFeeBps <= 0) return 0n

  const precision = 100000n
  const protocolFeeBpsWithPrecision = BigInt(Math.round(protocolFeeBps * Number(precision)))
  const denominator = 10000n * precision - protocolFeeBpsWithPrecision

  if (denominator <= 0n) {
    throw new SwapAndBridgeProviderApiError(
      'Unable to fetch the quote. CoW Swap returned an invalid fee.'
    )
  }

  return (buyAmount * protocolFeeBpsWithPrecision) / denominator
}

export const buildAppData = ({ slippageBps, feeBps }: { slippageBps: number; feeBps?: number }) => {
  const appData = {
    appCode: COWSWAP_APP_CODE,
    metadata: {
      orderClass: { orderClass: 'market' },
      ...(feeBps
        ? {
            partnerFee: {
              recipient: FEE_COLLECTOR,
              volumeBps: feeBps
            }
          }
        : {}),
      quote: { slippageBips: slippageBps }
    },
    version: COWSWAP_APP_DATA_VERSION
  }
  const fullAppData = JSON.stringify(appData)

  return {
    fullAppData,
    appDataHash: keccak256(toUtf8Bytes(fullAppData))
  }
}

/** Picks the fields of an order we submit to CoW Swap that its order ID commits to. */
export const getCowSwapOrderStruct = (order: CowSwapOrderCreation): CowSwapOrderStruct => ({
  sellToken: order.sellToken,
  buyToken: order.buyToken,
  receiver: order.receiver,
  sellAmount: order.sellAmount,
  buyAmount: order.buyAmount,
  validTo: order.validTo,
  appData: order.appDataHash,
  feeAmount: order.feeAmount,
  kind: order.kind,
  partiallyFillable: order.partiallyFillable,
  sellTokenBalance: order.sellTokenBalance,
  buyTokenBalance: order.buyTokenBalance
})

/**
 * Builds the CoW Swap order ID (`orderUid`) of `order` owned by `owner` on `chainId`: the EIP-712
 * hash of the order, followed by the owner and the order's expiry. Pre-sign and cancel
 * transactions contain only this ID, so recomputing it from an order is how we prove which order
 * such a transaction refers to. Throws if a field of `order` can't be encoded.
 */
export const getCowSwapOrderUid = ({
  chainId,
  order,
  owner
}: {
  chainId: number | bigint
  order: CowSwapOrderStruct
  owner: string
}) => {
  const orderDigest = TypedDataEncoder.hash(
    {
      name: 'Gnosis Protocol',
      version: 'v2',
      chainId,
      verifyingContract: COWSWAP_SETTLEMENT_ADDRESS
    },
    orderTypes,
    order
  )

  return solidityPacked(['bytes32', 'address', 'uint32'], [orderDigest, owner, order.validTo])
}

export const computeOrderUid = ({
  chainId,
  order,
  owner,
  isEthFlow
}: {
  chainId: number
  order: CowSwapOrderCreation
  owner: string
  isEthFlow: boolean
}) => {
  const orderStruct = getCowSwapOrderStruct(order)
  if (!isEthFlow) return getCowSwapOrderUid({ chainId, order: orderStruct, owner })

  return getCowSwapOrderUid({
    chainId,
    order: { ...orderStruct, validTo: MAX_VALID_TO },
    owner: COWSWAP_ETH_FLOW_ADDRESS
  })
}

export const getOutputValueInUsd = ({
  inputValueInUsd,
  toAsset,
  toAmount,
  buyAmountBeforeFees
}: {
  inputValueInUsd: number
  toAsset: SwapAndBridgeToToken
  toAmount: string
  buyAmountBeforeFees: bigint
}) => {
  const priceUSD = Number(toAsset.priceUSD || 0)
  if (!priceUSD) {
    return inputValueInUsd * (Number(toAmount) / Number(buyAmountBeforeFees))
  }

  return Number(formatUnits(toAmount, toAsset.decimals)) * priceUSD
}
