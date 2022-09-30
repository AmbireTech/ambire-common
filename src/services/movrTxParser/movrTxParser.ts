import { Interface } from 'ethers/lib/utils'

import networks, { NetworkType } from '../../constants/networks'
import { HumanizerInfoType } from '../../hooks/useConstants'
import { formatNativeTokenAddress, knownTokens } from '../humanReadableTransactions'
import { getTokenIcon } from '../icons'

const getAssetInfo = (tokens: HumanizerInfoType['tokens'], address: any) => {
  const formattedAddress = formatNativeTokenAddress(address)
  // @ts-ignore
  return tokens[formattedAddress] || knownTokens[formattedAddress] || ['Unknown', 0]
}

const getAssetIcon = (address: any, chainId: any) => {
  const network = networks.find((n) => n.chainId === chainId)
  return network ? getTokenIcon(network.id, formatNativeTokenAddress(address)) : null
}

const formatTx = (
  tokens: HumanizerInfoType['tokens'],
  fromChainId: NetworkType['chainId'],
  toChainId: any,
  inputToken: string,
  outputToken: string,
  amount: {
    hex: string
    type: string
  }
) => {
  const fromAsset = getAssetInfo(tokens, inputToken)
  const toAsset = getAssetInfo(tokens, outputToken)
  const fromAssetIcon = getAssetIcon(inputToken, fromChainId)
  const toAssetIcon = getAssetIcon(outputToken, fromChainId)

  return {
    from: {
      chainId: fromChainId,
      asset: {
        address: inputToken,
        symbol: fromAsset[0],
        decimals: fromAsset[1],
        icon: fromAssetIcon
      },
      amount: amount.toString()
    },
    to: {
      chainId: toChainId.toNumber(),
      asset: {
        address: outputToken,
        symbol: toAsset[0],
        decimals: toAsset[1],
        icon: toAssetIcon
      },
      amount: null
    }
  }
}

const movrTxParser = (humanizerInfo: HumanizerInfoType) => {
  const MovrAnyswapInterface = new Interface(humanizerInfo.abis.MovrAnyswap)
  const MovrRouterInterface = new Interface(humanizerInfo.abis.MovrRouter)

  return {
    [MovrAnyswapInterface.getSighash('outboundTransferTo')]: (
      value: string,
      data: string,
      currentNetwork: NetworkType
    ) => {
      const { middlewareInputToken, amount, tokenToBridge, toChainId } =
        MovrAnyswapInterface.parseTransaction({ data, value }).args[0]
      return formatTx(
        humanizerInfo.tokens,
        currentNetwork.chainId,
        toChainId,
        middlewareInputToken,
        tokenToBridge,
        amount
      )
    },
    [MovrRouterInterface.getSighash('outboundTransferTo')]: (
      value: string,
      data: string,
      currentNetwork: NetworkType
    ) => {
      const { middlewareRequest, amount, bridgeRequest, toChainId } =
        MovrRouterInterface.parseTransaction({ data, value }).args[0]
      const { inputToken } = middlewareRequest
      const { inputToken: outputToken } = bridgeRequest
      return formatTx(
        humanizerInfo.tokens,
        currentNetwork.chainId,
        toChainId,
        inputToken,
        outputToken,
        amount
      )
    }
  }
}

export default movrTxParser
