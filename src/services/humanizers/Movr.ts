// TODO: add types
// @ts-nocheck

import { Interface } from 'ethers/lib/utils'

import networks from '../../constants/networks'
import { HumanizerInfoType } from '../../hooks/useConstants'
import { formatNativeTokenAddress, nativeToken, token } from '../humanReadableTransactions'

const getNetwork = (chainId) => networks.find((n) => n.chainId === Number(chainId)).name
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`
const getTokenDetails = (humInfo, network, tokenAddress, amount, extended = false) =>
  tokenAddress === ZERO_ADDRESS
    ? nativeToken(network, amount, extended)
    : token(humInfo, tokenAddress, amount, extended)

const MovrMapping = (humanizerInfo: HumanizerInfoType) => {
  const MovrAnyswapInterface = new Interface(humanizerInfo.abis.MovrAnyswap)
  const MovrRouterInterface = new Interface(humanizerInfo.abis.MovrRouter)

  return {
    [MovrAnyswapInterface.getSighash('outboundTransferTo')]: (txn, network) => {
      const { middlewareInputToken, amount, tokenToBridge, toChainId } =
        MovrAnyswapInterface.parseTransaction(txn).args[0]
      return [
        `Transfer ${token(humanizerInfo, middlewareInputToken, amount)} to ${getNetwork(
          toChainId
        )} for ${token(humanizerInfo, tokenToBridge, null)}`
      ]
    },
    [MovrRouterInterface.getSighash('outboundTransferTo')]: (txn, network) => {
      const { middlewareRequest, amount, bridgeRequest, toChainId } =
        MovrRouterInterface.parseTransaction(txn).args[0]
      const { inputToken } = middlewareRequest
      const { inputToken: outputToken } = bridgeRequest
      return [
        `Transfer ${getTokenDetails(
          humanizerInfo,
          network,
          formatNativeTokenAddress(inputToken),
          amount
        )} to ${getNetwork(toChainId)} for ${getTokenDetails(
          humanizerInfo,
          network,
          formatNativeTokenAddress(outputToken),
          null
        )}`
      ]
    }
  }
}
export default MovrMapping
