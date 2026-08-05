import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import {
  HexIrCall,
  getAction,
  getChain,
  getDeadline,
  getLabel,
  getRecipientText,
  getToken,
  getTokenWithChain,
  isHexCall
} from '../../utils'

const depositV3Abi = parseAbi([
  'function depositV3(address depositor,address recipient,address inputToken,address outputToken,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,address exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline,bytes calldata message) payable'
])
const depositAbi = parseAbi([
  'function deposit(address recipient,address originToken,uint256 amount,uint256 destinationChainId,int64 relayerFeePct,uint32 quoteTimestamp,bytes memory message,uint256 maxCount) payable'
])
const depositWithSpokePoolAbi = parseAbi([
  'function deposit(address spokePool,address recipient,address originToken,uint256 amount,uint256 destinationChainId,int64 relayerFeePct,uint32 quoteTimestamp,bytes message,uint256 maxCount) payable'
])

const AcrossModule: HumanizerCallModule = (accOp: AccountOp, call: IrCall) => {
  const matcher: Record<string, (call: HexIrCall) => any> = {
    [toFunctionSelector(depositV3Abi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: depositV3Abi, data: call.data })
      const [
        ,
        recipient,
        inputToken,
        outputToken,
        inputAmount,
        outputAmount,
        destinationChainId,
        ,
        ,
        fillDeadline
      ] = args
      return [
        getAction('Bridge'),
        getToken(inputToken, inputAmount),
        getLabel('for'),
        getTokenWithChain(outputToken, outputAmount, destinationChainId),
        getLabel('to'),
        getChain(destinationChainId),
        getDeadline(fillDeadline),
        ...getRecipientText(accOp.accountAddr, recipient)
      ]
    },
    [toFunctionSelector(depositAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: depositAbi, data: call.data })
      const [recipient, originToken, amount, destinationChainId] = args
      return [
        getAction('Bridge'),
        getToken(originToken, amount),
        getLabel('to'),
        getChain(destinationChainId),
        ...getRecipientText(accOp.accountAddr, recipient)
      ]
    },
    [toFunctionSelector(depositWithSpokePoolAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: depositWithSpokePoolAbi, data: call.data })
      const [, recipient, originToken, amount, destinationChainId] = args

      return [
        getAction('Bridge'),
        getToken(originToken, amount),
        getLabel('to'),
        getChain(destinationChainId),
        ...getRecipientText(accOp.accountAddr, recipient)
      ]
    }
  }
  const selector = call.data.slice(0, 10)
  if (call.fullVisualization || !isHexCall(call) || !matcher[selector]) return call
  return { ...call, fullVisualization: matcher[selector](call) }
}

export default AcrossModule
