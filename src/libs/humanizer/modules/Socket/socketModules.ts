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
    'function bridgeERC20To(uint256 amount, (uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address token, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)',
    'function transformERC20(address,address,uint256,uint256,(uint32,bytes)[])',
    'function bridgeNativeTo(address receiverAddress, address customBridgeAddress, uint32 l2Gas, uint256 amount, bytes32 metadata, bytes data)',
    'function bridgeNativeTo(uint256 amount, bytes32 metadata, address receiverAddress, uint256 toChainId, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) originQuery, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) destinationQuery) payable',
    'function swapAndBridge(uint32 swapId, bytes swapData, tuple(uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)'
  ])
  const matcher = {
    [`${
      iface.getFunction(
        'swapAndBridge(uint32 swapId, bytes swapData, tuple(address[] senderReceiverAddresses,address outputToken,uint256[] outputAmountToChainIdArray,uint32[] quoteAndDeadlineTimeStamps,uint256 bridgeFee,bytes32 metadata) acrossBridgeData)'
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
            getLabel('to'),
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
          getLabel('to'),
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
            getToken(eToNative(outputToken), outputAmount),
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
        'performAction(address fromToken, address toToken, uint256 amount, address receiverAddress, bytes32 metadata, bytes swapExtraData)'
      )?.selector
    }`]: (call: IrCall): IrCall => {
      const { fromToken, toToken, amount, receiverAddress, swapExtraData, metadata } =
        iface.parseTransaction(call)!.args
      let outAmount = 0n
      if (swapExtraData.startsWith('0x415565b0'))
        outAmount = iface.parseTransaction({ data: swapExtraData })!.args[3]

      return {
        ...call,
        fullVisualization: [
          getAction('Swap'),
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
          getLabel('to'),
          getToken(eToNative(outputToken), outputAmount),
          getLabel('on'),
          getChain(chainId),
          ...getRecipientText(sender, receiver)
        ]
      }
    },
    [`${
      iface.getFunction(
        'bridgeNativeTo(uint256 amount, bytes32 metadata, address receiverAddress, uint256 toChainId, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) originQuery, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) destinationQuery)'
      )?.selector
    }`]: (call: IrCall): IrCall => {
      const {
        amount,
        metadata,
        receiverAddress,
        toChainId,
        originQuery: { tokenOut, minAmountOut, deadline },
        destinationQuery // : { swapAdapter, tokenOut, minAmountOut, deadline, rawParams }
      } = iface.parseTransaction(call)!.args
      return {
        ...call,
        fullVisualization: [
          getAction('Bridge'),
          // amount > min amount out
          // the tx consumes amount and not displayed minAmountOut
          getToken(eToNative(tokenOut), amount),
          getLabel('to'),
          getToken(eToNative(destinationQuery.tokenOut), destinationQuery.minAmountOut),
          getLabel('on'),
          getChain(toChainId),
          getDeadline(deadline),
          ...getRecipientText(accountOp.accountAddr, receiverAddress)
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
          getLabel('to'),
          getToken(eToNative(token), BigInt(amount - fee)),
          getLabel('on'),
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
      // @TODO
      return {
        ...call,
        fullVisualization: [
          getAction('Bridge'),
          getToken(ZeroAddress, amount),
          ...getRecipientText(accountOp.accountAddr, receiverAddress)
        ]
      }
    },
    [`${
      iface.getFunction(
        'swapAndBridge(uint32 swapId, bytes swapData, tuple(uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)'
      )?.selector
    }`]: (call: IrCall): IrCall => {
      const {
        swapData,
        connextBridgeData: {
          chainId,
          slippage,
          relayerFee,
          dstChainDomain,
          receiverAddress,
          metadata,
          callData,
          delegate
        }
      } = iface.parseTransaction(call)!.args
      if (swapData.startsWith('0xee8f0b86')) {
        const { fromToken, toToken, amount, swapExtraData } = iface.parseTransaction({
          data: swapData
        })!.args

        let outAmount = 0n
        if (swapExtraData.startsWith('0x415565b0'))
          outAmount = iface.parseTransaction({ data: swapExtraData })!.args[3]

        return {
          ...call,
          fullVisualization: [
            getAction('Bridge'),
            getToken(eToNative(fromToken), amount),
            getLabel('to'),
            getToken(eToNative(toToken), outAmount),
            ...(chainId ? [getLabel('on'), getChain(chainId)] : []),
            ...getRecipientText(accountOp.accountAddr, receiverAddress)
          ].filter((x) => x)
        }
      }
      return {
        ...call,
        fullVisualization: [
          getAction('Bridge'),
          getLabel('undetected token'),
          getLabel('to'),
          getLabel('undetected token'),
          ...(chainId ? [getLabel('on'), getChain(chainId)] : []),
          ...getRecipientText(accountOp.accountAddr, receiverAddress)
        ].filter((x) => x)
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
}
