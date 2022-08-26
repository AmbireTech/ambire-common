// TODO: add more specific types

import { Interface } from 'ethers/lib/utils'

import { abis, tokens } from '../../constants/humanizerInfo.json'
import networks from '../../constants/networks'
import { formatNativeTokenAddress, knownTokens } from '../humanReadableTransactions'
import { getTokenIcon } from '../icons'

getTokenIcon
const MovrAnyswapInterface = new Interface(abis.MovrAnyswap)
const MovrRouterInterface = new Interface(abis.MovrRouter)

const getAssetInfo = (address: any) => {
  const formattedAddress = formatNativeTokenAddress(address)
  // @ts-ignore
  return tokens[formattedAddress] || knownTokens[formattedAddress] || ['Unknown', 0]
}

const getAssetIcon = (address: any, chainId: any) => {
  const network = networks.find((n) => n.chainId === chainId)
  return network ? getTokenIcon(network.id, formatNativeTokenAddress(address)) : null
}

const formatTx = (
  fromChainId: any,
  toChainId: any,
  inputToken: any,
  outputToken: any,
  amount: any
) => {
  const fromAsset = getAssetInfo(inputToken)
  const toAsset = getAssetInfo(outputToken)
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

const movrTxParser = {
  [MovrAnyswapInterface.getSighash('outboundTransferTo')]: (
    value: any,
    data: any,
    currentNetwork: any
  ) => {
    const { middlewareInputToken, amount, tokenToBridge, toChainId } =
      MovrAnyswapInterface.parseTransaction({ data, value }).args[0]
    return formatTx(currentNetwork.chainId, toChainId, middlewareInputToken, tokenToBridge, amount)
  },
  [MovrRouterInterface.getSighash('outboundTransferTo')]: (
    value: any,
    data: any,
    currentNetwork: any
  ) => {
    const { middlewareRequest, amount, bridgeRequest, toChainId } =
      MovrRouterInterface.parseTransaction({ data, value }).args[0]
    const { inputToken } = middlewareRequest
    const { inputToken: outputToken } = bridgeRequest
    return formatTx(currentNetwork.chainId, toChainId, inputToken, outputToken, amount)
  }
}

export default movrTxParser
