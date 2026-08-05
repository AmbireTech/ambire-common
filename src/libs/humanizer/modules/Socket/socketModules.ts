/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  decodeAbiParameters,
  decodeFunctionData,
  isHex,
  parseAbi,
  parseAbiParameters,
  toFunctionSelector,
  zeroAddress
} from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerVisualization, IrCall } from '../../interfaces'
import {
  HexIrCall,
  eToNative,
  getAction,
  getAddressVisualization,
  getChain,
  getDeadline,
  getLabel,
  getRecipientText,
  getToken,
  getTokenWithChain,
  isHexCall
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

// preController ABIs
const executeControllerAbi = parseAbi([
  'function executeController((uint32 controllerId, bytes data) socketControllerRequest)'
])
const takeFeesAndSwapAbi = parseAbi([
  'function takeFeesAndSwap((address feesTakerAddress, address feesToken, uint256 feesAmount, uint32 routeId, bytes swapRequestData) ftsRequest) payable returns (bytes)'
])
const takeFeesAndBridgeAbi = parseAbi([
  'function takeFeesAndBridge((address feesTakerAddress, address feesToken, uint256 feesAmount, uint32 routeId, bytes bridgeRequestData) ftbRequest) payable returns (bytes)'
])
const takeFeeAndSwapAndBridgeAbi = parseAbi([
  // @TODO
  'function takeFeeAndSwapAndBridge((address feesTakerAddress, address feesToken, uint256 feesAmount, uint32 swapRouteId, bytes swapData, uint32 bridgeRouteId, bytes bridgeData) fsbRequest)'
])

// inner function ABIs used for selector checks and decoding swap data
const performActionAbi = parseAbi([
  'function performAction(address fromToken, address toToken, uint256 amount, address receiverAddress, bytes32 metadata, bytes swapExtraData) payable returns (uint256)'
])
const performActionWithInAbi = parseAbi([
  'function performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData) payable returns (uint256, address)'
])
const transformERC20Abi = parseAbi([
  'function transformERC20(address inputToken, address outputToken, uint256 inputTokenAmount, uint256 minOutputTokenAmount, (uint32,bytes)[] transformations)'
])
const swapWithDescAbi = parseAbi([
  'function swap(address caller, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 guaranteedAmount, uint256 flags, address referrer, bytes permit) desc, (uint256 target, uint256 gasLimit, uint256 value, bytes data)[] calls) payable returns (uint256 returnAmount)'
])

// swapAndBridge overload ABIs
const swapAndBridgeAcrossAbi = parseAbi([
  'function swapAndBridge(uint32 swapId, bytes swapData, (address[] senderReceiverAddresses, address outputToken, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData) payable'
])
const swapAndBridgeCelerAbi = parseAbi([
  'function swapAndBridge(uint32 swapId, bytes swapData, (address receiverAddress, uint64 toChainId, uint32 maxSlippage, uint64 nonce, bytes32 metadata) celerBridgeData) payable'
])
const swapAndBridgeSimpleAbi = parseAbi([
  'function swapAndBridge(uint32, address, uint256, bytes32, bytes)'
])
const swapAndBridgeConnextAbi = parseAbi([
  'function swapAndBridge(uint32 swapId, bytes swapData, (uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)'
])
const swapAndBridgeStargateAbi = parseAbi([
  'function swapAndBridge(uint32 swapId, bytes swapData, (address receiverAddress, address senderAddress, uint256 value, uint256 srcPoolId, uint256 dstPoolId, uint256 minReceivedAmt, uint256 destinationGasLimit, bool isNativeSwapRequired, uint16 stargateDstChainId, uint32 swapId, bytes swapData, bytes32 metadata, bytes destinationPayload) acrossBridgeData) payable'
])
const swapAndBridgeStargateV2Abi = parseAbi([
  'function swapAndBridge(uint32 swapId, bytes swapData, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable'
])
const swapAndBridgeHopAbi = parseAbi([
  'function swapAndBridge(uint32 swapId, bytes swapData, (address receiverAddress, address hopAMM, uint256 toChainId, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 amountOutMinDestination, uint256 deadlineDestination, bytes32 metadata) hopData) payable'
])
const swapAndBridgeHopL1Abi = parseAbi([
  'function swapAndBridge(uint32 swapId, bytes swapData, (address receiverAddress, address l1bridgeAddr, address relayer, uint256 toChainId, uint256 amountOutMin, uint256 relayerFee, uint256 deadline, bytes32 metadata) hopData) payable'
])

// bridgeNativeTo overload ABIs
const bridgeNativeToAcrossAbi = parseAbi([
  'function bridgeNativeTo(uint256 amount, (address[] senderReceiverAddresses, address outputToken, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData) payable'
])
const bridgeNativeToStargateAbi = parseAbi([
  'function bridgeNativeTo(address senderAddress, address receiverAddress, uint256 amount, (uint256 srcPoolId, uint256 dstPoolId, uint256 destinationGasLimit, uint256 minReceivedAmt, uint256 value, uint16 stargateDstChainId, uint32 swapId, bytes32 metadata, bytes swapData, bytes destinationPayload) stargateBridgeExtraData) payable'
])
const bridgeNativeToL2GasAbi = parseAbi([
  'function bridgeNativeTo(address receiverAddress, uint32 l2Gas, uint256 amount, uint256 toChainId, bytes32 metadata, bytes32 bridgeHash, bytes data) payable'
])
const bridgeNativeToGasLimitAbi = parseAbi([
  'function bridgeNativeTo(address receiverAddress, uint256 gasLimit, uint256 fees, bytes32 metadata, uint256 amount, uint256 toChainId, bytes32 bridgeHash) payable'
])
const bridgeNativeToRelayerAbi = parseAbi([
  'function bridgeNativeTo(address receiverAddress, address l1bridgeAddr, address relayer, uint256 toChainId, uint256 amount, uint256 amountOutMin, uint256 relayerFee, uint256 deadline, bytes32 metadata) payable'
])
const bridgeNativeToSimpleAbi = parseAbi([
  'function bridgeNativeTo(uint256, address, uint256, bytes32)'
])
const bridgeNativeToHopAbi = parseAbi([
  'function bridgeNativeTo(address receiverAddress, address hopAMM, uint256 amount, uint256 toChainId, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 amountOutMinDestination, uint256 deadlineDestination, bytes32 metadata) payable'
])
const bridgeNativeToCustomAbi = parseAbi([
  'function bridgeNativeTo(address receiverAddress, address customBridgeAddress, uint32 l2Gas, uint256 amount, bytes32 metadata, bytes data)'
])
const bridgeNativeToSynapseAbi = parseAbi([
  'function bridgeNativeTo(uint256 amount, bytes32 metadata, address receiverAddress, uint256 toChainId, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) originQuery, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) destinationQuery) payable'
])
const bridgeNativeToStargateV2Abi = parseAbi([
  'function bridgeNativeTo(uint256 amount, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable'
])
const bridgeNativeToStargateV2WithApprovalAbi = parseAbi([
  'function bridgeNativeTo(uint256 amount, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired, bool isApprovalRequired) stargateBridgeData) payable'
])

// bridgeERC20To overload ABIs
const bridgeERC20ToAcrossAbi = parseAbi([
  'function bridgeERC20To(uint256 amount, (address[] senderReceiverAddresses, address[] inputOutputTokens, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData) payable'
])
const bridgeERC20ToConnextAbi = parseAbi([
  'function bridgeERC20To(uint256 amount, (uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address token, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)'
])
const bridgeERC20ToSimpleAbi = parseAbi([
  'function bridgeERC20To(uint256, bytes32, address, address, uint256, uint32, uint256)'
])
const bridgeERC20ToHopAbi = parseAbi([
  'function bridgeERC20To(address receiverAddress, address token, address hopAMM, uint256 amount, uint256 toChainId, (uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 amountOutMinDestination, uint256 deadlineDestination, bytes32 metadata) hopBridgeRequestData)'
])
const bridgeERC20ToStargateV2Abi = parseAbi([
  'function bridgeERC20To(address token, uint256 amount, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable'
])

// @TODO check all additional data provided
// @TODO consider fees everywhere
// @TODO add automated tests
export const SocketModule: HumanizerCallModule = (accountOp: AccountOp, call: IrCall) => {
  const matcher: { [sighash: string]: (irCall: HexIrCall) => HumanizerVisualization[] } = {
    [toFunctionSelector(swapAndBridgeAcrossAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: swapAndBridgeAcrossAbi,
        data: call.data
      })
      const [, swapData, acrossBridgeData] = args
      const {
        senderReceiverAddresses,
        outputToken,
        outputAmountToChainIdArray,
        quoteAndDeadlineTimeStamps
      } = acrossBridgeData
      const [senderAddress, recipientAddress] = senderReceiverAddresses as [string, string]
      const [outputAmount, dstChain] = outputAmountToChainIdArray as [bigint, bigint]
      const deadline = (quoteAndDeadlineTimeStamps as [number, number])[1]

      if (swapData.startsWith(toFunctionSelector(performActionWithInAbi[0]))) {
        const { args: innerArgs } = decodeFunctionData({
          abi: performActionWithInAbi,
          data: swapData
        })
        const [fromToken, toToken, amount] = innerArgs
        return [
          getAction('Bridge'),
          getToken(eToNative(fromToken), amount),
          getLabel('to'),
          getTokenWithChain(eToNative(toToken), outputAmount),
          getLabel('on'),
          getChain(dstChain),
          getDeadline(deadline),
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
        getDeadline(deadline),
        ...getRecipientText(senderAddress, recipientAddress)
      ]
    },
    [toFunctionSelector(swapAndBridgeCelerAbi[0])]: (call: HexIrCall) => {
      if (!call.to) throw Error('Humanizer: should not be in socket humanizer when !call.to')
      const { args } = decodeFunctionData({
        abi: swapAndBridgeCelerAbi,
        data: call.data
      })
      const [, swapData, celerBridgeData] = args
      const { receiverAddress, toChainId } = celerBridgeData

      if (swapData.startsWith(toFunctionSelector(performActionWithInAbi[0]))) {
        const { args: innerArgs } = decodeFunctionData({
          abi: performActionWithInAbi,
          data: swapData
        })
        const [fromToken, toToken, amount] = innerArgs
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
    [toFunctionSelector(swapAndBridgeSimpleAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: swapAndBridgeSimpleAbi,
        data: call.data
      })
      const [, , chainId, , data] = args
      if (data.startsWith(toFunctionSelector(performActionWithInAbi[0]))) {
        const { args: innerArgs } = decodeFunctionData({
          abi: performActionWithInAbi,
          data: data
        })
        const [fromToken, toToken, amount, , swapExtraData] = innerArgs
        if (swapExtraData.startsWith(toFunctionSelector(transformERC20Abi[0]))) {
          const { args: transformArgs } = decodeFunctionData({
            abi: transformERC20Abi,
            data: swapExtraData as `0x${string}`
          })
          const minOutputTokenAmount = transformArgs[3]

          return [
            getAction('Bridge'),
            getToken(fromToken, amount),
            getLabel('to'),
            getToken(toToken, minOutputTokenAmount, chainId),
            getLabel('on'),
            getChain(chainId)
          ]
        }
        return [
          getAction('Bridge'),
          getToken(fromToken, amount),
          getLabel('to'),
          getToken(toToken, 0n, chainId),
          getLabel('on'),
          getChain(chainId)
        ]
      }
      return [getAction('Bridge'), getLabel('to'), getChain(chainId)]
    },
    [toFunctionSelector(bridgeNativeToAcrossAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeNativeToAcrossAbi,
        data: call.data
      })
      const [amount, acrossBridgeData] = args
      const {
        senderReceiverAddresses,
        outputToken,
        outputAmountToChainIdArray,
        quoteAndDeadlineTimeStamps
      } = acrossBridgeData
      const [sender, receiver] = senderReceiverAddresses as [string, string]
      const [outputAmount, chainId] = outputAmountToChainIdArray as [bigint, bigint]
      const deadline = (quoteAndDeadlineTimeStamps as [number, number])[1]

      return [
        getAction('Bridge'),
        getToken(zeroAddress, amount),
        getLabel('to'),
        getTokenWithChain(eToNative(outputToken), outputAmount, chainId),
        getLabel('on'),
        getChain(chainId),
        getDeadline(deadline),
        ...getRecipientText(sender, receiver)
      ]
    },
    [toFunctionSelector(bridgeNativeToStargateAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeNativeToStargateAbi,
        data: call.data
      })
      const [senderAddress, receiverAddress, amount, stargateBridgeExtraData] = args
      const { minReceivedAmt, stargateDstChainId } = stargateBridgeExtraData
      const chainId = STARGATE_CHAIN_IDS[stargateDstChainId.toString()]!
      return [
        getAction('Bridge'),
        getToken(zeroAddress, amount),
        getLabel('to'),
        getTokenWithChain(zeroAddress, minReceivedAmt),
        getLabel('on'),
        getChain(chainId),
        ...getRecipientText(senderAddress, receiverAddress)
      ]
    },
    [toFunctionSelector(performActionAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: performActionAbi,
        data: call.data
      })
      const [fromToken, toToken, , receiverAddress] = args

      // We set 0n for from/to amounts so the Humanization does not show amounts.
      // It will display only text like "Swap USDC for WALLET".
      //
      // This avoids confusion because Socket routes return `fromAmount` after the convenience fee is deducted.
      // For example, when a user sends 1 USDC, Humanization would show 0.9975, while Simulation correctly shows 1 USDC.
      //
      // This happens because Socket contracts expect `fromAmount` to be fee-deducted,
      // and the convenience fee is sent separately to the feeTaker in internal calls.
      //
      // Since Simulation already shows the correct in/out amounts, we keep amounts there and hide them in Humanization.
      return [
        getAction('Swap'),
        getToken(eToNative(fromToken), 0n),
        getLabel('for'),
        getToken(eToNative(toToken), 0n),
        ...getRecipientText(accountOp.accountAddr, receiverAddress)
      ]
    },
    [toFunctionSelector(performActionWithInAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: performActionWithInAbi,
        data: call.data
      })
      const [fromToken, toToken] = args

      // We set 0n for from/to amounts so the Humanization does not show amounts.
      // It will display only text like "Swap USDC for WALLET".
      //
      // This avoids confusion because Socket routes return `fromAmount` after the convenience fee is deducted.
      // For example, when a user sends 1 USDC, Humanization would show 0.9975, while Simulation correctly shows 1 USDC.
      //
      // This happens because Socket contracts expect `fromAmount` to be fee-deducted,
      // and the convenience fee is sent separately to the feeTaker in internal calls.
      //
      // Since Simulation already shows the correct in/out amounts, we keep amounts there and hide them in Humanization.
      return [
        getAction('Swap'),
        getToken(eToNative(fromToken), 0n),
        getLabel('for'),
        getToken(eToNative(toToken), 0n)
      ]
    },
    [toFunctionSelector(bridgeERC20ToAcrossAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeERC20ToAcrossAbi,
        data: call.data
      })
      const [amount, acrossBridgeData] = args
      const { senderReceiverAddresses, inputOutputTokens, outputAmountToChainIdArray } =
        acrossBridgeData
      const [sender, receiver] = senderReceiverAddresses as [string, string]
      const [inputToken, outputToken] = inputOutputTokens as [string, string]
      const [outputAmount, chainId] = outputAmountToChainIdArray as [bigint, bigint]
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
    [toFunctionSelector(bridgeERC20ToConnextAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeERC20ToConnextAbi,
        data: call.data
      })
      const [amount, connextBridgeData] = args
      const { toChainId, token, receiverAddress } = connextBridgeData
      return [
        getAction('Bridge'),
        getToken(eToNative(token), amount),
        getLabel('to'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiverAddress)
      ]
    },
    [toFunctionSelector(bridgeNativeToSynapseAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeNativeToSynapseAbi,
        data: call.data
      })
      const [amount, , receiverAddress, toChainId, originQuery, destinationQuery] = args
      const { tokenOut, deadline } = originQuery
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
    [toFunctionSelector(bridgeERC20ToSimpleAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeERC20ToSimpleAbi,
        data: call.data
      })
      const [amount, , recipient, token, chainId] = args
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
    [toFunctionSelector(bridgeNativeToCustomAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeNativeToCustomAbi,
        data: call.data
      })
      const [receiverAddress, customBridgeAddress, , amount] = args
      // @TODO
      return [
        getAction('Bridge'),
        getToken(zeroAddress, amount),
        getLabel('via'),
        getAddressVisualization(customBridgeAddress),
        ...getRecipientText(accountOp.accountAddr, receiverAddress)
      ]
    },
    [toFunctionSelector(bridgeNativeToL2GasAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeNativeToL2GasAbi,
        data: call.data
      })
      const [receiverAddress, , amount, toChainId] = args
      return [
        getAction('Bridge'),
        getToken(zeroAddress, amount),
        getLabel('to'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiverAddress)
      ]
    },
    [toFunctionSelector(bridgeNativeToGasLimitAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeNativeToGasLimitAbi,
        data: call.data
      })
      const [receiverAddress, , , , amount, toChainId] = args
      return [
        getAction('Bridge'),
        getToken(zeroAddress, amount),
        getLabel('to'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiverAddress)
      ]
    },
    [toFunctionSelector(bridgeNativeToRelayerAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeNativeToRelayerAbi,
        data: call.data
      })
      const [receiverAddress, , , toChainId, amount, amountOutMin, , deadline] = args
      return [
        getAction('Bridge'),
        getToken(zeroAddress, amount),
        getLabel('to'),
        getToken(zeroAddress, amountOutMin),
        getLabel('on'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiverAddress),
        getDeadline(deadline)
      ]
    },
    [toFunctionSelector(bridgeNativeToSimpleAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeNativeToSimpleAbi,
        data: call.data
      })
      const [amount, recipient, chainId] = args
      return [
        getAction('Bridge'),
        getToken(zeroAddress, amount),
        getLabel('to'),
        getChain(chainId),
        ...getRecipientText(accountOp.accountAddr, recipient)
      ]
    },
    [toFunctionSelector(bridgeNativeToHopAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeNativeToHopAbi,
        data: call.data
      })
      const [receiverAddress, , amount, toChainId, , amountOutMin, deadline] = args
      return [
        getAction('Bridge'),
        getToken(zeroAddress, amount),
        getLabel('to'),
        getToken(zeroAddress, amountOutMin),
        getLabel('on'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiverAddress),
        getDeadline(deadline)
      ]
    },
    [toFunctionSelector(swapAndBridgeConnextAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: swapAndBridgeConnextAbi,
        data: call.data
      })
      const [, swapData, connextBridgeData] = args
      const { toChainId: chainId, receiverAddress } = connextBridgeData

      if (swapData.startsWith(toFunctionSelector(performActionWithInAbi[0]))) {
        const { args: innerArgs } = decodeFunctionData({
          abi: performActionWithInAbi,
          data: swapData
        })
        const [fromToken, toToken, amount, , swapExtraData] = innerArgs
        let outAmount = 0n
        if (swapExtraData.startsWith(toFunctionSelector(transformERC20Abi[0]))) {
          const { args: transformArgs } = decodeFunctionData({
            abi: transformERC20Abi,
            data: swapExtraData as `0x${string}`
          })
          outAmount = transformArgs[3]
        }

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
    [toFunctionSelector(swapAndBridgeStargateAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: swapAndBridgeStargateAbi,
        data: call.data
      })
      const [, swapData, acrossBridgeData] = args
      const { receiverAddress, senderAddress, value, stargateDstChainId, minReceivedAmt } =
        acrossBridgeData

      const dstChain: HumanizerVisualization[] = []
      const tokensData: HumanizerVisualization[] = []
      if (STARGATE_CHAIN_IDS[stargateDstChainId.toString()])
        dstChain.push(getLabel('to'), getChain(STARGATE_CHAIN_IDS[stargateDstChainId.toString()]!))
      if (swapData.startsWith(toFunctionSelector(performActionWithInAbi[0]))) {
        const { args: innerArgs } = decodeFunctionData({
          abi: performActionWithInAbi,
          data: swapData
        })
        const [fromToken, toToken, amount] = innerArgs
        tokensData.push(getToken(fromToken, amount), getLabel('to'), getToken(toToken, value))
      }

      return [
        getAction('Bridge'),
        ...tokensData,
        ...dstChain,
        ...getRecipientText(senderAddress, receiverAddress)
      ]
    },

    [toFunctionSelector(swapAndBridgeStargateV2Abi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: swapAndBridgeStargateV2Abi,
        data: call.data
      })
      const [, swapData, stargateBridgeData] = args
      const { toChainId, receiver, minAmountLD } = stargateBridgeData

      const dstChain: HumanizerVisualization[] = []
      const tokensData: HumanizerVisualization[] = []
      if (swapData.startsWith(toFunctionSelector(performActionWithInAbi[0]))) {
        const { args: innerArgs } = decodeFunctionData({
          abi: performActionWithInAbi,
          data: swapData
        })
        const [fromToken, toToken, amount] = innerArgs
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

    [toFunctionSelector(swapAndBridgeHopAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: swapAndBridgeHopAbi,
        data: call.data
      })
      const [, swapData, hopData] = args
      const { receiverAddress, toChainId, amountOutMinDestination, deadlineDestination } = hopData

      const tokensData: HumanizerVisualization[] = []
      if (swapData.startsWith(toFunctionSelector(performActionWithInAbi[0]))) {
        const { args: innerArgs } = decodeFunctionData({
          abi: performActionWithInAbi,
          data: swapData
        })
        const [fromToken, toToken, amount] = innerArgs
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

    [toFunctionSelector(swapAndBridgeHopL1Abi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: swapAndBridgeHopL1Abi,
        data: call.data
      })
      const [, swapData, hopData] = args
      const { receiverAddress, toChainId, amountOutMin, deadline } = hopData

      const tokensData: HumanizerVisualization[] = []
      if (swapData.startsWith(toFunctionSelector(performActionWithInAbi[0]))) {
        const { args: innerArgs } = decodeFunctionData({
          abi: performActionWithInAbi,
          data: swapData
        })
        const [fromToken, toToken, amount, , swapExtraData] = innerArgs
        if (swapExtraData.startsWith(toFunctionSelector(swapWithDescAbi[0]))) {
          const { args: swapArgs } = decodeFunctionData({
            abi: swapWithDescAbi,
            data: swapExtraData as `0x${string}`
          })
          const [, desc] = swapArgs
          const { srcToken, dstToken, amount: amount2, minReturnAmount } = desc
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

    [toFunctionSelector(bridgeERC20ToHopAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeERC20ToHopAbi,
        data: call.data
      })
      const [receiverAddress, token, , amount, toChainId, hopBridgeRequestData] = args
      const { amountOutMinDestination, deadlineDestination, deadline } = hopBridgeRequestData

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
    [toFunctionSelector(bridgeERC20ToStargateV2Abi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeERC20ToStargateV2Abi,
        data: call.data
      })
      const [token, amount, stargateBridgeData] = args
      const { toChainId, receiver } = stargateBridgeData
      return [
        getAction('Bridge'),
        getToken(token, amount),
        getLabel('to'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiver)
      ]
    },
    [toFunctionSelector(bridgeNativeToStargateV2Abi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeNativeToStargateV2Abi,
        data: call.data
      })
      const [amount, stargateBridgeData] = args
      const { toChainId, receiver } = stargateBridgeData
      return [
        getAction('Bridge'),
        getToken(zeroAddress, amount),
        getLabel('to'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiver)
      ]
    },
    [toFunctionSelector(bridgeNativeToStargateV2WithApprovalAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({
        abi: bridgeNativeToStargateV2WithApprovalAbi,
        data: call.data
      })
      const [amount, stargateBridgeData] = args
      const { toChainId, receiver } = stargateBridgeData
      return [
        getAction('Bridge'),
        getToken(zeroAddress, amount),
        getLabel('to'),
        getChain(toChainId),
        ...getRecipientText(accountOp.accountAddr, receiver)
      ]
    }
  }
  if (!call.to) return call
  if (!isHexCall(call)) return call

  let dataToUse: `0x${string}` = call.data
  if (call.data.startsWith(toFunctionSelector(executeControllerAbi[0]))) {
    const { args } = decodeFunctionData({ abi: executeControllerAbi, data: call.data })
    const [socketControllerRequest] = args
    dataToUse = socketControllerRequest.data

    if (dataToUse.startsWith(toFunctionSelector(takeFeeAndSwapAndBridgeAbi[0]))) {
      const { args: fsbArgs } = decodeFunctionData({
        abi: takeFeeAndSwapAndBridgeAbi,
        data: dataToUse
      })
      const [fsbRequest] = fsbArgs
      const { swapData, bridgeData } = fsbRequest
      const swapMatcher = matcher[swapData.slice(0, 10)]
      const humanizationOfSwap = swapMatcher
        ? swapMatcher({ ...call, data: swapData })
        : [getAction('Swap')]

      let humanizationOfBridge: HumanizerVisualization[] = [getAction('Bridge')]

      try {
        const [decoded] = decodeAbiParameters(
          parseAbiParameters(
            '(address[] senderReceiverAddresses, address[] inputOutputTokens, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata)'
          ),
          bridgeData
        )
        const [, receiver] = decoded.senderReceiverAddresses as [string, string]
        const [tokenIn] = decoded.inputOutputTokens as [string, string]
        const [, chainId] = decoded.outputAmountToChainIdArray as [bigint, bigint]
        const [, deadline] = decoded.quoteAndDeadlineTimeStamps as [number, number]

        humanizationOfBridge = [
          getAction('Bridge'),
          getToken(tokenIn, 0n),
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
    if (dataToUse.startsWith(toFunctionSelector(takeFeesAndSwapAbi[0]))) {
      const { args: ftsArgs } = decodeFunctionData({ abi: takeFeesAndSwapAbi, data: dataToUse })
      const [ftsRequest] = ftsArgs
      dataToUse = ftsRequest.swapRequestData
    } else if (dataToUse.startsWith(toFunctionSelector(takeFeesAndBridgeAbi[0]))) {
      const { args: ftbArgs } = decodeFunctionData({ abi: takeFeesAndBridgeAbi, data: dataToUse })
      const [ftbRequest] = ftbArgs
      dataToUse = ftbRequest.bridgeRequestData
    }
  } else {
    const stripped = `0x${dataToUse.slice(10)}`
    if (!isHex(stripped)) return call
    dataToUse = stripped
  }
  const callMatcher = matcher[dataToUse.slice(0, 10)]
  if (callMatcher) {
    return { ...call, fullVisualization: callMatcher({ ...call, data: dataToUse }) }
  }
  return call
}
