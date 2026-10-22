"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketModule = void 0;
/* eslint-disable @typescript-eslint/no-unused-vars */
const viem_1 = require("viem");
const utils_1 = require("../../utils");
// taken from https://stargateprotocol.gitbook.io/stargate/developers/chain-ids
const STARGATE_CHAIN_IDS = {
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
};
// preController ABIs
const executeControllerAbi = (0, viem_1.parseAbi)([
    'function executeController((uint32 controllerId, bytes data) socketControllerRequest)'
]);
const takeFeesAndSwapAbi = (0, viem_1.parseAbi)([
    'function takeFeesAndSwap((address feesTakerAddress, address feesToken, uint256 feesAmount, uint32 routeId, bytes swapRequestData) ftsRequest) payable returns (bytes)'
]);
const takeFeesAndBridgeAbi = (0, viem_1.parseAbi)([
    'function takeFeesAndBridge((address feesTakerAddress, address feesToken, uint256 feesAmount, uint32 routeId, bytes bridgeRequestData) ftbRequest) payable returns (bytes)'
]);
const takeFeeAndSwapAndBridgeAbi = (0, viem_1.parseAbi)([
    // @TODO
    'function takeFeeAndSwapAndBridge((address feesTakerAddress, address feesToken, uint256 feesAmount, uint32 swapRouteId, bytes swapData, uint32 bridgeRouteId, bytes bridgeData) fsbRequest)'
]);
// inner function ABIs used for selector checks and decoding swap data
const performActionAbi = (0, viem_1.parseAbi)([
    'function performAction(address fromToken, address toToken, uint256 amount, address receiverAddress, bytes32 metadata, bytes swapExtraData) payable returns (uint256)'
]);
const performActionWithInAbi = (0, viem_1.parseAbi)([
    'function performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData) payable returns (uint256, address)'
]);
const transformERC20Abi = (0, viem_1.parseAbi)([
    'function transformERC20(address inputToken, address outputToken, uint256 inputTokenAmount, uint256 minOutputTokenAmount, (uint32,bytes)[] transformations)'
]);
const swapWithDescAbi = (0, viem_1.parseAbi)([
    'function swap(address caller, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 guaranteedAmount, uint256 flags, address referrer, bytes permit) desc, (uint256 target, uint256 gasLimit, uint256 value, bytes data)[] calls) payable returns (uint256 returnAmount)'
]);
// swapAndBridge overload ABIs
const swapAndBridgeAcrossAbi = (0, viem_1.parseAbi)([
    'function swapAndBridge(uint32 swapId, bytes swapData, (address[] senderReceiverAddresses, address outputToken, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData) payable'
]);
const swapAndBridgeCelerAbi = (0, viem_1.parseAbi)([
    'function swapAndBridge(uint32 swapId, bytes swapData, (address receiverAddress, uint64 toChainId, uint32 maxSlippage, uint64 nonce, bytes32 metadata) celerBridgeData) payable'
]);
const swapAndBridgeSimpleAbi = (0, viem_1.parseAbi)([
    'function swapAndBridge(uint32, address, uint256, bytes32, bytes)'
]);
const swapAndBridgeConnextAbi = (0, viem_1.parseAbi)([
    'function swapAndBridge(uint32 swapId, bytes swapData, (uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)'
]);
const swapAndBridgeStargateAbi = (0, viem_1.parseAbi)([
    'function swapAndBridge(uint32 swapId, bytes swapData, (address receiverAddress, address senderAddress, uint256 value, uint256 srcPoolId, uint256 dstPoolId, uint256 minReceivedAmt, uint256 destinationGasLimit, bool isNativeSwapRequired, uint16 stargateDstChainId, uint32 swapId, bytes swapData, bytes32 metadata, bytes destinationPayload) acrossBridgeData) payable'
]);
const swapAndBridgeStargateV2Abi = (0, viem_1.parseAbi)([
    'function swapAndBridge(uint32 swapId, bytes swapData, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable'
]);
const swapAndBridgeHopAbi = (0, viem_1.parseAbi)([
    'function swapAndBridge(uint32 swapId, bytes swapData, (address receiverAddress, address hopAMM, uint256 toChainId, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 amountOutMinDestination, uint256 deadlineDestination, bytes32 metadata) hopData) payable'
]);
const swapAndBridgeHopL1Abi = (0, viem_1.parseAbi)([
    'function swapAndBridge(uint32 swapId, bytes swapData, (address receiverAddress, address l1bridgeAddr, address relayer, uint256 toChainId, uint256 amountOutMin, uint256 relayerFee, uint256 deadline, bytes32 metadata) hopData) payable'
]);
// bridgeNativeTo overload ABIs
const bridgeNativeToAcrossAbi = (0, viem_1.parseAbi)([
    'function bridgeNativeTo(uint256 amount, (address[] senderReceiverAddresses, address outputToken, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData) payable'
]);
const bridgeNativeToStargateAbi = (0, viem_1.parseAbi)([
    'function bridgeNativeTo(address senderAddress, address receiverAddress, uint256 amount, (uint256 srcPoolId, uint256 dstPoolId, uint256 destinationGasLimit, uint256 minReceivedAmt, uint256 value, uint16 stargateDstChainId, uint32 swapId, bytes32 metadata, bytes swapData, bytes destinationPayload) stargateBridgeExtraData) payable'
]);
const bridgeNativeToL2GasAbi = (0, viem_1.parseAbi)([
    'function bridgeNativeTo(address receiverAddress, uint32 l2Gas, uint256 amount, uint256 toChainId, bytes32 metadata, bytes32 bridgeHash, bytes data) payable'
]);
const bridgeNativeToGasLimitAbi = (0, viem_1.parseAbi)([
    'function bridgeNativeTo(address receiverAddress, uint256 gasLimit, uint256 fees, bytes32 metadata, uint256 amount, uint256 toChainId, bytes32 bridgeHash) payable'
]);
const bridgeNativeToRelayerAbi = (0, viem_1.parseAbi)([
    'function bridgeNativeTo(address receiverAddress, address l1bridgeAddr, address relayer, uint256 toChainId, uint256 amount, uint256 amountOutMin, uint256 relayerFee, uint256 deadline, bytes32 metadata) payable'
]);
const bridgeNativeToSimpleAbi = (0, viem_1.parseAbi)([
    'function bridgeNativeTo(uint256, address, uint256, bytes32)'
]);
const bridgeNativeToHopAbi = (0, viem_1.parseAbi)([
    'function bridgeNativeTo(address receiverAddress, address hopAMM, uint256 amount, uint256 toChainId, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 amountOutMinDestination, uint256 deadlineDestination, bytes32 metadata) payable'
]);
const bridgeNativeToCustomAbi = (0, viem_1.parseAbi)([
    'function bridgeNativeTo(address receiverAddress, address customBridgeAddress, uint32 l2Gas, uint256 amount, bytes32 metadata, bytes data)'
]);
const bridgeNativeToSynapseAbi = (0, viem_1.parseAbi)([
    'function bridgeNativeTo(uint256 amount, bytes32 metadata, address receiverAddress, uint256 toChainId, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) originQuery, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) destinationQuery) payable'
]);
const bridgeNativeToStargateV2Abi = (0, viem_1.parseAbi)([
    'function bridgeNativeTo(uint256 amount, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable'
]);
const bridgeNativeToStargateV2WithApprovalAbi = (0, viem_1.parseAbi)([
    'function bridgeNativeTo(uint256 amount, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired, bool isApprovalRequired) stargateBridgeData) payable'
]);
// bridgeERC20To overload ABIs
const bridgeERC20ToAcrossAbi = (0, viem_1.parseAbi)([
    'function bridgeERC20To(uint256 amount, (address[] senderReceiverAddresses, address[] inputOutputTokens, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData) payable'
]);
const bridgeERC20ToConnextAbi = (0, viem_1.parseAbi)([
    'function bridgeERC20To(uint256 amount, (uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address token, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)'
]);
const bridgeERC20ToSimpleAbi = (0, viem_1.parseAbi)([
    'function bridgeERC20To(uint256, bytes32, address, address, uint256, uint32, uint256)'
]);
const bridgeERC20ToHopAbi = (0, viem_1.parseAbi)([
    'function bridgeERC20To(address receiverAddress, address token, address hopAMM, uint256 amount, uint256 toChainId, (uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 amountOutMinDestination, uint256 deadlineDestination, bytes32 metadata) hopBridgeRequestData)'
]);
const bridgeERC20ToStargateV2Abi = (0, viem_1.parseAbi)([
    'function bridgeERC20To(address token, uint256 amount, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable'
]);
// @TODO check all additional data provided
// @TODO consider fees everywhere
// @TODO add automated tests
const bridgeERC20ToAcrossSelector = (0, viem_1.toFunctionSelector)(bridgeERC20ToAcrossAbi[0]);
const bridgeERC20ToConnextSelector = (0, viem_1.toFunctionSelector)(bridgeERC20ToConnextAbi[0]);
const bridgeERC20ToHopSelector = (0, viem_1.toFunctionSelector)(bridgeERC20ToHopAbi[0]);
const bridgeERC20ToSimpleSelector = (0, viem_1.toFunctionSelector)(bridgeERC20ToSimpleAbi[0]);
const bridgeERC20ToStargateV2Selector = (0, viem_1.toFunctionSelector)(bridgeERC20ToStargateV2Abi[0]);
const bridgeNativeToAcrossSelector = (0, viem_1.toFunctionSelector)(bridgeNativeToAcrossAbi[0]);
const bridgeNativeToCustomSelector = (0, viem_1.toFunctionSelector)(bridgeNativeToCustomAbi[0]);
const bridgeNativeToGasLimitSelector = (0, viem_1.toFunctionSelector)(bridgeNativeToGasLimitAbi[0]);
const bridgeNativeToHopSelector = (0, viem_1.toFunctionSelector)(bridgeNativeToHopAbi[0]);
const bridgeNativeToL2GasSelector = (0, viem_1.toFunctionSelector)(bridgeNativeToL2GasAbi[0]);
const bridgeNativeToRelayerSelector = (0, viem_1.toFunctionSelector)(bridgeNativeToRelayerAbi[0]);
const bridgeNativeToSimpleSelector = (0, viem_1.toFunctionSelector)(bridgeNativeToSimpleAbi[0]);
const bridgeNativeToStargateSelector = (0, viem_1.toFunctionSelector)(bridgeNativeToStargateAbi[0]);
const bridgeNativeToStargateV2Selector = (0, viem_1.toFunctionSelector)(bridgeNativeToStargateV2Abi[0]);
const bridgeNativeToStargateV2WithApprovalSelector = (0, viem_1.toFunctionSelector)(bridgeNativeToStargateV2WithApprovalAbi[0]);
const bridgeNativeToSynapseSelector = (0, viem_1.toFunctionSelector)(bridgeNativeToSynapseAbi[0]);
const executeControllerSelector = (0, viem_1.toFunctionSelector)(executeControllerAbi[0]);
const performActionSelector = (0, viem_1.toFunctionSelector)(performActionAbi[0]);
const performActionWithInSelector = (0, viem_1.toFunctionSelector)(performActionWithInAbi[0]);
const swapAndBridgeAcrossSelector = (0, viem_1.toFunctionSelector)(swapAndBridgeAcrossAbi[0]);
const swapAndBridgeCelerSelector = (0, viem_1.toFunctionSelector)(swapAndBridgeCelerAbi[0]);
const swapAndBridgeConnextSelector = (0, viem_1.toFunctionSelector)(swapAndBridgeConnextAbi[0]);
const swapAndBridgeHopSelector = (0, viem_1.toFunctionSelector)(swapAndBridgeHopAbi[0]);
const swapAndBridgeHopL1Selector = (0, viem_1.toFunctionSelector)(swapAndBridgeHopL1Abi[0]);
const swapAndBridgeSimpleSelector = (0, viem_1.toFunctionSelector)(swapAndBridgeSimpleAbi[0]);
const swapAndBridgeStargateSelector = (0, viem_1.toFunctionSelector)(swapAndBridgeStargateAbi[0]);
const swapAndBridgeStargateV2Selector = (0, viem_1.toFunctionSelector)(swapAndBridgeStargateV2Abi[0]);
const swapWithDescSelector = (0, viem_1.toFunctionSelector)(swapWithDescAbi[0]);
const takeFeeAndSwapAndBridgeSelector = (0, viem_1.toFunctionSelector)(takeFeeAndSwapAndBridgeAbi[0]);
const takeFeesAndBridgeSelector = (0, viem_1.toFunctionSelector)(takeFeesAndBridgeAbi[0]);
const takeFeesAndSwapSelector = (0, viem_1.toFunctionSelector)(takeFeesAndSwapAbi[0]);
const transformERC20Selector = (0, viem_1.toFunctionSelector)(transformERC20Abi[0]);
const matcher = {
    [swapAndBridgeAcrossSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: swapAndBridgeAcrossAbi,
            data: call.data
        });
        const [, swapData, acrossBridgeData] = args;
        const { senderReceiverAddresses, outputToken, outputAmountToChainIdArray, quoteAndDeadlineTimeStamps } = acrossBridgeData;
        const [senderAddress, recipientAddress] = senderReceiverAddresses;
        const [outputAmount, dstChain] = outputAmountToChainIdArray;
        const deadline = quoteAndDeadlineTimeStamps[1];
        if (swapData.startsWith(performActionWithInSelector)) {
            const { args: innerArgs } = (0, viem_1.decodeFunctionData)({
                abi: performActionWithInAbi,
                data: swapData
            });
            const [fromToken, toToken, amount] = innerArgs;
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(fromToken), amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getTokenWithChain)((0, utils_1.eToNative)(toToken), outputAmount),
                (0, utils_1.getLabel)('on'),
                (0, utils_1.getChain)(dstChain),
                (0, utils_1.getDeadline)(deadline),
                ...(0, utils_1.getRecipientText)(senderAddress, recipientAddress)
            ];
        }
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getLabel)('undetected token'),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getTokenWithChain)((0, utils_1.eToNative)(outputToken), outputAmount, dstChain),
            (0, utils_1.getLabel)('on'),
            (0, utils_1.getChain)(dstChain),
            (0, utils_1.getDeadline)(deadline),
            ...(0, utils_1.getRecipientText)(senderAddress, recipientAddress)
        ];
    },
    [swapAndBridgeCelerSelector]: (accountOp, call) => {
        if (!call.to)
            throw Error('Humanizer: should not be in socket humanizer when !call.to');
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: swapAndBridgeCelerAbi,
            data: call.data
        });
        const [, swapData, celerBridgeData] = args;
        const { receiverAddress, toChainId } = celerBridgeData;
        if (swapData.startsWith(performActionWithInSelector)) {
            const { args: innerArgs } = (0, viem_1.decodeFunctionData)({
                abi: performActionWithInAbi,
                data: swapData
            });
            const [fromToken, toToken, amount] = innerArgs;
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(fromToken), amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getTokenWithChain)((0, utils_1.eToNative)(toToken), 0n),
                (0, utils_1.getLabel)('on'),
                (0, utils_1.getChain)(toChainId),
                ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress)
            ];
        }
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getLabel)('via'),
            (0, utils_1.getAddressVisualization)(call.to),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getChain)(toChainId)
        ];
    },
    [swapAndBridgeSimpleSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: swapAndBridgeSimpleAbi,
            data: call.data
        });
        const [, , chainId, , data] = args;
        if (data.startsWith(performActionWithInSelector)) {
            const { args: innerArgs } = (0, viem_1.decodeFunctionData)({
                abi: performActionWithInAbi,
                data: data
            });
            const [fromToken, toToken, amount, , swapExtraData] = innerArgs;
            if (swapExtraData.startsWith(transformERC20Selector)) {
                const { args: transformArgs } = (0, viem_1.decodeFunctionData)({
                    abi: transformERC20Abi,
                    data: swapExtraData
                });
                const minOutputTokenAmount = transformArgs[3];
                return [
                    (0, utils_1.getAction)('Bridge'),
                    (0, utils_1.getToken)(fromToken, amount),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getToken)(toToken, minOutputTokenAmount, chainId),
                    (0, utils_1.getLabel)('on'),
                    (0, utils_1.getChain)(chainId)
                ];
            }
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)(fromToken, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getToken)(toToken, 0n, chainId),
                (0, utils_1.getLabel)('on'),
                (0, utils_1.getChain)(chainId)
            ];
        }
        return [(0, utils_1.getAction)('Bridge'), (0, utils_1.getLabel)('to'), (0, utils_1.getChain)(chainId)];
    },
    [bridgeNativeToAcrossSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeNativeToAcrossAbi,
            data: call.data
        });
        const [amount, acrossBridgeData] = args;
        const { senderReceiverAddresses, outputToken, outputAmountToChainIdArray, quoteAndDeadlineTimeStamps } = acrossBridgeData;
        const [sender, receiver] = senderReceiverAddresses;
        const [outputAmount, chainId] = outputAmountToChainIdArray;
        const deadline = quoteAndDeadlineTimeStamps[1];
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)(viem_1.zeroAddress, amount),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getTokenWithChain)((0, utils_1.eToNative)(outputToken), outputAmount, chainId),
            (0, utils_1.getLabel)('on'),
            (0, utils_1.getChain)(chainId),
            (0, utils_1.getDeadline)(deadline),
            ...(0, utils_1.getRecipientText)(sender, receiver)
        ];
    },
    [bridgeNativeToStargateSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeNativeToStargateAbi,
            data: call.data
        });
        const [senderAddress, receiverAddress, amount, stargateBridgeExtraData] = args;
        const { minReceivedAmt, stargateDstChainId } = stargateBridgeExtraData;
        const chainId = STARGATE_CHAIN_IDS[stargateDstChainId.toString()];
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)(viem_1.zeroAddress, amount),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getTokenWithChain)(viem_1.zeroAddress, minReceivedAmt),
            (0, utils_1.getLabel)('on'),
            (0, utils_1.getChain)(chainId),
            ...(0, utils_1.getRecipientText)(senderAddress, receiverAddress)
        ];
    },
    [performActionSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: performActionAbi,
            data: call.data
        });
        const [fromToken, toToken, , receiverAddress] = args;
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
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)((0, utils_1.eToNative)(fromToken), 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)((0, utils_1.eToNative)(toToken), 0n),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress)
        ];
    },
    [performActionWithInSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: performActionWithInAbi,
            data: call.data
        });
        const [fromToken, toToken] = args;
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
            (0, utils_1.getAction)('Swap'),
            (0, utils_1.getToken)((0, utils_1.eToNative)(fromToken), 0n),
            (0, utils_1.getLabel)('for'),
            (0, utils_1.getToken)((0, utils_1.eToNative)(toToken), 0n)
        ];
    },
    [bridgeERC20ToAcrossSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeERC20ToAcrossAbi,
            data: call.data
        });
        const [amount, acrossBridgeData] = args;
        const { senderReceiverAddresses, inputOutputTokens, outputAmountToChainIdArray } = acrossBridgeData;
        const [sender, receiver] = senderReceiverAddresses;
        const [inputToken, outputToken] = inputOutputTokens;
        const [outputAmount, chainId] = outputAmountToChainIdArray;
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)((0, utils_1.eToNative)(inputToken), amount),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getTokenWithChain)((0, utils_1.eToNative)(outputToken), outputAmount, chainId),
            (0, utils_1.getLabel)('on'),
            (0, utils_1.getChain)(chainId),
            ...(0, utils_1.getRecipientText)(sender, receiver)
        ];
    },
    [bridgeERC20ToConnextSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeERC20ToConnextAbi,
            data: call.data
        });
        const [amount, connextBridgeData] = args;
        const { toChainId, token, receiverAddress } = connextBridgeData;
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)((0, utils_1.eToNative)(token), amount),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getChain)(toChainId),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress)
        ];
    },
    [bridgeNativeToSynapseSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeNativeToSynapseAbi,
            data: call.data
        });
        const [amount, , receiverAddress, toChainId, originQuery, destinationQuery] = args;
        const { tokenOut, deadline } = originQuery;
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)((0, utils_1.eToNative)(tokenOut), amount),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getTokenWithChain)((0, utils_1.eToNative)(destinationQuery.tokenOut), destinationQuery.minAmountOut, toChainId),
            (0, utils_1.getLabel)('on'),
            (0, utils_1.getChain)(toChainId),
            (0, utils_1.getDeadline)(deadline),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress)
        ];
    },
    [bridgeERC20ToSimpleSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeERC20ToSimpleAbi,
            data: call.data
        });
        const [amount, , recipient, token, chainId] = args;
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)((0, utils_1.eToNative)(token), amount),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getToken)((0, utils_1.eToNative)(token), amount),
            (0, utils_1.getLabel)('on'),
            (0, utils_1.getChain)(chainId),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, recipient)
        ];
    },
    [bridgeNativeToCustomSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeNativeToCustomAbi,
            data: call.data
        });
        const [receiverAddress, customBridgeAddress, , amount] = args;
        // @TODO
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)(viem_1.zeroAddress, amount),
            (0, utils_1.getLabel)('via'),
            (0, utils_1.getAddressVisualization)(customBridgeAddress),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress)
        ];
    },
    [bridgeNativeToL2GasSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeNativeToL2GasAbi,
            data: call.data
        });
        const [receiverAddress, , amount, toChainId] = args;
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)(viem_1.zeroAddress, amount),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getChain)(toChainId),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress)
        ];
    },
    [bridgeNativeToGasLimitSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeNativeToGasLimitAbi,
            data: call.data
        });
        const [receiverAddress, , , , amount, toChainId] = args;
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)(viem_1.zeroAddress, amount),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getChain)(toChainId),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress)
        ];
    },
    [bridgeNativeToRelayerSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeNativeToRelayerAbi,
            data: call.data
        });
        const [receiverAddress, , , toChainId, amount, amountOutMin, , deadline] = args;
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)(viem_1.zeroAddress, amount),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getToken)(viem_1.zeroAddress, amountOutMin),
            (0, utils_1.getLabel)('on'),
            (0, utils_1.getChain)(toChainId),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress),
            (0, utils_1.getDeadline)(deadline)
        ];
    },
    [bridgeNativeToSimpleSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeNativeToSimpleAbi,
            data: call.data
        });
        const [amount, recipient, chainId] = args;
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)(viem_1.zeroAddress, amount),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getChain)(chainId),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, recipient)
        ];
    },
    [bridgeNativeToHopSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeNativeToHopAbi,
            data: call.data
        });
        const [receiverAddress, , amount, toChainId, , amountOutMin, deadline] = args;
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)(viem_1.zeroAddress, amount),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getToken)(viem_1.zeroAddress, amountOutMin),
            (0, utils_1.getLabel)('on'),
            (0, utils_1.getChain)(toChainId),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress),
            (0, utils_1.getDeadline)(deadline)
        ];
    },
    [swapAndBridgeConnextSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: swapAndBridgeConnextAbi,
            data: call.data
        });
        const [, swapData, connextBridgeData] = args;
        const { toChainId: chainId, receiverAddress } = connextBridgeData;
        if (swapData.startsWith(performActionWithInSelector)) {
            const { args: innerArgs } = (0, viem_1.decodeFunctionData)({
                abi: performActionWithInAbi,
                data: swapData
            });
            const [fromToken, toToken, amount, , swapExtraData] = innerArgs;
            let outAmount = 0n;
            if (swapExtraData.startsWith(transformERC20Selector)) {
                const { args: transformArgs } = (0, viem_1.decodeFunctionData)({
                    abi: transformERC20Abi,
                    data: swapExtraData
                });
                outAmount = transformArgs[3];
            }
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(fromToken), amount),
                (0, utils_1.getLabel)('to'),
                ...(chainId
                    ? [
                        (0, utils_1.getTokenWithChain)((0, utils_1.eToNative)(toToken), outAmount, chainId),
                        (0, utils_1.getLabel)('on'),
                        (0, utils_1.getChain)(chainId)
                    ]
                    : [(0, utils_1.getToken)((0, utils_1.eToNative)(toToken), outAmount)]),
                ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress)
            ].filter((x) => x);
        }
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getLabel)('undetected token'),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getLabel)('undetected token'),
            ...(chainId ? [(0, utils_1.getLabel)('on'), (0, utils_1.getChain)(chainId)] : []),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress)
        ].filter((x) => x);
    },
    [swapAndBridgeStargateSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: swapAndBridgeStargateAbi,
            data: call.data
        });
        const [, swapData, acrossBridgeData] = args;
        const { receiverAddress, senderAddress, value, stargateDstChainId, minReceivedAmt } = acrossBridgeData;
        const dstChain = [];
        const tokensData = [];
        if (STARGATE_CHAIN_IDS[stargateDstChainId.toString()])
            dstChain.push((0, utils_1.getLabel)('to'), (0, utils_1.getChain)(STARGATE_CHAIN_IDS[stargateDstChainId.toString()]));
        if (swapData.startsWith(performActionWithInSelector)) {
            const { args: innerArgs } = (0, viem_1.decodeFunctionData)({
                abi: performActionWithInAbi,
                data: swapData
            });
            const [fromToken, toToken, amount] = innerArgs;
            tokensData.push((0, utils_1.getToken)(fromToken, amount), (0, utils_1.getLabel)('to'), (0, utils_1.getToken)(toToken, value));
        }
        return [
            (0, utils_1.getAction)('Bridge'),
            ...tokensData,
            ...dstChain,
            ...(0, utils_1.getRecipientText)(senderAddress, receiverAddress)
        ];
    },
    [swapAndBridgeStargateV2Selector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: swapAndBridgeStargateV2Abi,
            data: call.data
        });
        const [, swapData, stargateBridgeData] = args;
        const { toChainId, receiver, minAmountLD } = stargateBridgeData;
        const dstChain = [];
        const tokensData = [];
        if (swapData.startsWith(performActionWithInSelector)) {
            const { args: innerArgs } = (0, viem_1.decodeFunctionData)({
                abi: performActionWithInAbi,
                data: swapData
            });
            const [fromToken, toToken, amount] = innerArgs;
            tokensData.push((0, utils_1.getToken)(fromToken, amount), (0, utils_1.getLabel)('to'), (0, utils_1.getToken)(toToken, minAmountLD));
        }
        return [
            (0, utils_1.getAction)('Bridge'),
            ...tokensData,
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getChain)(toChainId),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiver)
        ];
    },
    [swapAndBridgeHopSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: swapAndBridgeHopAbi,
            data: call.data
        });
        const [, swapData, hopData] = args;
        const { receiverAddress, toChainId, amountOutMinDestination, deadlineDestination } = hopData;
        const tokensData = [];
        if (swapData.startsWith(performActionWithInSelector)) {
            const { args: innerArgs } = (0, viem_1.decodeFunctionData)({
                abi: performActionWithInAbi,
                data: swapData
            });
            const [fromToken, toToken, amount] = innerArgs;
            tokensData.push((0, utils_1.getToken)(fromToken, amount), (0, utils_1.getLabel)('to'), (0, utils_1.getToken)(toToken, amountOutMinDestination));
        }
        return [
            (0, utils_1.getAction)('Bridge'),
            ...tokensData,
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getChain)(toChainId),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress),
            (0, utils_1.getDeadline)(deadlineDestination)
        ];
    },
    [swapAndBridgeHopL1Selector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: swapAndBridgeHopL1Abi,
            data: call.data
        });
        const [, swapData, hopData] = args;
        const { receiverAddress, toChainId, amountOutMin, deadline } = hopData;
        const tokensData = [];
        if (swapData.startsWith(performActionWithInSelector)) {
            const { args: innerArgs } = (0, viem_1.decodeFunctionData)({
                abi: performActionWithInAbi,
                data: swapData
            });
            const [fromToken, toToken, amount, , swapExtraData] = innerArgs;
            if (swapExtraData.startsWith(swapWithDescSelector)) {
                const { args: swapArgs } = (0, viem_1.decodeFunctionData)({
                    abi: swapWithDescAbi,
                    data: swapExtraData
                });
                const [, desc] = swapArgs;
                const { srcToken, dstToken, amount: amount2, minReturnAmount } = desc;
                tokensData.push((0, utils_1.getToken)(srcToken, amount2), (0, utils_1.getLabel)('to'), (0, utils_1.getToken)(dstToken, minReturnAmount));
            }
            else {
                tokensData.push((0, utils_1.getToken)(fromToken, amount), (0, utils_1.getLabel)('to'), (0, utils_1.getToken)(toToken, amountOutMin));
            }
        }
        return [
            (0, utils_1.getAction)('Bridge'),
            ...tokensData,
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getChain)(toChainId),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress),
            (0, utils_1.getDeadline)(deadline)
        ];
    },
    [bridgeERC20ToHopSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeERC20ToHopAbi,
            data: call.data
        });
        const [receiverAddress, token, , amount, toChainId, hopBridgeRequestData] = args;
        const { amountOutMinDestination, deadlineDestination, deadline } = hopBridgeRequestData;
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)(token, amount),
            (0, utils_1.getLabel)('for at least'),
            (0, utils_1.getToken)(token, amountOutMinDestination),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getChain)(toChainId),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress),
            (0, utils_1.getDeadline)(deadline)
        ];
    },
    [bridgeERC20ToStargateV2Selector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeERC20ToStargateV2Abi,
            data: call.data
        });
        const [token, amount, stargateBridgeData] = args;
        const { toChainId, receiver } = stargateBridgeData;
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)(token, amount),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getChain)(toChainId),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiver)
        ];
    },
    [bridgeNativeToStargateV2Selector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeNativeToStargateV2Abi,
            data: call.data
        });
        const [amount, stargateBridgeData] = args;
        const { toChainId, receiver } = stargateBridgeData;
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)(viem_1.zeroAddress, amount),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getChain)(toChainId),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiver)
        ];
    },
    [bridgeNativeToStargateV2WithApprovalSelector]: (accountOp, call) => {
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: bridgeNativeToStargateV2WithApprovalAbi,
            data: call.data
        });
        const [amount, stargateBridgeData] = args;
        const { toChainId, receiver } = stargateBridgeData;
        return [
            (0, utils_1.getAction)('Bridge'),
            (0, utils_1.getToken)(viem_1.zeroAddress, amount),
            (0, utils_1.getLabel)('to'),
            (0, utils_1.getChain)(toChainId),
            ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiver)
        ];
    }
};
const SocketModule = (accountOp, call) => {
    if (!call.to)
        return call;
    if (!(0, utils_1.isHexCall)(call))
        return call;
    let dataToUse = call.data;
    if (call.data.startsWith(executeControllerSelector)) {
        const { args } = (0, viem_1.decodeFunctionData)({ abi: executeControllerAbi, data: call.data });
        const [socketControllerRequest] = args;
        dataToUse = socketControllerRequest.data;
        if (dataToUse.startsWith(takeFeeAndSwapAndBridgeSelector)) {
            const { args: fsbArgs } = (0, viem_1.decodeFunctionData)({
                abi: takeFeeAndSwapAndBridgeAbi,
                data: dataToUse
            });
            const [fsbRequest] = fsbArgs;
            const { swapData, bridgeData } = fsbRequest;
            const swapMatcher = matcher[swapData.slice(0, 10)];
            const humanizationOfSwap = swapMatcher
                ? swapMatcher(accountOp, { ...call, data: swapData })
                : [(0, utils_1.getAction)('Swap')];
            let humanizationOfBridge = [(0, utils_1.getAction)('Bridge')];
            try {
                const [decoded] = (0, viem_1.decodeAbiParameters)((0, viem_1.parseAbiParameters)('(address[] senderReceiverAddresses, address[] inputOutputTokens, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata)'), bridgeData);
                const [, receiver] = decoded.senderReceiverAddresses;
                const [tokenIn] = decoded.inputOutputTokens;
                const [, chainId] = decoded.outputAmountToChainIdArray;
                const [, deadline] = decoded.quoteAndDeadlineTimeStamps;
                humanizationOfBridge = [
                    (0, utils_1.getAction)('Bridge'),
                    (0, utils_1.getToken)(tokenIn, 0n),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getChain)(chainId),
                    ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiver),
                    (0, utils_1.getDeadline)(deadline)
                ];
            }
            catch (e) {
                console.log(e);
            }
            return {
                ...call,
                fullVisualization: [...humanizationOfSwap, (0, utils_1.getLabel)('and'), ...humanizationOfBridge]
            };
        }
        if (dataToUse.startsWith(takeFeesAndSwapSelector)) {
            const { args: ftsArgs } = (0, viem_1.decodeFunctionData)({ abi: takeFeesAndSwapAbi, data: dataToUse });
            const [ftsRequest] = ftsArgs;
            dataToUse = ftsRequest.swapRequestData;
        }
        else if (dataToUse.startsWith(takeFeesAndBridgeSelector)) {
            const { args: ftbArgs } = (0, viem_1.decodeFunctionData)({ abi: takeFeesAndBridgeAbi, data: dataToUse });
            const [ftbRequest] = ftbArgs;
            dataToUse = ftbRequest.bridgeRequestData;
        }
    }
    else {
        const stripped = `0x${dataToUse.slice(10)}`;
        if (!(0, viem_1.isHex)(stripped))
            return call;
        dataToUse = stripped;
    }
    const callMatcher = matcher[dataToUse.slice(0, 10)];
    if (callMatcher) {
        return { ...call, fullVisualization: callMatcher(accountOp, { ...call, data: dataToUse }) };
    }
    return call;
};
exports.SocketModule = SocketModule;
//# sourceMappingURL=socketModules.js.map