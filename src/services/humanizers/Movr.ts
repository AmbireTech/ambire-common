// TODO: add types
// @ts-nocheck

import { Interface } from 'ethers/lib/utils'

import networks from '../../constants/networks'
import { HumanizerInfoType } from '../../hooks/useConstants'
import { formatNativeTokenAddress, token } from '../humanReadableTransactions'

const getNetwork = (chainId) => networks.find((n) => n.chainId === Number(chainId)).name

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
        )} for ${token(humanizerInfo, tokenToBridge)}`
      ]
    },
    [MovrRouterInterface.getSighash('outboundTransferTo')]: (txn, network) => {
      const { middlewareRequest, amount, bridgeRequest, toChainId } =
        MovrRouterInterface.parseTransaction(txn).args[0]
      const { inputToken } = middlewareRequest
      const { inputToken: outputToken } = bridgeRequest
      return [
        `Transfer ${token(
          humanizerInfo,
          formatNativeTokenAddress(inputToken),
          amount
        )} to ${getNetwork(toChainId)} for ${token(
          humanizerInfo,
          formatNativeTokenAddress(outputToken)
        )}`
      ]
    }
  }
}
export default MovrMapping
