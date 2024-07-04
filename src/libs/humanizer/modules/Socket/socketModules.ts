/* eslint-disable @typescript-eslint/no-unused-vars */
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

// @TODO check all additional data provided
// @TODO consider fees everywhere
export const SocketModule: HumanizerCallModule = (accountOp: AccountOp, irCalls: IrCall[]) => {
  const iface = new Interface([
    ...SocketViaAcross,
    'function performAction(address fromToken, address toToken, uint256 amount, address receiverAddress, bytes32 metadata, bytes swapExtraData) payable returns (uint256)',
    'function performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData) payable returns (uint256, address)',
    'function bridgeERC20To(uint256,bytes32,address,address,uint256,uint32,uint256)',
    'function transformERC20(address,address,uint256,uint256,(uint32,bytes)[])',
    'function bridgeNativeTo(address receiverAddress, address customBridgeAddress, uint32 l2Gas, uint256 amount, bytes32 metadata, bytes data)'
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
            getAction('Bridge'),
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
          getAction('Bridge'),
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
      const { fromToken, toToken, amount, receiverAddress, swapExtraData } =
        iface.parseTransaction(call)!.args
      // @TODO fees
      // http://localhost:19006/?networkId=polygon&txnId=0x42ebe28c1c02a6c98ad458e15f3fdff90d531d0c2b2fddfeeac46dcda7e421ba
      let outAmount = 0n
      if (swapExtraData.startsWith('0x415565b0'))
        outAmount = iface.parseTransaction({ data: swapExtraData })!.args[3]

      return {
        ...call,
        fullVisualization: [
          getAction('Bridge'),
          getToken(eToNative(fromToken), amount),
          getLabel('for'),
          getToken(eToNative(toToken), outAmount),
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
    },
    [`${
      iface.getFunction('bridgeERC20To(uint256,bytes32,address,address,uint256,uint32,uint256)')
        ?.selector
    }`]: (call: IrCall): IrCall => {
      const [amount, id, recipient, token, chainId, unknown1, fee] =
        iface.parseTransaction(call)!.args
      return {
        ...call,
        fullVisualization: [
          getAction('Bridge'),
          getToken(eToNative(token), amount),
          getLabel('for'),
          getToken(token, BigInt(amount - fee)),
          getLabel('to'),
          getChain(chainId),
          ...getRecipientText(accountOp.accountAddr, recipient)
        ]
      }
    },
    [`${
      iface.getFunction(
        'bridgeNativeTo(address receiverAddress, address customBridgeAddress, uint32 l2Gas, uint256 amount, bytes32 metadata, bytes data)'
      )?.selector
    }`]: (call: IrCall): IrCall => {
      const { receiverAddress, customBridgeAddress, l2Gas, amount, metadata, data } =
        iface.parseTransaction(call)!.args
      return {
        ...call,
        fullVisualization: [
          getAction('Bridge'),
          getToken(ZeroAddress, amount),
          ...getRecipientText(accountOp.accountAddr, receiverAddress)
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
      return {
        ..._call,
        fullVisualization: matcher[call.data.slice(0, 10)](call).fullVisualization
      }
    }
    return _call
  })
  return [newCalls, []]
  // return [accountOp.calls, []]
}
