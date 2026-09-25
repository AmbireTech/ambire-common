import { getAddress, keccak256, toUtf8Bytes, ZeroAddress } from 'ethers'

import {
  buildMarketOrderAppData,
  computeOrderUid,
  ethFlowInterface,
  getOutputValueInUsd,
  getProtocolFeeAmount,
  getWrappedNativeTokenAddress,
  normalizeBuyTokenAddress,
  settlementInterface
} from '@/services/cowswap/helper'

import SwapAndBridgeProviderApiError from '../../classes/SwapAndBridgeProviderApiError'
import { getTokenUsdAmount } from '../../controllers/signAccountOp/helper'
import { Fetch } from '../../interfaces/fetch'
import {
  CowSwapOrderCreation,
  CowSwapRawRoute,
  ProviderQuoteParams,
  SwapAndBridgeQuote,
  SwapAndBridgeRoute,
  SwapAndBridgeRouteStatusResult,
  SwapAndBridgeSendTxRequest,
  SwapAndBridgeStep,
  SwapAndBridgeSupportedChain,
  SwapAndBridgeToToken,
  SwapAndBridgeUserTx,
  SwapProvider
} from '../../interfaces/swapAndBridge'
import { getFeeExemptionReason } from '../../libs/swapAndBridge/fee'
import {
  convertPortfolioTokenToSwapAndBridgeToToken,
  getSlippage,
  isNoFeeToken
} from '../../libs/swapAndBridge/swapAndBridge'
import { CowSwapClient } from './client'
import {
  COWSWAP_ETH_FLOW_ADDRESS,
  COWSWAP_ORDER_VALIDITY_SECONDS,
  COWSWAP_SETTLEMENT_ADDRESS,
  COWSWAP_VAULT_RELAYER_ADDRESS
} from './constants'

export class CowSwapAPI implements SwapProvider {
  id = 'cowswap'

  name = 'CoW Swap'

  #client: CowSwapClient

  isHealthy: boolean | null = null

  supportedChains: SwapProvider['supportedChains'] = null

  constructor({ fetch, apiKey }: { fetch: Fetch; apiKey: string }) {
    this.#client = new CowSwapClient({ fetch, apiKey })
  }

  async updateHealth() {
    this.isHealthy = true
  }

  resetHealth() {
    this.isHealthy = null
  }

  areChainsSupported({ fromChainId, toChainId }: { fromChainId: number; toChainId: number }) {
    const supportedChainIds = this.#client.getSupportedChains().map(({ chainId }) => chainId)
    return supportedChainIds.includes(fromChainId) && supportedChainIds.includes(toChainId)
  }

  async getSupportedChains(): Promise<SwapAndBridgeSupportedChain[]> {
    const chains = this.#client.getSupportedChains()
    this.supportedChains = chains
    return chains
  }

  async getToTokenList({
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    fromChainId,
    toChainId
  }: {
    fromChainId: number
    toChainId: number
  }): Promise<SwapAndBridgeToToken[]> {
    return this.#client.getToTokenList(toChainId)
  }

  async getToken({
    address,
    chainId
  }: {
    address: string
    chainId: number
  }): Promise<SwapAndBridgeToToken | null> {
    return this.#client.getToken({ address, chainId })
  }

  async quote({
    fromAsset,
    fromChainId,
    fromTokenAddress,
    toAsset,
    toChainId,
    toTokenAddress,
    fromAmount,
    userAddress,
    isWrapOrUnwrap,
    feePercent
  }: ProviderQuoteParams): Promise<SwapAndBridgeQuote> {
    if (!this.areChainsSupported({ fromChainId, toChainId })) {
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but CoW Swap supports only same-network swaps on this network.'
      )
    }
    if (!fromAsset || !toAsset) {
      throw new SwapAndBridgeProviderApiError(
        'Quote requested, but token details are missing. Please select the tokens again.'
      )
    }
    const isEthFlow = fromTokenAddress.toLowerCase() === ZeroAddress.toLowerCase()
    const wrappedNativeTokenAddress = getWrappedNativeTokenAddress(fromChainId)
    if (isEthFlow && !wrappedNativeTokenAddress) {
      throw new SwapAndBridgeProviderApiError(
        'CoW Swap cannot sell the network native token on this network.'
      )
    }

    const sellToken = getAddress(isEthFlow ? wrappedNativeTokenAddress! : fromTokenAddress)
    const buyToken = normalizeBuyTokenAddress(toTokenAddress)
    const owner = getAddress(userAddress)
    const slippageBps = Math.round(Number(getSlippage(fromAsset, fromAmount, '0.5', 0.5)) * 100)
    const feeExemptionReason = getFeeExemptionReason({
      isWrapOrUnwrap,
      isFeeExemptToken: isNoFeeToken(fromChainId, sellToken)
    })
    const shouldIncludeConvenienceFee = feePercent > 0 && !feeExemptionReason
    const feeBps = shouldIncludeConvenienceFee ? Math.round(feePercent * 100) : undefined
    const { fullAppData, appDataHash } = buildMarketOrderAppData({ slippageBps, feeBps })
    const quoteRequest = {
      sellToken,
      buyToken,
      receiver: owner,
      from: owner,
      sellAmountBeforeFee: fromAmount.toString(),
      kind: 'sell',
      validFor: COWSWAP_ORDER_VALIDITY_SECONDS,
      appData: fullAppData,
      appDataHash,
      priceQuality: 'optimal',
      signingScheme: isEthFlow ? 'eip1271' : 'presign',
      ...(isEthFlow
        ? {
            onchainOrder: true,
            verificationGasLimit: 0
          }
        : {})
    }
    const quoteResponse = await this.#client.getQuote(fromChainId, quoteRequest)
    const quotedOrder = quoteResponse.quote
    if (
      !quotedOrder ||
      typeof quotedOrder.sellToken !== 'string' ||
      typeof quotedOrder.buyToken !== 'string' ||
      typeof quotedOrder.receiver !== 'string' ||
      typeof quotedOrder.sellAmount !== 'string' ||
      typeof quotedOrder.buyAmount !== 'string' ||
      typeof quotedOrder.feeAmount !== 'string' ||
      typeof quotedOrder.appData !== 'string'
    ) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to fetch the quote. CoW Swap returned incomplete order details.'
      )
    }
    const returnedAppDataHash =
      quotedOrder.appDataHash ||
      (quotedOrder.appData.startsWith('0x') && quotedOrder.appData.length === 66
        ? quotedOrder.appData
        : null)
    if (
      quotedOrder.sellToken.toLowerCase() !== sellToken.toLowerCase() ||
      quotedOrder.buyToken.toLowerCase() !== buyToken.toLowerCase() ||
      quotedOrder.receiver.toLowerCase() !== owner.toLowerCase() ||
      quotedOrder.kind !== 'sell' ||
      quotedOrder.partiallyFillable !== false ||
      quotedOrder.signingScheme !== (isEthFlow ? 'eip1271' : 'presign') ||
      returnedAppDataHash?.toLowerCase() !== appDataHash.toLowerCase() ||
      !Number.isInteger(quotedOrder.validTo) ||
      quotedOrder.validTo <= Math.floor(Date.now() / 1000) ||
      !Number.isSafeInteger(quoteResponse.id) ||
      Number(quoteResponse.id) < 0
    ) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to fetch the quote. CoW Swap returned order details that do not match your request.'
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
        'Unable to fetch the quote. CoW Swap returned invalid token amounts.'
      )
    }
    const sellAmount = quotedSellAmount + networkFee

    if (sellAmount !== fromAmount || quotedSellAmount <= 0n) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to fetch the quote. CoW Swap returned an unexpected spend amount.'
      )
    }

    const protocolFeeBps = Number(quoteResponse.protocolFeeBps || 0)
    if (!Number.isFinite(protocolFeeBps) || protocolFeeBps < 0) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to fetch the quote. CoW Swap returned an invalid fee.'
      )
    }

    const networkFeeInBuyToken = (quotedBuyAmount * networkFee) / quotedSellAmount
    const protocolFee = getProtocolFeeAmount(quotedBuyAmount, protocolFeeBps)
    const buyAmountBeforeFees = quotedBuyAmount + networkFeeInBuyToken + protocolFee
    const partnerFee = feeBps ? (buyAmountBeforeFees * BigInt(feeBps)) / 10000n : 0n
    const toAmount = quotedBuyAmount - partnerFee
    const minAmountOut = toAmount - (toAmount * BigInt(slippageBps)) / 10000n

    if (toAmount <= 0n || minAmountOut <= 0n) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to fetch the quote. The expected receive amount is too low.'
      )
    }

    const order: CowSwapOrderCreation = {
      sellToken,
      buyToken,
      receiver: owner,
      sellAmount: sellAmount.toString(),
      buyAmount: minAmountOut.toString(),
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
    const orderUid = computeOrderUid({ chainId: fromChainId, order, owner, isEthFlow })
    const normalizedFromAsset = convertPortfolioTokenToSwapAndBridgeToToken(fromAsset, fromChainId)
    const protocol = { name: 'CoW Swap', displayName: 'CoW Swap', icon: '' }
    const serviceTime = 10
    const inputValueInUsd = Number(getTokenUsdAmount(fromAsset, sellAmount) || 0)
    const outputValueInUsd = getOutputValueInUsd({
      inputValueInUsd,
      toAsset,
      toAmount: toAmount.toString(),
      buyAmountBeforeFees
    })
    const userTx: SwapAndBridgeUserTx = {
      userTxIndex: 0,
      fromAsset: normalizedFromAsset,
      toAsset,
      chainId: fromChainId,
      fromAmount: sellAmount.toString(),
      toAmount: toAmount.toString(),
      swapSlippage: slippageBps / 100,
      serviceTime,
      protocol,
      minAmountOut: minAmountOut.toString()
    }
    const step: SwapAndBridgeStep = { ...userTx, type: 'swap' }
    const rawRoute: CowSwapRawRoute = { quoteResponse, order, isEthFlow }
    const route: SwapAndBridgeRoute = {
      providerId: this.id,
      routeId: orderUid,
      currentUserTxIndex: 0,
      fromChainId,
      toChainId,
      userAddress: owner,
      isOnlySwapRoute: true,
      fromAmount: sellAmount.toString(),
      toAmount: toAmount.toString(),
      usedDexName: 'CoW Swap',
      userTxs: [userTx],
      sender: owner,
      steps: [step],
      inputValueInUsd,
      outputValueInUsd,
      serviceTime,
      rawRoute,
      toToken: {
        address: toAsset.address,
        chainId: toAsset.chainId,
        decimals: toAsset.decimals,
        logoURI: toAsset.icon || '',
        name: toAsset.name,
        priceUSD: toAsset.priceUSD,
        symbol: toAsset.symbol
      } as any,
      disabled: false,
      withConvenienceFee: shouldIncludeConvenienceFee,
      feeExemptionReason,
      isIntent: true
    }

    return {
      fromAsset: normalizedFromAsset,
      fromChainId,
      toAsset,
      toChainId,
      selectedRoute: undefined,
      selectedRouteSteps: [],
      routes: [route]
    }
  }

  async startRoute(route: SwapAndBridgeRoute): Promise<SwapAndBridgeSendTxRequest> {
    if (
      !this.areChainsSupported({ fromChainId: route.fromChainId, toChainId: route.toChainId }) ||
      !('order' in route.rawRoute) ||
      typeof route.rawRoute.order.from !== 'string' ||
      route.rawRoute.order.from.toLowerCase() !== route.userAddress.toLowerCase()
    ) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to start the CoW Swap route because the order details do not match your account.'
      )
    }
    const rawRoute = route.rawRoute

    let orderUid: string
    try {
      orderUid = computeOrderUid({
        chainId: route.fromChainId,
        order: rawRoute.order,
        owner: route.userAddress,
        isEthFlow: rawRoute.isEthFlow
      })
    } catch {
      throw new SwapAndBridgeProviderApiError(
        'Unable to start the CoW Swap route because the order details are invalid.'
      )
    }
    if (orderUid !== route.routeId) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to start the CoW Swap route because the order details changed.'
      )
    }

    if (rawRoute.isEthFlow) {
      const wrappedNativeTokenAddress = getWrappedNativeTokenAddress(route.fromChainId)
      const quoteId = rawRoute.order.quoteId
      const quotedOrder = rawRoute.quoteResponse.quote
      if (
        !wrappedNativeTokenAddress ||
        rawRoute.order.signingScheme !== 'eip1271' ||
        quotedOrder.signingScheme !== 'eip1271' ||
        rawRoute.order.sellToken.toLowerCase() !== wrappedNativeTokenAddress.toLowerCase() ||
        rawRoute.order.receiver.toLowerCase() === ZeroAddress.toLowerCase() ||
        rawRoute.order.validTo !== quotedOrder.validTo ||
        quoteId !== rawRoute.quoteResponse.id ||
        !Number.isSafeInteger(quoteId) ||
        Number(quoteId) < 0 ||
        keccak256(toUtf8Bytes(rawRoute.order.appData)).toLowerCase() !==
          rawRoute.order.appDataHash.toLowerCase()
      ) {
        throw new SwapAndBridgeProviderApiError(
          'Unable to start the CoW Swap route because the ETH order details changed.'
        )
      }

      await this.#client.uploadAppData(
        route.fromChainId,
        rawRoute.order.appDataHash,
        rawRoute.order.appData
      )

      let value: string
      try {
        value = (BigInt(rawRoute.order.sellAmount) + BigInt(rawRoute.order.feeAmount)).toString()
      } catch {
        throw new SwapAndBridgeProviderApiError(
          'Unable to start the CoW Swap route because the ETH amount is invalid.'
        )
      }

      return {
        activeRouteId: route.routeId,
        approvalData: null,
        chainId: route.fromChainId,
        txTarget: COWSWAP_ETH_FLOW_ADDRESS,
        userTxIndex: 0,
        value,
        txData: ethFlowInterface.encodeFunctionData('createOrder', [
          {
            buyToken: rawRoute.order.buyToken,
            receiver: rawRoute.order.receiver,
            sellAmount: rawRoute.order.sellAmount,
            buyAmount: rawRoute.order.buyAmount,
            appData: rawRoute.order.appDataHash,
            feeAmount: rawRoute.order.feeAmount,
            validTo: rawRoute.order.validTo,
            partiallyFillable: rawRoute.order.partiallyFillable,
            quoteId
          }
        ])
      }
    }

    if (rawRoute.order.signingScheme !== 'presign') {
      throw new SwapAndBridgeProviderApiError(
        'Unable to start the CoW Swap route because the order signing method changed.'
      )
    }

    return {
      activeRouteId: route.routeId,
      approvalData: {
        allowanceTarget: COWSWAP_VAULT_RELAYER_ADDRESS,
        approvalTokenAddress: rawRoute.order.sellToken,
        minimumApprovalAmount: rawRoute.order.sellAmount,
        owner: route.userAddress
      },
      chainId: route.fromChainId,
      txTarget: COWSWAP_SETTLEMENT_ADDRESS,
      userTxIndex: 0,
      value: '0',
      txData: settlementInterface.encodeFunctionData('setPreSignature', [route.routeId, true])
    }
  }

  async getRouteStatus({
    fromChainId,
    routeId,
    rawRoute
  }: {
    txHash: string
    fromChainId: number
    toChainId: number
    routeId?: string
    rawRoute?: SwapAndBridgeRoute['rawRoute']
  }): Promise<SwapAndBridgeRouteStatusResult> {
    if (!routeId || !rawRoute || !('order' in rawRoute)) {
      throw new SwapAndBridgeProviderApiError(
        'Unable to check the CoW Swap order because its details are missing.'
      )
    }

    let order = await this.#client.getOrder(fromChainId, routeId)
    if (!order) {
      if (rawRoute.isEthFlow) return { status: null }
      const wasSubmitted = await this.#client.submitOrder({
        chainId: fromChainId,
        order: rawRoute.order,
        orderUid: routeId
      })
      if (!wasSubmitted) return { status: null }
      order = await this.#client.getOrder(fromChainId, routeId)
    }

    if (!order || order.status === 'presignaturePending' || order.status === 'open') {
      return { status: null }
    }
    if (order.status === 'fulfilled') {
      return {
        status: 'completed',
        txnId: await this.#client.getSettlementTransaction(fromChainId, routeId)
      }
    }

    return { status: 'failed' }
  }
}
