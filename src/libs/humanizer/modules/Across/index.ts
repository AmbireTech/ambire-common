import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { Across } from '../../const/abis'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import {
  getAction,
  getChain,
  getDeadline,
  getLabel,
  getRecipientText,
  getToken,
  getTokenWithChain
} from '../../utils'

const AcrossModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const iface = new Interface(Across)
  const matcher = {
    [iface.getFunction(
      'depositV3(address depositor,address recipient,address inputToken,address outputToken,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,address exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline,bytes calldata message)'
    )?.selector!]: (call: IrCall) => {
      const {
        recipient,
        inputToken,
        outputToken,
        inputAmount,
        outputAmount,
        destinationChainId,
        fillDeadline
      } = iface.parseTransaction(call)!.args
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
    [iface.getFunction(
      'deposit(address recipient,address originToken,uint256 amount,uint256 destinationChainId,int64 relayerFeePct,uint32 quoteTimestamp,bytes memory message,uint256 maxCount)'
    )?.selector!]: (call: IrCall) => {
      const { recipient, originToken, amount, destinationChainId } =
        iface.parseTransaction(call)!.args
      return [
        getAction('Bridge'),
        getToken(originToken, amount),
        getLabel('to'),
        getChain(destinationChainId),
        ...getRecipientText(accOp.accountAddr, recipient)
      ]
    },
    [iface.getFunction(
      'function deposit(address spokePool,address recipient, address originToken, uint256 amount, uint256 destinationChainId, int64 relayerFeePct, uint32 quoteTimestamp,bytes message, uint256 maxCount) payable'
    )?.selector!]: (call: IrCall) => {
      const { recipient, originToken, amount, destinationChainId } =
        iface.parseTransaction(call)!.args

      return [
        getAction('Bridge'),
        getToken(originToken, amount),
        getLabel('to'),
        getChain(destinationChainId),
        ...getRecipientText(accOp.accountAddr, recipient)
      ]
    }
  }
  const newCalls = calls.map((call) => {
    if (call.fullVisualization || !matcher[call.data.slice(0, 10)]) return call
    return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) }
  })

  return newCalls
}

export default AcrossModule
