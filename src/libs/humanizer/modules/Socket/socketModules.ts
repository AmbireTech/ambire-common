import { Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { SocketViaAcross } from '../../const/abis'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import {
  eToNative,
  getAction,
  getChain,
  getDeadline,
  getLabel,
  getRecipientText,
  getToken
} from '../../utils'

export const SocketModule: HumanizerCallModule = (accountOp: AccountOp, irCalls: IrCall[]) => {
  const iface = new Interface([
    ...SocketViaAcross,
    'function performAction(address fromToken, address toToken, uint256 amount, address receiverAddress, bytes32 metadata, bytes swapExtraData) payable returns (uint256)',
    'function performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData) payable returns (uint256, address)'
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
      if (swapData.startsWith('0xee8f0b86')) {
        const { fromToken, amount, toToken } = iface.parseTransaction({
          data: swapData
        })!.args
        return {
          ...call,
          fullVisualization: [
            getAction('Swap'),
            getToken(eToNative(fromToken), amount),
            getLabel('for'),
            getToken(eToNative(toToken), outputAmount),
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
          getToken(eToNative(outputToken), outputAmount),
          getLabel('on'),
          getChain(dstChain),
          getDeadline(quoteAndDeadlineTimeStamps[0]),
          ...getRecipientText(senderAddress, recipientAddress)
        ]
      }
    },
    [`${
      iface.getFunction(
        'bridgeNativeTo(uint256 amount, (address[] senderReceiverAddresses, address outputToken, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData)'
      )?.selector
    }`]: (call: IrCall): IrCall => {
      try {
        const [
          amount,
          [
            [sender, receiver],
            outputToken,
            [outputAmount, chainId],
            quoteAndDeadlineTimeStamps
            // @TODO
            // bridgeFee
          ]
        ] = iface.parseTransaction(call)!.args

        return {
          ...call,
          fullVisualization: [
            getAction('Bridge'),
            getToken(ZeroAddress, amount),
            getLabel('to'),
            getToken(outputToken, outputAmount),
            getLabel('on'),
            getChain(chainId),
            getDeadline(quoteAndDeadlineTimeStamps[0]),
            ...getRecipientText(sender, receiver)
          ]
        }
      } catch (e) {
        return { ...call }
      }
    },

    [`${
      iface.getFunction(
        'function performAction(address fromToken, address toToken, uint256 amount, address receiverAddress, bytes32 metadata, bytes swapExtraData)'
      )?.selector
    }`]: (call: IrCall): IrCall => {
      const { fromToken, toToken, amount, receiverAddress } = iface.parseTransaction(call)!.args
      return {
        ...call,
        fullVisualization: [
          getAction('Bridge'),
          getToken(eToNative(fromToken), 0n),
          getLabel('for'),
          getToken(eToNative(toToken), amount),
          ...getRecipientText(accountOp.accountAddr, receiverAddress)
        ]
      }
    },
    [`${
      iface.getFunction(
        'function performAction(address fromToken, address toToken, uint256 amount, address receiverAddress, bytes32 metadata, bytes swapExtraData)'
      )?.selector
    }`]: (call: IrCall): IrCall => {
      const { fromToken, toToken, amount, receiverAddress } = iface.parseTransaction(call)!.args
      return {
        ...call,
        fullVisualization: [
          getAction('Bridge'),
          getToken(eToNative(fromToken), 0n),
          getLabel('for'),
          getToken(eToNative(toToken), amount),
          ...getRecipientText(accountOp.accountAddr, receiverAddress)
        ]
      }
    },
    [`${
      iface.getFunction(
        'bridgeERC20To(uint256 amount, (address[] senderReceiverAddresses, address[] inputOutputTokens, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData)'
      )?.selector
    }`]: (call: IrCall): IrCall => {
      const {
        amount,
        acrossBridgeData: {
          senderReceiverAddresses: [sender, receiver],
          inputOutputTokens: [inputToken, outputToken],
          outputAmountToChainIdArray: [outputAmount, chainId]
        }
      } = iface.parseTransaction(call)!.args
      return {
        ...call,
        fullVisualization: [
          getAction('Bridge'),
          getToken(eToNative(inputToken), amount),
          getLabel('for'),
          getToken(eToNative(outputToken), outputAmount),
          getChain(chainId),
          ...getRecipientText(sender, receiver)
        ]
      }
    }
  }

  const newCalls: IrCall[] = irCalls.map((_call: IrCall) => {
    const call: IrCall = {
      ..._call,
      data: `0x${_call.data.slice(10)}`
    }
    console.log(_call.data)
    if (matcher[call.data.slice(0, 10)]) {
      return matcher[call.data.slice(0, 10)](call)
    }
    return call
  })
  return [newCalls, []]
  // return [accountOp.calls, []]
}
