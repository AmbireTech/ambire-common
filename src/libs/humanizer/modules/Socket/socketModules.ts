/* eslint-disable @typescript-eslint/no-unused-vars */
import { AbiCoder, Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { SocketViaAcross } from '../../const/abis'
import { HumanizerCallModule, HumanizerVisualization, IrCall } from '../../interfaces'
import {
  eToNative,
  getAction,
  getAddressVisualization,
  getChain,
  getDeadline,
  getLabel,
  getRecipientText,
  getToken,
  getTokenWithChain
} from '../../utils'

// taken from https://stargateprotocol.gitbook.io/stargate/developers/chain-ids
const STARGATE_CHAIN_IDS: { [key: string]: bigint } = {
  '101': 1n,
  '102': 56n,
  '106': 43114n,
  '109': 137n,
  '110': 42161n,
  '111': 10n,
  '112': 250n,
  '151': 1088n,
  '184': 8453n,
  '183': 59144n,
  '177': 2222n,
  '181': 5000n
}
// @TODO check all additional data provided
// @TODO consider fees everywhere
// @TODO add automated tests
export const SocketModule: HumanizerCallModule = (accountOp: AccountOp, irCalls: IrCall[]) => {
  const preControllerIface = new Interface([
    'function executeController((uint32 controllerId, bytes data) socketControllerRequest)',
    'function takeFeesAndSwap((address feesTakerAddress, address feesToken, uint256 feesAmount, uint32 routeId, bytes swapRequestData) ftsRequest) payable returns (bytes)',
    'function takeFeesAndBridge((address feesTakerAddress, address feesToken, uint256 feesAmount, uint32 routeId, bytes bridgeRequestData) ftbRequest) payable returns (bytes)',
    // @TODO
    'function takeFeeAndSwapAndBridge((address feesTakerAddress, address feesToken, uint256 feesAmount, uint32 swapRouteId, bytes swapData, uint32 bridgeRouteId, bytes bridgeData) fsbRequest)'
  ])
  const iface = new Interface([
    ...SocketViaAcross,
    // @TODO move to more appropriate place all funcs
    'function performAction(address fromToken, address toToken, uint256 amount, address receiverAddress, bytes32 metadata, bytes swapExtraData) payable returns (uint256)',
    'function performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData) payable returns (uint256, address)',
    'function bridgeERC20To(uint256,bytes32,address,address,uint256,uint32,uint256)',
    'function bridgeERC20To(uint256 amount, (uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address token, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)',
    'function transformERC20(address inputToken, address outputToken, uint256 inputTokenAmount, uint256 minOutputTokenAmount, (uint32,bytes)[] transformations)',
    'function swap(address,(address,address,address,address,uint256,uint256,uint256),bytes,bytes)',
    'function swap(address caller, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 guaranteedAmount, uint256 flags, address referrer, bytes permit) desc, (uint256 target, uint256 gasLimit, uint256 value, bytes data)[] calls) payable returns (uint256 returnAmount)',
    'function exec(address,address,uint256,address,bytes)',
    'function execute((address recipient, address buyToken, uint256 minAmountOut) slippage, bytes[] actions, bytes32) payable returns (bool)',
    'function uniswapV3SwapTo(address,uint256,uint256,uint256[])',
    'function BASIC(address,uint256,address,uint256,bytes)',
    'function UNISWAPV3(address,uint256,bytes,uint256)'
  ])
  const matcher: { [sighash: string]: (irCall: IrCall) => HumanizerVisualization[] } = {
    [`${
      iface.getFunction(
        'swapAndBridge(uint32 swapId, bytes swapData, tuple(address[] senderReceiverAddresses,address outputToken,uint256[] outputAmountToChainIdArray,uint32[] quoteAndDeadlineTimeStamps,uint256 bridgeFee,bytes32 metadata) acrossBridgeData)'
      )?.selector
    }`]: (call: IrCall) => {
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
      if (
        swapData.startsWith(
          iface.getFunction(
            'performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData)'
          )?.selector
        )
      ) {
        const { fromToken, amount, toToken } = iface.parseTransaction({
          data: swapData
        })!.args
        return [
          getAction('Bridge'),
          getToken(eToNative(fromToken), amount),
          getLabel('to'),
          getTokenWithChain(eToNative(toToken), outputAmount),
          getLabel('on'),
          getChain(dstChain),
          getDeadline(quoteAndDeadlineTimeStamps[1]),
          ...getRecipientText(senderAddress, recipientAddress)
        ]
      }
      return [
        getAction('Bridge'),
        getLabel('undetected token'),
        getLabel('to'),
        getTokenWithChain(eToNative(outputToken), outputAmount, dstChain),
        getLabel('on'),
        getChain(dstChain),
        getDeadline(quoteAndDeadlineTimeStamps[1]),
        ...getRecipientText(senderAddress, recipientAddress)
      ]
    },
    [`${
      iface.getFunction(
        'swapAndBridge(uint32 swapId, bytes swapData, (address receiverAddress, uint64 toChainId, uint32 maxSlippage, uint64 nonce, bytes32 metadata) celerBridgeData) payable'
      )?.selector
    }`]: (call: IrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in socket humanizer when !call.to')
      const {
        swapId,
        swapData,
        celerBridgeData: { receiverAddress, toChainId, maxSlippage, nonce, metadata }
      } = iface.parseTransaction(call)!.args
      if (
        swapData.startsWith(
          iface.getFunction(
            'performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData)'
          )?.selector
        )
      ) {
        const { fromToken, amount, toToken } = iface.parseTransaction({
          data: swapData
        })!.args
        return [
          getAction('Bridge'),
          getToken(eToNative(fromToken), amount),
          getLabel('to'),
          getTokenWithChain(eToNative(toToken), 0n),
          getLabel('on'),
          getChain(toChainId),
          ...getRecipientText(accountOp.accountAddr, receiverAddress)
        ]
      }
      return [
        getAction('Bridge'),
        getLabel('via'),
        getAddressVisualization(call.to),
        getLabel('to'),
        getChain(toChainId)
      ]
    },
    [`${iface.getFunction('swapAndBridge(uint32,address,uint256,bytes32,bytes)')?.selector}`]: (
      call: IrCall
    ) => {
      const [, , chainId, , data] = iface.parseTransaction(call)!.args
      if (data.startsWith(iface.getFunction('performActionWithIn')!.selector)) {
        const { fromToken, toToken, amount, swapExtraData } = iface.parseTransaction({
          ...call,
          data
        })!.args
        if (swapExtraData.startsWith(iface.getFunction('transformERC20')!.selector)) {
          const { minOutputTokenAmount } = iface.parseTransaction({
            ...call,
            data: swapExtraData
          })!.args

          return [
            getAction('Bridge'),
            getToken(fromToken, amount),
            getLabel('to'),
            getToken(toToken, minOutputTokenAmount, false, chainId),
            getLabel('on'),
            getChain(chainId)
          ]
        }
        return [
          getAction('Bridge'),
          getToken(fromToken, amount),
          getLabel('to'),
          getToken(toToken, 0n, false, chainId),
          getLabel('on'),
          getChain(chainId)
        ]
      }
      return [getAction('Bridge'), getLabel('to'), getChain(chainId)]
    },
    [`${
      iface.getFunction(
        'bridgeNativeTo(uint256 amount, (address[] senderReceiverAddresses, address outputToken, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData)'
      )?.selector
    }`]: (call: IrCall) => {
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

      return [
        getAction('Bridge'),
        getToken(ZeroAddress, amount),
        getLabel('to'),
        getTokenWithChain(eToNative(outputToken), outputAmount, chainId),
        getLabel('on'),
        getChain(chainId),
        getDeadline(quoteAndDeadlineTimeStamps[1]),
        ...getRecipientText(sender, receiver)
      ]
    },
    [`${
      iface.getFunction(
        'bridgeNativeTo(address senderAddress, address receiverAddress, uint256 amount, (uint256 srcPoolId, uint256 dstPoolId, uint256 destinationGasLimit, uint256 minReceivedAmt, uint256 value, uint16 stargateDstChainId, uint32 swapId, bytes32 metadata, bytes swapData, bytes destinationPayload) stargateBridgeExtraData)'
      )?.selector
    }`]: (call: IrCall) => {
      const {
        senderAddress,
        receiverAddress,
        amount,
        stargateBridgeExtraData: { minReceivedAmt, stargateDstChainId }
      } = iface.parseTransaction(call)!.args
      const chainId = STARGATE_CHAIN_IDS[stargateDstChainId.toString()]
      return [
        getAction('Bridge'),
        getToken(ZeroAddress, amount),
        getLabel('to'),
        getTokenWithChain(ZeroAddress, minReceivedAmt),
        getLabel('on'),
        getChain(chainId),
        ...getRecipientText(senderAddress, receiverAddress)
      ]
    },
    [`${
      iface.getFunction(
        'performAction(address fromToken, address toToken, uint256 amount, address receiverAddress, bytes32 metadata, bytes swapExtraData)'
      )?.selector
    }`]: (call: IrCall) => {
      // eslint-disable-next-line prefer-const
      let { fromToken, toToken, amount, receiverAddress, swapExtraData, metadata } =
        iface.parseTransaction(call)!.args
      let outAmount = 0n
      if (
        swapExtraData.startsWith(
          iface.getFunction(
            'performAction(address fromToken, address toToken, uint256 amount, address receiverAddress, bytes32 metadata, bytes swapExtraData)'
          )?.selector
        )
      ) {
        outAmount = iface.parseTransaction({ data: swapExtraData })!.args[3]
      } else if (
        swapExtraData.startsWith(
          iface.getFunction(
            'swap(address,(address,address,address,address,uint256,uint256,uint256),bytes,bytes)'
          )?.selector
        )
      ) {
        const [
          randAddress,
          [token1, token2, randAddress2, recipient, amount1, amount2],
          bytes1,
          bytes2
        ] = iface.parseTransaction({ data: swapExtraData })!.args
        outAmount = amount2
      } else if (
        swapExtraData.startsWith(
          iface.getFunction('transformERC20(address,address,uint256,uint256,(uint32,bytes)[])')!
            .selector
        )
      ) {
        const params = iface.parseTransaction({ data: swapExtraData })!.args
        outAmount = params[3]
      } else if (swapExtraData.startsWith(iface.getFunction('exec')?.selector)) {
        const [, , , , extraData] = iface.parseTransaction({
          data: swapExtraData
        })!.args
        if (extraData.startsWith(iface.getFunction('execute')?.selector)) {
          // eslint-disable-next-line prefer-const
          let [[, , minAmountOut], actions] = iface.parseTransaction({
            data: extraData
          })!.args
          if (!minAmountOut) {
            const uniswapData = actions.find((i: any) =>
              i.startsWith(iface.getFunction('UNISWAPV3')?.selector)
            )
            if (uniswapData) {
              ;[, , , minAmountOut] = iface.parseTransaction({ data: uniswapData })!.args
            }
          }
          outAmount = minAmountOut
        }
      } else if (swapExtraData.startsWith(iface.getFunction('uniswapV3SwapTo')?.selector)) {
        const [address, amount1, amount2] = iface.parseTransaction({
          data: swapExtraData
        })!.args
        outAmount = amount2
      } else if (
        swapExtraData.startsWith(
          iface.getFunction(
            'function swap(address caller, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 guaranteedAmount, uint256 flags, address referrer, bytes permit) desc, (uint256 target, uint256 gasLimit, uint256 value, bytes data)[] calls)'
          )?.selector
        )
      ) {
        const {
          // caller,
          desc: {
            // srcToken,
            // dstToken,
            // srcReceiver,
            // dstReceiver,
            // amount: _amount,
            minReturnAmount
            // guaranteedAmount,
            // flags,
            // referrer,
            // permit
          }
        } = iface.parseTransaction({
          data: swapExtraData
        })!.args
        outAmount = minReturnAmount
      }
      return [
        getAction('Swap'),
        getToken(eToNative(fromToken), amount),
        getLabel(outAmount ? 'for at least' : 'for'),
        getToken(eToNative(toToken), outAmount),
        ...getRecipientText(accountOp.accountAddr, receiverAddress)
      ]
    },
    [`${
      iface.getFunction(
        'performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData)'
      )?.selector
    }`]: (call: IrCall) => {
      // eslint-disable-next-line prefer-const
      let { fromToken, toToken, amount, metadata, swapExtraData } =
        iface.parseTransaction(call)!.args
      let outAmount = 0n
      if (
        swapExtraData.startsWith(
          iface.getFunction(
            'performAction(address fromToken, address toToken, uint256 amount, address receiverAddress, bytes32 metadata, bytes swapExtraData)'
          )?.selector
        )
      ) {
        outAmount = iface.parseTransaction({ data: swapExtraData })!.args[3]
      } else if (
        swapExtraData.startsWith(
          iface.getFunction(
            'swap(address,(address,address,address,address,uint256,uint256,uint256),bytes,bytes)'
          )?.selector
        )
      ) {
        const [
          randAddress,
          [token1, token2, randAddress2, recipient, amount1, amount2],
          bytes1,
          bytes2
        ] = iface.parseTransaction({ data: swapExtraData })!.args
        outAmount = amount2
      } else if (
        swapExtraData.startsWith(
          iface.getFunction('transformERC20(address,address,uint256,uint256,(uint32,bytes)[])')!
            .selector
        )
      ) {
        const params = iface.parseTransaction({ data: swapExtraData })!.args
        outAmount = params[3]
      } else if (swapExtraData.startsWith(iface.getFunction('exec')?.selector)) {
        const [, , , , extraData] = iface.parseTransaction({
          data: swapExtraData
        })!.args
        if (extraData.startsWith(iface.getFunction('execute')?.selector)) {
          // eslint-disable-next-line prefer-const
          let [[, , minAmountOut], actions] = iface.parseTransaction({
            data: extraData
          })!.args
          if (!minAmountOut) {
            const uniswapData = actions.find((i: any) =>
              i.startsWith(iface.getFunction('UNISWAPV3')?.selector)
            )
            if (uniswapData) {
              ;[, , , minAmountOut] = iface.parseTransaction({ data: uniswapData })!.args
            }
          }
          outAmount = minAmountOut
        }
      } else if (swapExtraData.startsWith(iface.getFunction('uniswapV3SwapTo')?.selector)) {
        const [address, amount1, amount2] = iface.parseTransaction({
          data: swapExtraData
        })!.args
        outAmount = amount2
      } else if (
        swapExtraData.startsWith(
          iface.getFunction(
            'function swap(address caller, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 guaranteedAmount, uint256 flags, address referrer, bytes permit) desc, (uint256 target, uint256 gasLimit, uint256 value, bytes data)[] calls)'
          )?.selector
        )
      ) {
        const {
          // caller,
          desc: {
            // srcToken,
            // dstToken,
            // srcReceiver,
            // dstReceiver,
            // amount: _amount,
            minReturnAmount
            // guaranteedAmount,
            // flags,
            // referrer,
            // permit
          }
        } = iface.parseTransaction({
          data: swapExtraData
        })!.args
        outAmount = minReturnAmount
      }
      return [
        getAction('Swap'),
        getToken(eToNative(fromToken), amount),
        getLabel(outAmount ? 'for at least' : 'for'),
        getToken(eToNative(toToken), outAmount)
      ]
    },
    [`${
      iface.getFunction(
        'bridgeERC20To(uint256 amount, (address[] senderReceiverAddresses, address[] inputOutputTokens, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData)'
      )?.selector
    }`]: (call: IrCall) => {
      const {
        amount,
        acrossBridgeData: {
          senderReceiverAddresses: [sender, receiver],
          inputOutputTokens: [inputToken, outputToken],
          outputAmountToChainIdArray: [outputAmount, chainId]
        }
      } = iface.parseTransaction(call)!.args
      return [
        getAction('Bridge'),
        getToken(eToNative(inputToken), amount),
        getLabel('to'),
        getTokenWithChain(eToNative(outputToken), outputAmount, chainId),
        getLabel('on'),
        getChain(chainId),
        ...getRecipientText(sender, receiver)
      ]
    },
    [`${
      iface.getFunction(
        'bridgeERC20To(uint256 amount, (uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address token, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)'
      )?.selector
    }`]: (call: IrCall) => {
      const {
        amount,
        connextBridgeData: {
          toChainId,
          dstChainDomain,
          token,
          receiverAddress,
          metadata,
          callData,
          delegate
        }
      } = iface.parseTransaction(call)!.args
      return [
        getAction('Bridge'),
        getToken(eToNative(token), amount),
        getLabel('to'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiverAddress)
      ]
    },
    [`${
      iface.getFunction(
        'bridgeNativeTo(uint256 amount, bytes32 metadata, address receiverAddress, uint256 toChainId, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) originQuery, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) destinationQuery)'
      )?.selector
    }`]: (call: IrCall) => {
      const {
        amount,
        metadata,
        receiverAddress,
        toChainId,
        originQuery: { tokenOut, minAmountOut, deadline },
        destinationQuery // : { swapAdapter, tokenOut, minAmountOut, deadline, rawParams }
      } = iface.parseTransaction(call)!.args
      return [
        getAction('Bridge'),
        getToken(eToNative(tokenOut), amount),
        getLabel('to'),
        getTokenWithChain(
          eToNative(destinationQuery.tokenOut),
          destinationQuery.minAmountOut,
          toChainId
        ),
        getLabel('on'),
        getChain(toChainId),
        getDeadline(deadline),
        ...getRecipientText(accountOp.accountAddr, receiverAddress)
      ]
    },
    [`${
      iface.getFunction('bridgeERC20To(uint256,bytes32,address,address,uint256,uint32,uint256)')
        ?.selector
    }`]: (call: IrCall) => {
      const [amount, id, recipient, token, chainId, unknown1, fee] =
        iface.parseTransaction(call)!.args
      return [
        getAction('Bridge'),
        getToken(eToNative(token), amount),
        getLabel('to'),
        getToken(eToNative(token), amount),
        getLabel('on'),
        getChain(chainId),
        ...getRecipientText(accountOp.accountAddr, recipient)
      ]
    },
    [`${
      iface.getFunction(
        'bridgeNativeTo(address receiverAddress, address customBridgeAddress, uint32 l2Gas, uint256 amount, bytes32 metadata, bytes data)'
      )?.selector
    }`]: (call: IrCall) => {
      const { receiverAddress, customBridgeAddress, l2Gas, amount, metadata, data } =
        iface.parseTransaction(call)!.args
      // @TODO
      return [
        getAction('Bridge'),
        getToken(ZeroAddress, amount),
        getLabel('via'),
        getAddressVisualization(customBridgeAddress),
        ...getRecipientText(accountOp.accountAddr, receiverAddress)
      ]
    },
    [`${
      iface.getFunction(
        'bridgeNativeTo(address receiverAddress, uint32 l2Gas, uint256 amount, uint256 toChainId, bytes32 metadata, bytes32 bridgeHash, bytes data)'
      )?.selector
    }`]: (call: IrCall) => {
      const { receiverAddress, l2Gas, amount, toChainId, metadata, bridgeHash, data } =
        iface.parseTransaction(call)!.args
      return [
        getAction('Bridge'),
        getToken(ZeroAddress, amount),
        getLabel('to'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiverAddress)
      ]
    },
    [`${
      iface.getFunction(
        'bridgeNativeTo(address receiverAddress, uint256 gasLimit, uint256 fees, bytes32 metadata, uint256 amount, uint256 toChainId, bytes32 bridgeHash)'
      )?.selector
    }`]: (call: IrCall) => {
      const { receiverAddress, gasLimit, fees, metadata, amount, toChainId, bridgeHash } =
        iface.parseTransaction(call)!.args
      return [
        getAction('Bridge'),
        getToken(ZeroAddress, amount),
        getLabel('to'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiverAddress)
      ]
    },
    [`${
      iface.getFunction(
        'bridgeNativeTo(address receiverAddress, address l1bridgeAddr, address relayer, uint256 toChainId, uint256 amount, uint256 amountOutMin, uint256 relayerFee, uint256 deadline, bytes32 metadata) payable'
      )?.selector
    }`]: (call: IrCall) => {
      const {
        receiverAddress,
        l1bridgeAddr,
        toChainId,
        amount,
        amountOutMin,
        relayerFee,
        deadline,
        metadata
      } = iface.parseTransaction(call)!.args
      return [
        getAction('Bridge'),
        getToken(ZeroAddress, amount),
        getLabel('to'),
        getToken(ZeroAddress, amountOutMin),
        getLabel('on'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiverAddress),
        getDeadline(deadline)
      ]
    },
    [`${iface.getFunction('bridgeNativeTo(uint256,address,uint256,bytes32)')?.selector}`]: (
      call: IrCall
    ) => {
      const [amount, recipient, chainId, metadata] = iface.parseTransaction(call)!.args
      return [
        getAction('Bridge'),
        getToken(ZeroAddress, amount),
        getLabel('to'),
        getChain(chainId),
        ...getRecipientText(accountOp.accountAddr, recipient)
      ]
    },
    [`${
      iface.getFunction(
        'function bridgeNativeTo(address receiverAddress, address hopAMM, uint256 amount, uint256 toChainId, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 amountOutMinDestination, uint256 deadlineDestination, bytes32 metadata) payable'
      )?.selector
    }`]: (call: IrCall) => {
      const {
        receiverAddress,
        hopAMM,
        amount,
        toChainId,
        bonderFee,
        amountOutMin,
        deadline,
        amountOutMinDestination,
        deadlineDestination,
        metadata
      } = iface.parseTransaction(call)!.args
      return [
        getAction('Bridge'),
        getToken(ZeroAddress, amount),
        getLabel('to'),
        getToken(ZeroAddress, amountOutMin),
        getLabel('on'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiverAddress),
        getDeadline(deadline)
      ]
    },
    [`${
      iface.getFunction(
        'function bridgeNativeTo(uint256 amount, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable'
      )?.selector
    }`]: (call: IrCall) => {
      const {
        amount,
        stargateBridgeData: {
          dstEid,
          minAmountLD,
          stargatePoolAddress,
          destinationPayload,
          destinationExtraOptions,
          messagingFee: { nativeFee, lzTokenFee },
          metadata,
          toChainId,
          receiver,
          swapData,
          swapId,
          isNativeSwapRequired
        }
      } = iface.parseTransaction(call)!.args
      return [
        getAction('Bridge'),
        getToken(ZeroAddress, amount),
        getLabel('to'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiver)
      ]
    },

    [`${
      iface.getFunction(
        'swapAndBridge(uint32 swapId, bytes swapData, tuple(uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)'
      )?.selector
    }`]: (call: IrCall) => {
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
      if (
        swapData.startsWith(
          iface.getFunction(
            'performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData)'
          )?.selector
        )
      ) {
        const { fromToken, toToken, amount, swapExtraData } = iface.parseTransaction({
          data: swapData
        })!.args
        let outAmount = 0n
        // @TODO no harcoded sighashes
        if (swapExtraData.startsWith('0x415565b0'))
          outAmount = iface.parseTransaction({ data: swapExtraData })!.args[3]

        return [
          getAction('Bridge'),
          getToken(eToNative(fromToken), amount),
          getLabel('to'),

          ...(chainId
            ? [
                getTokenWithChain(eToNative(toToken), outAmount, chainId),
                getLabel('on'),
                getChain(chainId)
              ]
            : [getToken(eToNative(toToken), outAmount)]),
          ...getRecipientText(accountOp.accountAddr, receiverAddress)
        ].filter((x) => x)
      }
      return [
        getAction('Bridge'),
        getLabel('undetected token'),
        getLabel('to'),
        getLabel('undetected token'),
        ...(chainId ? [getLabel('on'), getChain(chainId)] : []),
        ...getRecipientText(accountOp.accountAddr, receiverAddress)
      ].filter((x) => x)
    },
    [`${
      iface.getFunction(
        'swapAndBridge(uint32 swapId, bytes calldata swapData, tuple (address receiverAddress,address senderAddress,uint256 value,uint256 srcPoolId,uint256 dstPoolId,uint256 minReceivedAmt,uint256 destinationGasLimit,bool isNativeSwapRequired,uint16 stargateDstChainId,uint32 swapId,bytes swapData,bytes32 metadata,bytes destinationPayload) acrossBridgeData)'
      )?.selector
    }`]: (call: IrCall) => {
      const {
        swapId,
        swapData,
        acrossBridgeData: {
          receiverAddress,
          senderAddress,
          value,
          srcPoolId,
          dstPoolId,
          minReceivedAmt,
          destinationGasLimit,
          isNativeSwapRequired,
          stargateDstChainId,
          swapId: innerSwapId,
          swapData: innerSwapData,
          metadata,
          destinationPayload
        }
      } = iface.parseTransaction(call)!.args

      const dstChain: HumanizerVisualization[] = []
      const tokensData: HumanizerVisualization[] = []
      if (STARGATE_CHAIN_IDS[stargateDstChainId])
        dstChain.push(getLabel('to'), getChain(STARGATE_CHAIN_IDS[stargateDstChainId]))
      if (
        swapData.startsWith(
          iface.getFunction(
            'performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData)'
          )?.selector
        )
      ) {
        const {
          fromToken,
          toToken,
          amount,
          metadata: newMeta,
          swapExtraData
        } = iface.parseTransaction({
          ...call,
          data: swapData
        })!.args
        tokensData.push(getToken(fromToken, amount), getLabel('to'), getToken(toToken, value))
      }

      return [
        getAction('Bridge'),
        ...tokensData,
        ...dstChain,
        ...getRecipientText(senderAddress, receiverAddress)
      ]
    },

    [`${
      iface.getFunction(
        'function swapAndBridge(uint32 swapId, bytes swapData, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable'
      )?.selector
    }`]: (call: IrCall) => {
      const {
        swapId,
        swapData,
        stargateBridgeData: {
          dstEid,
          minAmountLD,
          stargatePoolAddress,
          destinationPayload,
          destinationExtraOptions,
          messagingFee: { nativeFee, lzTokenFee },
          metadata,
          toChainId,
          receiver,
          swapData: InnerSwapData,
          swapId: InnerSwapId,
          isNativeSwapRequired
        }
      } = iface.parseTransaction(call)!.args
      const dstChain: HumanizerVisualization[] = []
      const tokensData: HumanizerVisualization[] = []
      if (
        swapData.startsWith(
          iface.getFunction(
            'performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData)'
          )?.selector
        )
      ) {
        const {
          fromToken,
          toToken,
          amount,
          metadata: newMeta,
          swapExtraData
        } = iface.parseTransaction({
          ...call,
          data: swapData
        })!.args
        tokensData.push(getToken(fromToken, amount), getLabel('to'), getToken(toToken, minAmountLD))
      }

      return [
        getAction('Bridge'),
        ...tokensData,
        getLabel('to'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiver)
      ]
    },

    [`${
      iface.getFunction(
        'function swapAndBridge(uint32 swapId, bytes swapData, (address receiverAddress, address hopAMM, uint256 toChainId, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 amountOutMinDestination, uint256 deadlineDestination, bytes32 metadata) hopData) payable'
      )?.selector
    }`]: (call: IrCall) => {
      const {
        swapId,
        swapData,
        hopData: {
          receiverAddress,
          hopAMM,
          toChainId,
          bonderFee,
          amountOutMin,
          deadline,
          amountOutMinDestination,
          deadlineDestination,
          metadata
        }
      } = iface.parseTransaction(call)!.args

      const tokensData = []
      if (
        swapData.startsWith(
          iface.getFunction(
            'performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData)'
          )?.selector
        )
      ) {
        const { fromToken, amount, toToken, swapExtraData } = iface.parseTransaction({
          data: swapData
        })!.args
        tokensData.push(
          getToken(fromToken, amount),
          getLabel('to'),
          getToken(toToken, amountOutMinDestination)
        )
      }
      return [
        getAction('Bridge'),
        ...tokensData,
        getLabel('to'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiverAddress),
        getDeadline(deadlineDestination)
      ]
    },

    [`${
      iface.getFunction(
        'function swapAndBridge(uint32 swapId, bytes swapData, (address receiverAddress, address l1bridgeAddr, address relayer, uint256 toChainId, uint256 amountOutMin, uint256 relayerFee, uint256 deadline, bytes32 metadata) hopData) payable'
      )?.selector
    }`]: (call: IrCall) => {
      const {
        swapId,
        swapData,
        hopData: {
          receiverAddress,
          l1bridgeAddr,
          relayer,
          toChainId,
          amountOutMin,
          relayerFee,
          deadline,
          metadata
        }
      } = iface.parseTransaction(call)!.args
      const tokensData = []
      if (
        swapData.startsWith(
          iface.getFunction(
            'performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData)'
          )?.selector
        )
      ) {
        const { fromToken, amount, toToken, swapExtraData } = iface.parseTransaction({
          data: swapData
        })!.args
        if (
          swapExtraData.startsWith(
            iface.getFunction(
              'function swap(address caller, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 guaranteedAmount, uint256 flags, address referrer, bytes permit) desc, (uint256 target, uint256 gasLimit, uint256 value, bytes data)[] calls)'
            )!.selector
          )
        ) {
          const {
            caller,
            desc: {
              srcToken,
              dstToken,
              srcReceiver,
              dstReceiver,
              amount: amount2,
              minReturnAmount,
              guaranteedAmount,
              flags,
              referrer,
              permit
            },
            calls
          } = iface.parseTransaction({ data: swapExtraData })!.args
          tokensData.push(
            getToken(srcToken, amount2),
            getLabel('to'),
            getToken(dstToken, minReturnAmount)
          )
        } else {
          tokensData.push(
            getToken(fromToken, amount),
            getLabel('to'),
            getToken(toToken, amountOutMin)
          )
        }
      }
      return [
        getAction('Bridge'),
        ...tokensData,
        getLabel('to'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiverAddress),
        getDeadline(deadline)
      ]
    },

    [`${
      iface.getFunction(
        'bridgeERC20To(address receiverAddress, address token, address hopAMM, uint256 amount, uint256 toChainId, (uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 amountOutMinDestination, uint256 deadlineDestination, bytes32 metadata) hopBridgeRequestData)'
      )?.selector
    }`]: (call: IrCall) => {
      const {
        receiverAddress,
        token,
        hopAMM,
        amount,
        toChainId,
        hopBridgeRequestData: {
          bonderFee,
          amountOutMin,
          deadline,
          amountOutMinDestination,
          deadlineDestination,
          metadata
        }
      } = iface.parseTransaction(call)!.args

      return [
        getAction('Bridge'),
        getToken(token, amount),
        getLabel('for at least'),
        getToken(token, amountOutMinDestination),
        getLabel('to'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiverAddress),
        getDeadline(deadline)
      ]
    },
    [`${
      iface.getFunction(
        'bridgeERC20To(address token, uint256 amount, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable'
      )?.selector
    }`]: (call: IrCall) => {
      const {
        token,
        amount,
        stargateBridgeData: {
          dstEid,
          minAmountLD,
          stargatePoolAddress,
          destinationPayload,
          destinationExtraOptions,
          messagingFee: { nativeFee, lzTokenFee },
          metadata,
          toChainId,
          receiver,
          swapData,
          swapId,
          isNativeSwapRequired
        }
      } = iface.parseTransaction(call)!.args
      return [
        getAction('Bridge'),
        getToken(token, amount),
        getLabel('to'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiver)
      ]
    }
  }
  const newCalls: IrCall[] = irCalls.map((call: IrCall) => {
    let dataToUse = call.data
    if (!call.to) return call
    if (call.data.startsWith(preControllerIface.getFunction('executeController')!.selector)) {
      const [[controllerId, newData]] = preControllerIface.parseTransaction(call)!.args
      dataToUse = newData

      if (
        dataToUse.startsWith(preControllerIface.getFunction('takeFeeAndSwapAndBridge')!.selector)
      ) {
        const [
          [
            feesTakerAddress,
            feesToken,
            feesAmount,
            swapRouteId,
            swapData,
            bridgeRouteId,
            bridgeData
          ]
        ] = preControllerIface.decodeFunctionData('takeFeeAndSwapAndBridge', dataToUse)
        const humanizationOfSwap = matcher[swapData.slice(0, 10)]
          ? matcher[swapData.slice(0, 10)]({ ...call, data: swapData })
          : [getAction('Swap')]

        let humanizationOfBridge = [getAction('Bridge')]

        try {
          const [
            [
              [sender, receiver],
              [tokenIn, tokenOut],
              [outputAmount, chainId],
              [quoteTime, deadline],
              bridgeFee,
              metadata
            ]
          ] = new AbiCoder().decode(
            [
              'tuple(address[] senderReceiverAddresses, address[] inputOutputTokens, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata)'
            ],
            bridgeData
          )

          humanizationOfBridge = [
            getAction('Bridge'),
            getToken(tokenIn, 0n),
            getLabel('for at least'),
            getTokenWithChain(tokenOut, outputAmount, chainId),
            getLabel('to'),
            getChain(chainId),
            ...getRecipientText(accountOp.accountAddr, receiver),
            getDeadline(deadline)
          ]
        } catch (e) {
          console.log(e)
        }
        return {
          ...call,
          fullVisualization: [...humanizationOfSwap, getLabel('and'), ...humanizationOfBridge]
        }
      }
      if (dataToUse.startsWith(preControllerIface.getFunction('takeFeesAndSwap')!.selector)) {
        const [[feesTakerAddress, feesToken, feesAmount, routeId, swapRequestData]] =
          preControllerIface.decodeFunctionData('takeFeesAndSwap', dataToUse)
        dataToUse = swapRequestData
      } else if (
        dataToUse.startsWith(preControllerIface.getFunction('takeFeesAndBridge')!.selector)
      ) {
        const [[feesTakerAddress, feesToken, feesAmount, routeId, bridgeRequestData]] =
          preControllerIface.decodeFunctionData('takeFeesAndBridge', dataToUse)
        dataToUse = bridgeRequestData
      }
    } else {
      dataToUse = `0x${dataToUse.slice(10)}`
    }
    if (matcher[dataToUse.slice(0, 10)]) {
      return {
        ...call,
        fullVisualization: matcher[dataToUse.slice(0, 10)]({ ...call, data: dataToUse })
      }
    }
    return call
  })
  return newCalls
}
