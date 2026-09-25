import { getAddress, keccak256, toUtf8Bytes, ZeroAddress } from 'ethers'

import SwapAndBridgeProviderApiError from '@/classes/SwapAndBridgeProviderApiError'
import { Fetch } from '@/interfaces/fetch'
import { LimitOrderData, PreparedLimitOrder } from '@/interfaces/limitOrders'
import { CowSwapOrderCreation, SwapAndBridgeToToken } from '@/interfaces/swapAndBridge'
import { TokenResult } from '@/libs/portfolio'
import { getFeeExemptionReason } from '@/libs/swapAndBridge/fee'
import { isNoFeeToken } from '@/libs/swapAndBridge/swapAndBridge'
import { CowSwapClient } from '@/services/cowswap/client'
import {
  buildLimitOrderAppData,
  computeOrderUid,
  ethFlowInterface,
  getProtocolFeeAmount,
  getWrappedNativeTokenAddress,
  normalizeBuyTokenAddress,
  settlementInterface
} from '@/services/cowswap/helper'

import {
  COWSWAP_ETH_FLOW_ADDRESS,
  COWSWAP_SETTLEMENT_ADDRESS,
  COWSWAP_VAULT_RELAYER_ADDRESS
} from './constants'

export class LimitOrderAPI {
  #client: CowSwapClient

  constructor({ fetch, apiKey }: { fetch: Fetch; apiKey: string }) {
    this.#client = new CowSwapClient({ fetch, apiKey })
  }

  getSupportedChains() {
    return this.#client.getSupportedChains()
  }

  getToTokenList(chainId: number) {
    return this.#client.getToTokenList(chainId)
  }

  getToken({ address, chainId }: { address: string; chainId: number }) {
    return this.#client.getToken({ address, chainId })
  }

  async prepareOrder({
    fromToken,
    toToken,
    fromAmount,
    targetBuyAmount,
    owner: ownerAddress,
    validTo,
    feePercent
  }: {
    fromToken: TokenResult
    toToken: SwapAndBridgeToToken
    fromAmount: bigint
    targetBuyAmount: bigint
    owner: string
    validTo: number
    feePercent: number
  }): Promise<PreparedLimitOrder> {
    const chainId = Number(fromToken.chainId)
    if (!this.getSupportedChains().some((chain) => chain.chainId === chainId)) {
      throw new SwapAndBridgeProviderApiError(
        'Limit orders are not available on the selected network.'
      )
    }
    if (chainId !== toToken.chainId) {
      throw new SwapAndBridgeProviderApiError('Limit orders must use tokens on the same network.')
    }
    if (fromAmount <= 0n || targetBuyAmount <= 0n) {
      throw new SwapAndBridgeProviderApiError('Enter an amount and a limit price to continue.')
    }
    if (!Number.isInteger(validTo) || validTo <= Math.floor(Date.now() / 1000)) {
      throw new SwapAndBridgeProviderApiError('Choose a future expiration for the limit order.')
    }

    const isEthFlow = fromToken.address.toLowerCase() === ZeroAddress.toLowerCase()
    const wrappedNativeTokenAddress = getWrappedNativeTokenAddress(chainId)
    if (isEthFlow && !wrappedNativeTokenAddress) {
      throw new SwapAndBridgeProviderApiError(
        'CoW Swap cannot sell the network native token on this network.'
      )
    }

    const sellToken = getAddress(isEthFlow ? wrappedNativeTokenAddress! : fromToken.address)
    const buyToken = normalizeBuyTokenAddress(toToken.address)
    if (sellToken.toLowerCase() === buyToken.toLowerCase()) {
      throw new SwapAndBridgeProviderApiError('Choose two different tokens for the limit order.')
    }
    const owner = getAddress(ownerAddress)
    const feeExemptionReason = getFeeExemptionReason({
      isWrapOrUnwrap: false,
      isFeeExemptToken: isNoFeeToken(chainId, sellToken)
    })
    const feeBps = feePercent > 0 && !feeExemptionReason ? Math.round(feePercent * 100) : undefined
    const { fullAppData, appDataHash } = buildLimitOrderAppData({ feeBps })
    const quoteResponse = await this.#client.getQuote(chainId, {
      sellToken,
      buyToken,
      receiver: owner,
      from: owner,
      sellAmountBeforeFee: fromAmount.toString(),
      kind: 'sell',
      validTo,
      appData: fullAppData,
      appDataHash,
      priceQuality: 'optimal',
      partiallyFillable: false,
      signingScheme: isEthFlow ? 'eip1271' : 'presign',
      ...(isEthFlow ? { onchainOrder: true, verificationGasLimit: 0 } : {})
    })
    const quotedOrder = quoteResponse.quote
    const returnedAppDataHash =
      quotedOrder?.appDataHash ||
      (quotedOrder?.appData?.startsWith('0x') && quotedOrder.appData.length === 66
        ? quotedOrder.appData
        : null)
    if (
      !quotedOrder ||
      quotedOrder.sellToken?.toLowerCase() !== sellToken.toLowerCase() ||
      quotedOrder.buyToken?.toLowerCase() !== buyToken.toLowerCase() ||
      quotedOrder.receiver?.toLowerCase() !== owner.toLowerCase() ||
      quotedOrder.kind !== 'sell' ||
      quotedOrder.partiallyFillable !== false ||
      quotedOrder.signingScheme !== (isEthFlow ? 'eip1271' : 'presign') ||
      returnedAppDataHash?.toLowerCase() !== appDataHash.toLowerCase() ||
      !Number.isSafeInteger(quoteResponse.id) ||
      Number(quoteResponse.id) < 0 ||
      !Number.isSafeInteger(quotedOrder.validTo) ||
      quotedOrder.validTo <= Math.floor(Date.now() / 1000)
    ) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to prepare the limit order because CoW Swap returned unexpected details.'
      )
    }

    let quotedSellAmount: bigint
    let quotedBuyAmount: bigint
    let networkFee: bigint
    try {
      quotedSellAmount = BigInt(quotedOrder.sellAmount)
      quotedBuyAmount = BigInt(quotedOrder.buyAmount)
      networkFee = BigInt(quotedOrder.feeAmount)
    } catch {
      throw new SwapAndBridgeProviderApiError(
        'Unable to prepare the limit order because CoW Swap returned an invalid market price.'
      )
    }
    if (quotedSellAmount + networkFee !== fromAmount || quotedSellAmount <= 0n) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to prepare the limit order because CoW Swap returned an unexpected spend amount.'
      )
    }
    const protocolFeeBps = Number(quoteResponse.protocolFeeBps || 0)
    if (!Number.isFinite(protocolFeeBps) || protocolFeeBps < 0) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to prepare the limit order because CoW Swap returned an invalid fee.'
      )
    }
    const networkFeeInBuyToken = (quotedBuyAmount * networkFee) / quotedSellAmount
    const protocolFee = getProtocolFeeAmount(quotedBuyAmount, protocolFeeBps)
    const marketBuyAmountBeforeFees = quotedBuyAmount + networkFeeInBuyToken + protocolFee
    const partnerFee = feeBps
      ? (marketBuyAmountBeforeFees * BigInt(feeBps)) / 10000n
      : 0n
    const currentMarketBuyAmount = quotedBuyAmount - partnerFee
    if (currentMarketBuyAmount <= 0n) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to prepare the limit order because the expected receive amount is too low.'
      )
    }

    const order: CowSwapOrderCreation = {
      sellToken,
      buyToken,
      receiver: owner,
      sellAmount: fromAmount.toString(),
      // The amount entered by the user is the net minimum they must receive. Partner fees may
      // consume price improvement, but must never make execution violate this limit.
      buyAmount: targetBuyAmount.toString(),
      validTo: quotedOrder.validTo,
      appData: fullAppData,
      appDataHash,
      feeAmount: '0',
      kind: 'sell',
      partiallyFillable: false,
      sellTokenBalance: 'erc20',
      buyTokenBalance: 'erc20',
      signingScheme: isEthFlow ? 'eip1271' : 'presign',
      signature: '0x',
      from: owner,
      quoteId: quoteResponse.id ?? null
    }
    const orderUid = computeOrderUid({ chainId, order, owner, isEthFlow })

    if (isEthFlow) await this.#client.uploadAppData(chainId, appDataHash, fullAppData)

    const userTx = isEthFlow
      ? {
          activeRouteId: orderUid,
          approvalData: null,
          chainId,
          txTarget: COWSWAP_ETH_FLOW_ADDRESS,
          userTxIndex: 0,
          value: fromAmount.toString(),
          txData: ethFlowInterface.encodeFunctionData('createOrder', [
            {
              buyToken,
              receiver: owner,
              sellAmount: order.sellAmount,
              buyAmount: order.buyAmount,
              appData: appDataHash,
              feeAmount: order.feeAmount,
              validTo: order.validTo,
              partiallyFillable: false,
              quoteId: order.quoteId
            }
          ])
        }
      : {
          activeRouteId: orderUid,
          approvalData: {
            allowanceTarget: COWSWAP_VAULT_RELAYER_ADDRESS,
            approvalTokenAddress: sellToken,
            minimumApprovalAmount: order.sellAmount,
            owner
          },
          chainId,
          txTarget: COWSWAP_SETTLEMENT_ADDRESS,
          userTxIndex: 0,
          value: '0',
          txData: settlementInterface.encodeFunctionData('setPreSignature', [orderUid, true])
        }

    if (keccak256(toUtf8Bytes(order.appData)).toLowerCase() !== appDataHash.toLowerCase()) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to prepare the limit order because its fee information changed.'
      )
    }

    return {
      chainId,
      currentMarketBuyAmount: currentMarketBuyAmount.toString(),
      feeExemptionReason,
      feePercent: feeBps ? feeBps / 100 : 0,
      fromToken,
      isEthFlow,
      order,
      orderUid,
      targetBuyAmount: targetBuyAmount.toString(),
      toToken,
      userTx
    }
  }

  async tryPlaceOrder({ chainId, isEthFlow, order, orderUid }: LimitOrderData) {
    const existingOrder = await this.#client.getOrder(chainId, orderUid)
    if (existingOrder) return true
    if (isEthFlow) return false

    const submitted = await this.#client.submitOrder({ chainId, order, orderUid })
    if (!submitted) return false

    return !!(await this.#client.getOrder(chainId, orderUid))
  }
}
