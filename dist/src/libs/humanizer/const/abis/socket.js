"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketViaAcross = void 0;
exports.SocketViaAcross = [
    // 'constructor(address _spokePool, address _wethAddress, address _socketGateway, address _socketDeployFactory)',
    'error OnlySocketGatewayOwner()',
    'event NativeBridgeFee(uint256 fee)',
    'event SocketBridge(uint256 amount, address token, uint256 toChainId, bytes32 bridgeName, address sender, address receiver, bytes32 metadata)',
    'function ACROSS_ERC20_EXTERNAL_BRIDGE_FUNCTION_SELECTOR() view returns (bytes4)',
    'function ACROSS_NATIVE_EXTERNAL_BRIDGE_FUNCTION_SELECTOR() view returns (bytes4)',
    'function ACROSS_SWAP_BRIDGE_SELECTOR() view returns (bytes4)',
    'function AcrossIdentifier() view returns (bytes32)',
    'function BRIDGE_AFTER_SWAP_SELECTOR() view returns (bytes4)',
    'function NATIVE_TOKEN_ADDRESS() view returns (address)',
    'function WETH() view returns (address)',
    'function bridgeAfterSwap(uint256 amount, bytes bridgeData) payable',
    'function bridgeERC20To(uint256 amount, (address[] senderReceiverAddresses, address[] inputOutputTokens, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData) payable',
    'function rescueEther(address userAddress, uint256 amount)',
    'function rescueFunds(address token, address userAddress, uint256 amount)',
    'function socketDeployFactory() view returns (address)',
    'function socketGateway() view returns (address)',
    'function socketRoute() view returns (address)',
    'function spokePool() view returns (address)',
    'function spokePoolAddress() view returns (address)',
    'function swapAndBridge(uint32 swapId, bytes swapData, (address[] senderReceiverAddresses, address outputToken, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData) payable',
    'function swapAndBridge(uint32,address,uint256,bytes32,bytes)',
    'function swapAndBridge(uint32 swapId, bytes swapData, (address receiverAddress, uint64 toChainId, uint32 maxSlippage, uint64 nonce, bytes32 metadata) celerBridgeData) payable',
    'function swapAndBridge(uint32 swapId, bytes swapData, (address receiverAddress, address hopAMM, uint256 toChainId, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 amountOutMinDestination, uint256 deadlineDestination, bytes32 metadata) hopData) payable',
    'function swapAndBridge(uint32 swapId, bytes swapData, (address receiverAddress, address l1bridgeAddr, address relayer, uint256 toChainId, uint256 amountOutMin, uint256 relayerFee, uint256 deadline, bytes32 metadata) hopData) payable',
    'function swapAndBridge(uint32 swapId, bytes swapData, tuple(uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)',
    'function swapAndBridge(uint32 swapId, bytes calldata swapData, tuple (address receiverAddress,address senderAddress,uint256 value,uint256 srcPoolId,uint256 dstPoolId,uint256 minReceivedAmt,uint256 destinationGasLimit,bool isNativeSwapRequired,uint16 stargateDstChainId,uint32 swapId,bytes swapData,bytes32 metadata,bytes destinationPayload) acrossBridgeData) payable',
    'function swapAndBridge(uint32 swapId, bytes swapData, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable',
    'function bridgeNativeTo(uint256 amount, (address[] senderReceiverAddresses, address outputToken, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData) payable',
    'function bridgeNativeTo(address receiverAddress, uint32 l2Gas, uint256 amount, uint256 toChainId, bytes32 metadata, bytes32 bridgeHash, bytes data) payable',
    'function bridgeNativeTo(address receiverAddress, uint256 gasLimit, uint256 fees, bytes32 metadata, uint256 amount, uint256 toChainId, bytes32 bridgeHash) payable',
    'function bridgeNativeTo(address receiverAddress, address l1bridgeAddr, address relayer, uint256 toChainId, uint256 amount, uint256 amountOutMin, uint256 relayerFee, uint256 deadline, bytes32 metadata) payable',
    'function bridgeNativeTo(address receiverAddress, address customBridgeAddress, uint32 l2Gas, uint256 amount, bytes32 metadata, bytes data)',
    'function bridgeNativeTo(uint256 amount, bytes32 metadata, address receiverAddress, uint256 toChainId, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) originQuery, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) destinationQuery) payable',
    'function bridgeNativeTo(uint256,address,uint256,bytes32)',
    'function bridgeNativeTo(address receiverAddress, address hopAMM, uint256 amount, uint256 toChainId, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 amountOutMinDestination, uint256 deadlineDestination, bytes32 metadata) payable',
    'function bridgeNativeTo(address senderAddress, address receiverAddress, uint256 amount, (uint256 srcPoolId, uint256 dstPoolId, uint256 destinationGasLimit, uint256 minReceivedAmt, uint256 value, uint16 stargateDstChainId, uint32 swapId, bytes32 metadata, bytes swapData, bytes destinationPayload) stargateBridgeExtraData) payable',
    'function bridgeNativeTo(uint256 amount, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable',
    'function bridgeERC20To(address receiverAddress, address token, address hopAMM, uint256 amount, uint256 toChainId, (uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 amountOutMinDestination, uint256 deadlineDestination, bytes32 metadata) hopBridgeRequestData)',
    'function bridgeERC20To(address token, uint256 amount, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable'
];
//# sourceMappingURL=socket.js.map