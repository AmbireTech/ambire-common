import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { SocketViaAcross } from '../../const/abis'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getChain, getDeadline, getLabel, getRecipientText, getToken } from '../../utils'

export const SocketModule: HumanizerCallModule = (accountOp: AccountOp, irCalls: IrCall[]) => {
  const iface = new Interface([
    ...SocketViaAcross,
    'function performActionWithIn(address inputToken, address outputToken, uint256 inputAmount, bytes32 extraData1,bytes extraData2)'
  ])
  const matcher = {
    [`${
      iface.getFunction(
        'swapAndBridge(uint32 swapId,bytes swapData,tuple(address[] senderReceiverAddresses,address outputToken,uint256[] outputAmountToChainIdArray,uint32[] quoteAndDeadlineTimeStamps,uint256 bridgeFee,bytes32 metadata) acrossBridgeData)'
      )?.selector
    }`]: (call: IrCall): IrCall => {
      const {
        // swapId,
        swapData,
        acrossBridgeData: {
          senderReceiverAddresses: [senderAddress, recipientAddress],
          outputToken,
          outputAmountToChainIdArray: [outputAmount, dstChain],
          quoteAndDeadlineTimeStamps
          // bridgeFee,
          // metadata
        }
      } = iface.parseTransaction(call)!.args

      if (swapData.startsWith('0x0xee8f0b86')) {
        const { inputToken, inputAmount } = iface.parseTransaction({
          data: swapData
        })!.args
        return {
          ...call,
          fullVisualization: [
            getAction('Swap'),
            getToken(inputToken, inputAmount),
            getLabel('for'),
            getToken(outputToken, outputAmount),
            getLabel('on'),
            getChain(dstChain),
            getDeadline(quoteAndDeadlineTimeStamps[0]),
            ...getRecipientText(senderAddress, recipientAddress)
          ]
        }
      }
      return {
        ...call,
        fullVisualization: [
          getAction('Swap'),
          getLabel('undetected token'),
          getLabel('for'),
          getToken(outputToken, outputAmount),
          getLabel('on'),
          getChain(dstChain),
          getDeadline(quoteAndDeadlineTimeStamps[0]),
          ...getRecipientText(senderAddress, recipientAddress)
        ]
      }
    }
  }

  const newCalls: IrCall[] = irCalls.map((_call: IrCall) => {
    const call: IrCall = {
      ..._call,
      data: `0x${_call.data.slice(10)}`
    }
    if (matcher[call.data.slice(0, 10)]) {
      return matcher[call.data.slice(0, 10)](call)
    }
    return call
  })
  return [newCalls, []]
  // return [accountOp.calls, []]
}
