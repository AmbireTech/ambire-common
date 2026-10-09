import {
  formatUnits,
  getAddress,
  Interface,
  isAddress,
  keccak256,
  solidityPacked,
  toUtf8Bytes,
  TypedDataEncoder,
  ZeroAddress
} from 'ethers'

import SwapAndBridgeProviderApiError from '@/classes/SwapAndBridgeProviderApiError'
import { FEE_COLLECTOR } from '@/consts/addresses'
import { CowSwapOrderCreation, SwapAndBridgeToToken } from '@/interfaces/swapAndBridge'
import {
  COWSWAP_APP_CODE,
  COWSWAP_APP_DATA_VERSION,
  COWSWAP_BUY_NATIVE_TOKEN_ADDRESS,
  COWSWAP_ETH_FLOW_ADDRESS,
  COWSWAP_SETTLEMENT_ADDRESS,
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
  const validTo = isEthFlow ? MAX_VALID_TO : order.validTo
  const orderDigest = TypedDataEncoder.hash(
    {
      name: 'Gnosis Protocol',
      version: 'v2',
      chainId,
      verifyingContract: COWSWAP_SETTLEMENT_ADDRESS
    },
    orderTypes,
    {
      sellToken: order.sellToken,
      buyToken: order.buyToken,
      receiver: order.receiver,
      sellAmount: order.sellAmount,
      buyAmount: order.buyAmount,
      validTo,
      appData: order.appDataHash,
      feeAmount: order.feeAmount,
      kind: order.kind,
      partiallyFillable: order.partiallyFillable,
      sellTokenBalance: order.sellTokenBalance,
      buyTokenBalance: order.buyTokenBalance
    }
  )

  return solidityPacked(
    ['bytes32', 'address', 'uint32'],
    [orderDigest, isEthFlow ? COWSWAP_ETH_FLOW_ADDRESS : owner, validTo]
  )
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
