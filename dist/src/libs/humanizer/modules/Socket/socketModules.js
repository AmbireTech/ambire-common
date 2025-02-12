"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketModule = void 0;
/* eslint-disable @typescript-eslint/no-unused-vars */
const ethers_1 = require("ethers");
const abis_1 = require("../../const/abis");
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
// @TODO check all additional data provided
// @TODO consider fees everywhere
// @TODO add automated tests
const SocketModule = (accountOp, irCalls) => {
    const preControllerIface = new ethers_1.Interface([
        'function executeController((uint32 controllerId, bytes data) socketControllerRequest)',
        'function takeFeesAndSwap((address feesTakerAddress, address feesToken, uint256 feesAmount, uint32 routeId, bytes swapRequestData) ftsRequest) payable returns (bytes)',
        'function takeFeesAndBridge((address feesTakerAddress, address feesToken, uint256 feesAmount, uint32 routeId, bytes bridgeRequestData) ftbRequest) payable returns (bytes)',
        // @TODO
        'function takeFeeAndSwapAndBridge((address feesTakerAddress, address feesToken, uint256 feesAmount, uint32 swapRouteId, bytes swapData, uint32 bridgeRouteId, bytes bridgeData) fsbRequest)'
    ]);
    const iface = new ethers_1.Interface([
        ...abis_1.SocketViaAcross,
        // @TODO move to more appropriate place all funcs
        'function performAction(address fromToken, address toToken, uint256 amount, address receiverAddress, bytes32 metadata, bytes swapExtraData) payable returns (uint256)',
        'function performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData) payable returns (uint256, address)',
        'function bridgeERC20To(uint256,bytes32,address,address,uint256,uint32,uint256)',
        'function bridgeERC20To(uint256 amount, (uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address token, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)',
        'function transformERC20(address inputToken, address outputToken, uint256 inputTokenAmount, uint256 minOutputTokenAmount, (uint32,bytes)[] transformations)',
        'function swapAndBridge(uint32 swapId, bytes swapData, tuple(uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)',
        'function swapAndBridge(uint32 swapId, bytes calldata swapData, tuple (address receiverAddress,address senderAddress,uint256 value,uint256 srcPoolId,uint256 dstPoolId,uint256 minReceivedAmt,uint256 destinationGasLimit,bool isNativeSwapRequired,uint16 stargateDstChainId,uint32 swapId,bytes swapData,bytes32 metadata,bytes destinationPayload) acrossBridgeData) payable',
        'function swapAndBridge(uint32 swapId, bytes swapData, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable',
        'function swap(address,(address,address,address,address,uint256,uint256,uint256),bytes,bytes)',
        'function swap(address caller, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 guaranteedAmount, uint256 flags, address referrer, bytes permit) desc, (uint256 target, uint256 gasLimit, uint256 value, bytes data)[] calls) payable returns (uint256 returnAmount)',
        'function exec(address,address,uint256,address,bytes)',
        'function execute((address recipient, address buyToken, uint256 minAmountOut) slippage, bytes[] actions, bytes32) payable returns (bool)',
        'function uniswapV3SwapTo(address,uint256,uint256,uint256[])',
        'function BASIC(address,uint256,address,uint256,bytes)',
        'function UNISWAPV3(address,uint256,bytes,uint256)'
    ]);
    const matcher = {
        [`${iface.getFunction('swapAndBridge(uint32 swapId, bytes swapData, tuple(address[] senderReceiverAddresses,address outputToken,uint256[] outputAmountToChainIdArray,uint32[] quoteAndDeadlineTimeStamps,uint256 bridgeFee,bytes32 metadata) acrossBridgeData)')?.selector}`]: (call) => {
            const { 
            // swapId,
            swapData, acrossBridgeData: { senderReceiverAddresses: [senderAddress, recipientAddress], outputToken, outputAmountToChainIdArray: [outputAmount, dstChain], quoteAndDeadlineTimeStamps
            // bridgeFee,
            // metadata
             } } = iface.parseTransaction(call).args;
            if (swapData.startsWith(iface.getFunction('performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData) payable returns (uint256, address)')?.selector)) {
                const { fromToken, amount, toToken } = iface.parseTransaction({
                    data: swapData
                }).args;
                return [
                    (0, utils_1.getAction)('Bridge'),
                    (0, utils_1.getToken)((0, utils_1.eToNative)(fromToken), amount),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getTokenWithChain)((0, utils_1.eToNative)(toToken), outputAmount),
                    (0, utils_1.getLabel)('on'),
                    (0, utils_1.getChain)(dstChain),
                    (0, utils_1.getDeadline)(quoteAndDeadlineTimeStamps[1]),
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
                (0, utils_1.getDeadline)(quoteAndDeadlineTimeStamps[1]),
                ...(0, utils_1.getRecipientText)(senderAddress, recipientAddress)
            ];
        },
        [`${iface.getFunction('swapAndBridge(uint32 swapId, bytes swapData, (address receiverAddress, uint64 toChainId, uint32 maxSlippage, uint64 nonce, bytes32 metadata) celerBridgeData) payable')?.selector}`]: (call) => {
            const { swapId, swapData, celerBridgeData: { receiverAddress, toChainId, maxSlippage, nonce, metadata } } = iface.parseTransaction(call).args;
            if (swapData.startsWith(iface.getFunction('performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData) payable returns (uint256, address)')?.selector)) {
                const { fromToken, amount, toToken } = iface.parseTransaction({
                    data: swapData
                }).args;
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
        [`${iface.getFunction('swapAndBridge(uint32,address,uint256,bytes32,bytes)')?.selector}`]: (call) => {
            const [, , chainId, , data] = iface.parseTransaction(call).args;
            if (data.startsWith(iface.getFunction('performActionWithIn').selector)) {
                const { fromToken, toToken, amount, swapExtraData } = iface.parseTransaction({
                    ...call,
                    data
                }).args;
                if (swapExtraData.startsWith(iface.getFunction('transformERC20').selector)) {
                    const { minOutputTokenAmount } = iface.parseTransaction({
                        ...call,
                        data: swapExtraData
                    }).args;
                    return [
                        (0, utils_1.getAction)('Bridge'),
                        (0, utils_1.getToken)(fromToken, amount),
                        (0, utils_1.getLabel)('to'),
                        (0, utils_1.getToken)(toToken, minOutputTokenAmount, false, chainId),
                        (0, utils_1.getLabel)('on'),
                        (0, utils_1.getChain)(chainId)
                    ];
                }
                return [
                    (0, utils_1.getAction)('Bridge'),
                    (0, utils_1.getToken)(fromToken, amount),
                    (0, utils_1.getLabel)('to'),
                    (0, utils_1.getToken)(toToken, 0n, false, chainId),
                    (0, utils_1.getLabel)('on'),
                    (0, utils_1.getChain)(chainId)
                ];
            }
            return [(0, utils_1.getAction)('Bridge'), (0, utils_1.getLabel)('to'), (0, utils_1.getChain)(chainId)];
        },
        [`${iface.getFunction('bridgeNativeTo(uint256 amount, (address[] senderReceiverAddresses, address outputToken, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData)')?.selector}`]: (call) => {
            const [amount, [[sender, receiver], outputToken, [outputAmount, chainId], quoteAndDeadlineTimeStamps
            // @TODO
            // bridgeFee
            ]] = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getTokenWithChain)((0, utils_1.eToNative)(outputToken), outputAmount, chainId),
                (0, utils_1.getLabel)('on'),
                (0, utils_1.getChain)(chainId),
                (0, utils_1.getDeadline)(quoteAndDeadlineTimeStamps[1]),
                ...(0, utils_1.getRecipientText)(sender, receiver)
            ];
        },
        [`${iface.getFunction('bridgeNativeTo(address senderAddress, address receiverAddress, uint256 amount, (uint256 srcPoolId, uint256 dstPoolId, uint256 destinationGasLimit, uint256 minReceivedAmt, uint256 value, uint16 stargateDstChainId, uint32 swapId, bytes32 metadata, bytes swapData, bytes destinationPayload) stargateBridgeExtraData)')?.selector}`]: (call) => {
            const { senderAddress, receiverAddress, amount, stargateBridgeExtraData: { minReceivedAmt, stargateDstChainId } } = iface.parseTransaction(call).args;
            const chainId = STARGATE_CHAIN_IDS[stargateDstChainId.toString()];
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getTokenWithChain)(ethers_1.ZeroAddress, minReceivedAmt),
                (0, utils_1.getLabel)('on'),
                (0, utils_1.getChain)(chainId),
                ...(0, utils_1.getRecipientText)(senderAddress, receiverAddress)
            ];
        },
        [`${iface.getFunction('performAction(address fromToken, address toToken, uint256 amount, address receiverAddress, bytes32 metadata, bytes swapExtraData)')?.selector}`]: (call) => {
            // eslint-disable-next-line prefer-const
            let { fromToken, toToken, amount, receiverAddress, swapExtraData, metadata } = iface.parseTransaction(call).args;
            let outAmount = 0n;
            if (swapExtraData.startsWith(iface.getFunction('performAction(address fromToken, address toToken, uint256 amount, address receiverAddress, bytes32 metadata, bytes swapExtraData)')?.selector)) {
                outAmount = iface.parseTransaction({ data: swapExtraData }).args[3];
            }
            else if (swapExtraData.startsWith(iface.getFunction('swap(address,(address,address,address,address,uint256,uint256,uint256),bytes,bytes)')?.selector)) {
                const [randAddress, [token1, token2, randAddress2, recipient, amount1, amount2], bytes1, bytes2] = iface.parseTransaction({ data: swapExtraData }).args;
                outAmount = amount2;
            }
            else if (swapExtraData.startsWith(iface.getFunction('transformERC20(address,address,uint256,uint256,(uint32,bytes)[])')
                .selector)) {
                const params = iface.parseTransaction({ data: swapExtraData }).args;
                outAmount = params[3];
            }
            else if (swapExtraData.startsWith(iface.getFunction('exec')?.selector)) {
                const [, , , , extraData] = iface.parseTransaction({
                    data: swapExtraData
                }).args;
                if (extraData.startsWith(iface.getFunction('execute')?.selector)) {
                    // eslint-disable-next-line prefer-const
                    let [[, , minAmountOut], actions] = iface.parseTransaction({
                        data: extraData
                    }).args;
                    if (!minAmountOut) {
                        const uniswapData = actions.find((i) => i.startsWith(iface.getFunction('UNISWAPV3')?.selector));
                        if (uniswapData) {
                            ;
                            [, , , minAmountOut] = iface.parseTransaction({ data: uniswapData }).args;
                        }
                    }
                    outAmount = minAmountOut;
                }
            }
            else if (swapExtraData.startsWith(iface.getFunction('uniswapV3SwapTo')?.selector)) {
                const [address, amount1, amount2] = iface.parseTransaction({
                    data: swapExtraData
                }).args;
                outAmount = amount2;
            }
            else if (swapExtraData.startsWith(iface.getFunction('function swap(address caller, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 guaranteedAmount, uint256 flags, address referrer, bytes permit) desc, (uint256 target, uint256 gasLimit, uint256 value, bytes data)[] calls) payable returns (uint256 returnAmount)')?.selector)) {
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
                 } } = iface.parseTransaction({
                    data: swapExtraData
                }).args;
                outAmount = minReturnAmount;
            }
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(fromToken), amount),
                (0, utils_1.getLabel)(outAmount ? 'for at least' : 'for'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(toToken), outAmount),
                ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress)
            ];
        },
        [`${iface.getFunction('performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData) payable returns (uint256, address)')?.selector}`]: (call) => {
            // eslint-disable-next-line prefer-const
            let { fromToken, toToken, amount, metadata, swapExtraData } = iface.parseTransaction(call).args;
            let outAmount = 0n;
            if (swapExtraData.startsWith(iface.getFunction('performAction(address fromToken, address toToken, uint256 amount, address receiverAddress, bytes32 metadata, bytes swapExtraData)')?.selector)) {
                outAmount = iface.parseTransaction({ data: swapExtraData }).args[3];
            }
            else if (swapExtraData.startsWith(iface.getFunction('swap(address,(address,address,address,address,uint256,uint256,uint256),bytes,bytes)')?.selector)) {
                const [randAddress, [token1, token2, randAddress2, recipient, amount1, amount2], bytes1, bytes2] = iface.parseTransaction({ data: swapExtraData }).args;
                outAmount = amount2;
            }
            else if (swapExtraData.startsWith(iface.getFunction('transformERC20(address,address,uint256,uint256,(uint32,bytes)[])')
                .selector)) {
                const params = iface.parseTransaction({ data: swapExtraData }).args;
                outAmount = params[3];
            }
            else if (swapExtraData.startsWith(iface.getFunction('exec')?.selector)) {
                const [, , , , extraData] = iface.parseTransaction({
                    data: swapExtraData
                }).args;
                if (extraData.startsWith(iface.getFunction('execute')?.selector)) {
                    // eslint-disable-next-line prefer-const
                    let [[, , minAmountOut], actions] = iface.parseTransaction({
                        data: extraData
                    }).args;
                    if (!minAmountOut) {
                        const uniswapData = actions.find((i) => i.startsWith(iface.getFunction('UNISWAPV3')?.selector));
                        if (uniswapData) {
                            ;
                            [, , , minAmountOut] = iface.parseTransaction({ data: uniswapData }).args;
                        }
                    }
                    outAmount = minAmountOut;
                }
            }
            else if (swapExtraData.startsWith(iface.getFunction('uniswapV3SwapTo')?.selector)) {
                const [address, amount1, amount2] = iface.parseTransaction({
                    data: swapExtraData
                }).args;
                outAmount = amount2;
            }
            else if (swapExtraData.startsWith(iface.getFunction('function swap(address caller, (address srcToken, address dstToken, address srcReceiver, address dstReceiver, uint256 amount, uint256 minReturnAmount, uint256 guaranteedAmount, uint256 flags, address referrer, bytes permit) desc, (uint256 target, uint256 gasLimit, uint256 value, bytes data)[] calls) payable returns (uint256 returnAmount)')?.selector)) {
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
                 } } = iface.parseTransaction({
                    data: swapExtraData
                }).args;
                outAmount = minReturnAmount;
            }
            return [
                (0, utils_1.getAction)('Swap'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(fromToken), amount),
                (0, utils_1.getLabel)(outAmount ? 'for at least' : 'for'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(toToken), outAmount)
            ];
        },
        [`${iface.getFunction('bridgeERC20To(uint256 amount, (address[] senderReceiverAddresses, address[] inputOutputTokens, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData)')?.selector}`]: (call) => {
            const { amount, acrossBridgeData: { senderReceiverAddresses: [sender, receiver], inputOutputTokens: [inputToken, outputToken], outputAmountToChainIdArray: [outputAmount, chainId] } } = iface.parseTransaction(call).args;
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
        [`${iface.getFunction('bridgeERC20To(uint256 amount, (uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address token, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)')?.selector}`]: (call) => {
            const { amount, connextBridgeData: { toChainId, dstChainDomain, token, receiverAddress, metadata, callData, delegate } } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)((0, utils_1.eToNative)(token), amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getChain)(toChainId),
                ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress)
            ];
        },
        [`${iface.getFunction('bridgeNativeTo(uint256 amount, bytes32 metadata, address receiverAddress, uint256 toChainId, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) originQuery, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) destinationQuery)')?.selector}`]: (call) => {
            const { amount, metadata, receiverAddress, toChainId, originQuery: { tokenOut, minAmountOut, deadline }, destinationQuery // : { swapAdapter, tokenOut, minAmountOut, deadline, rawParams }
             } = iface.parseTransaction(call).args;
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
        [`${iface.getFunction('bridgeERC20To(uint256,bytes32,address,address,uint256,uint32,uint256)')
            ?.selector}`]: (call) => {
            const [amount, id, recipient, token, chainId, unknown1, fee] = iface.parseTransaction(call).args;
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
        [`${iface.getFunction('bridgeNativeTo(address receiverAddress, address customBridgeAddress, uint32 l2Gas, uint256 amount, bytes32 metadata, bytes data)')?.selector}`]: (call) => {
            const { receiverAddress, customBridgeAddress, l2Gas, amount, metadata, data } = iface.parseTransaction(call).args;
            // @TODO
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amount),
                (0, utils_1.getLabel)('via'),
                (0, utils_1.getAddressVisualization)(customBridgeAddress),
                ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress)
            ];
        },
        [`${iface.getFunction('bridgeNativeTo(address receiverAddress, uint32 l2Gas, uint256 amount, uint256 toChainId, bytes32 metadata, bytes32 bridgeHash, bytes data)')?.selector}`]: (call) => {
            const { receiverAddress, l2Gas, amount, toChainId, metadata, bridgeHash, data } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getChain)(toChainId),
                ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress)
            ];
        },
        [`${iface.getFunction('bridgeNativeTo(address receiverAddress, uint256 gasLimit, uint256 fees, bytes32 metadata, uint256 amount, uint256 toChainId, bytes32 bridgeHash)')?.selector}`]: (call) => {
            const { receiverAddress, gasLimit, fees, metadata, amount, toChainId, bridgeHash } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getChain)(toChainId),
                ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress)
            ];
        },
        [`${iface.getFunction('bridgeNativeTo(address receiverAddress, address l1bridgeAddr, address relayer, uint256 toChainId, uint256 amount, uint256 amountOutMin, uint256 relayerFee, uint256 deadline, bytes32 metadata) payable')?.selector}`]: (call) => {
            const { receiverAddress, l1bridgeAddr, toChainId, amount, amountOutMin, relayerFee, deadline, metadata } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amountOutMin),
                (0, utils_1.getLabel)('on'),
                (0, utils_1.getChain)(toChainId),
                ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [`${iface.getFunction('bridgeNativeTo(uint256,address,uint256,bytes32)')?.selector}`]: (call) => {
            const [amount, recipient, chainId, metadata] = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getChain)(chainId),
                ...(0, utils_1.getRecipientText)(accountOp.accountAddr, recipient)
            ];
        },
        [`${iface.getFunction('function bridgeNativeTo(address receiverAddress, address hopAMM, uint256 amount, uint256 toChainId, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 amountOutMinDestination, uint256 deadlineDestination, bytes32 metadata) payable')?.selector}`]: (call) => {
            const { receiverAddress, hopAMM, amount, toChainId, bonderFee, amountOutMin, deadline, amountOutMinDestination, deadlineDestination, metadata } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getToken)(ethers_1.ZeroAddress, amountOutMin),
                (0, utils_1.getLabel)('on'),
                (0, utils_1.getChain)(toChainId),
                ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiverAddress),
                (0, utils_1.getDeadline)(deadline)
            ];
        },
        [`${iface.getFunction('swapAndBridge(uint32 swapId, bytes swapData, tuple(uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)')?.selector}`]: (call) => {
            const { swapData, connextBridgeData: { chainId, slippage, relayerFee, dstChainDomain, receiverAddress, metadata, callData, delegate } } = iface.parseTransaction(call).args;
            if (swapData.startsWith(iface.getFunction('performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData) payable returns (uint256, address)')?.selector)) {
                const { fromToken, toToken, amount, swapExtraData } = iface.parseTransaction({
                    data: swapData
                }).args;
                let outAmount = 0n;
                // @TODO no harcoded sighashes
                if (swapExtraData.startsWith('0x415565b0'))
                    outAmount = iface.parseTransaction({ data: swapExtraData }).args[3];
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
        [`${iface.getFunction('swapAndBridge(uint32 swapId, bytes calldata swapData, tuple (address receiverAddress,address senderAddress,uint256 value,uint256 srcPoolId,uint256 dstPoolId,uint256 minReceivedAmt,uint256 destinationGasLimit,bool isNativeSwapRequired,uint16 stargateDstChainId,uint32 swapId,bytes swapData,bytes32 metadata,bytes destinationPayload) acrossBridgeData)')?.selector}`]: (call) => {
            const { swapId, swapData, acrossBridgeData: { receiverAddress, senderAddress, value, srcPoolId, dstPoolId, minReceivedAmt, destinationGasLimit, isNativeSwapRequired, stargateDstChainId, swapId: innerSwapId, swapData: innerSwapData, metadata, destinationPayload } } = iface.parseTransaction(call).args;
            const dstChain = [];
            const tokensData = [];
            if (STARGATE_CHAIN_IDS[stargateDstChainId])
                dstChain.push((0, utils_1.getLabel)('to'), (0, utils_1.getChain)(STARGATE_CHAIN_IDS[stargateDstChainId]));
            if (swapData.startsWith(iface.getFunction('performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData) payable returns (uint256, address)')?.selector)) {
                const { fromToken, toToken, amount, metadata: newMeta, swapExtraData } = iface.parseTransaction({
                    ...call,
                    data: swapData
                }).args;
                tokensData.push((0, utils_1.getToken)(fromToken, amount), (0, utils_1.getLabel)('to'), (0, utils_1.getToken)(toToken, value));
            }
            return [
                (0, utils_1.getAction)('Bridge'),
                ...tokensData,
                ...dstChain,
                ...(0, utils_1.getRecipientText)(senderAddress, receiverAddress)
            ];
        },
        [`${iface.getFunction('function swapAndBridge(uint32 swapId, bytes swapData, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable')?.selector}`]: (call) => {
            const { swapId, swapData, stargateBridgeData: { dstEid, minAmountLD, stargatePoolAddress, destinationPayload, destinationExtraOptions, messagingFee: { nativeFee, lzTokenFee }, metadata, toChainId, receiver, swapData: InnerSwapData, swapId: InnerSwapId, isNativeSwapRequired } } = iface.parseTransaction(call).args;
            const dstChain = [];
            const tokensData = [];
            if (swapData.startsWith(iface.getFunction('performActionWithIn(address fromToken, address toToken, uint256 amount, bytes32 metadata, bytes swapExtraData) payable returns (uint256, address)')?.selector)) {
                const { fromToken, toToken, amount, metadata: newMeta, swapExtraData } = iface.parseTransaction({
                    ...call,
                    data: swapData
                }).args;
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
        [`${iface.getFunction('bridgeERC20To(address receiverAddress, address token, address hopAMM, uint256 amount, uint256 toChainId, (uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 amountOutMinDestination, uint256 deadlineDestination, bytes32 metadata) hopBridgeRequestData)')?.selector}`]: (call) => {
            const { receiverAddress, token, hopAMM, amount, toChainId, hopBridgeRequestData: { bonderFee, amountOutMin, deadline, amountOutMinDestination, deadlineDestination, metadata } } = iface.parseTransaction(call).args;
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
        [`${iface.getFunction('bridgeERC20To(address token, uint256 amount, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable')?.selector}`]: (call) => {
            const { token, amount, stargateBridgeData: { dstEid, minAmountLD, stargatePoolAddress, destinationPayload, destinationExtraOptions, messagingFee: { nativeFee, lzTokenFee }, metadata, toChainId, receiver, swapData, swapId, isNativeSwapRequired } } = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Bridge'),
                (0, utils_1.getToken)(token, amount),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getChain)(toChainId),
                ...(0, utils_1.getRecipientText)(accountOp.accountAddr, receiver)
            ];
        }
    };
    const newCalls = irCalls.map((call) => {
        let dataToUse = call.data;
        if (call.data.startsWith(preControllerIface.getFunction('executeController').selector)) {
            const [[controllerId, newData]] = preControllerIface.parseTransaction(call).args;
            dataToUse = newData;
            if (dataToUse.startsWith(preControllerIface.getFunction('takeFeeAndSwapAndBridge').selector)) {
                const [[feesTakerAddress, feesToken, feesAmount, swapRouteId, swapData, bridgeRouteId, bridgeData]] = preControllerIface.decodeFunctionData('takeFeeAndSwapAndBridge', dataToUse);
                const humanizationOfSwap = matcher[swapData.slice(0, 10)]
                    ? matcher[swapData.slice(0, 10)]({ ...call, data: swapData })
                    : [(0, utils_1.getAction)('Swap')];
                let humanizationOfBridge = [(0, utils_1.getAction)('Bridge')];
                try {
                    const [[[sender, receiver], [tokenIn, tokenOut], [outputAmount, chainId], [quoteTime, deadline], bridgeFee, metadata]] = new ethers_1.AbiCoder().decode([
                        'tuple(address[] senderReceiverAddresses, address[] inputOutputTokens, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata)'
                    ], bridgeData);
                    humanizationOfBridge = [
                        (0, utils_1.getAction)('Bridge'),
                        (0, utils_1.getToken)(tokenIn, 0n),
                        (0, utils_1.getLabel)('for at least'),
                        (0, utils_1.getTokenWithChain)(tokenOut, outputAmount, chainId),
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
            if (dataToUse.startsWith(preControllerIface.getFunction('takeFeesAndSwap').selector)) {
                const [[feesTakerAddress, feesToken, feesAmount, routeId, swapRequestData]] = preControllerIface.decodeFunctionData('takeFeesAndSwap', dataToUse);
                dataToUse = swapRequestData;
            }
            else if (dataToUse.startsWith(preControllerIface.getFunction('takeFeesAndBridge').selector)) {
                const [[feesTakerAddress, feesToken, feesAmount, routeId, bridgeRequestData]] = preControllerIface.decodeFunctionData('takeFeesAndBridge', dataToUse);
                dataToUse = bridgeRequestData;
            }
        }
        else {
            dataToUse = `0x${dataToUse.slice(10)}`;
        }
        if (matcher[dataToUse.slice(0, 10)]) {
            return {
                ...call,
                fullVisualization: matcher[dataToUse.slice(0, 10)]({ ...call, data: dataToUse })
            };
        }
        return call;
    });
    return newCalls;
};
exports.SocketModule = SocketModule;
//# sourceMappingURL=socketModules.js.map