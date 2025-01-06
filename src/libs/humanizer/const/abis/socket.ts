export const SocketViaAcross = [
  'function bridgeAfterSwap(uint256 amount, bytes bridgeData) payable',
  'function rescueEther(address userAddress, uint256 amount)',
  'function rescueFunds(address token, address userAddress, uint256 amount)',

  // old bridgeNativeTo
  'function bridgeNativeTo(uint256 amount, (address[] senderReceiverAddresses, address outputToken, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData) payable',
  'function bridgeNativeTo(address receiverAddress, uint32 l2Gas, uint256 amount, uint256 toChainId, bytes32 metadata, bytes32 bridgeHash, bytes data) payable',
  'function bridgeNativeTo(address receiverAddress, uint256 gasLimit, uint256 fees, bytes32 metadata, uint256 amount, uint256 toChainId, bytes32 bridgeHash) payable',
  'function bridgeNativeTo(address receiverAddress, address l1bridgeAddr, address relayer, uint256 toChainId, uint256 amount, uint256 amountOutMin, uint256 relayerFee, uint256 deadline, bytes32 metadata) payable',
  'function bridgeNativeTo(address receiverAddress, address customBridgeAddress, uint32 l2Gas, uint256 amount, bytes32 metadata, bytes data)',
  'function bridgeNativeTo(uint256 amount, bytes32 metadata, address receiverAddress, uint256 toChainId, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) originQuery, (address swapAdapter, address tokenOut, uint256 minAmountOut, uint256 deadline, bytes rawParams) destinationQuery) payable',
  'function bridgeNativeTo(uint256,address,uint256,bytes32)',
  'function bridgeNativeTo(address receiverAddress, address hopAMM, uint256 amount, uint256 toChainId, uint256 bonderFee, uint256 amountOutMin, uint256 deadline, uint256 amountOutMinDestination, uint256 deadlineDestination, bytes32 metadata) payable',
  'function bridgeNativeTo(address senderAddress, address receiverAddress, uint256 amount, (uint256 srcPoolId, uint256 dstPoolId, uint256 destinationGasLimit, uint256 minReceivedAmt, uint256 value, uint16 stargateDstChainId, uint32 swapId, bytes32 metadata, bytes swapData, bytes destinationPayload) stargateBridgeExtraData) payable',
  // new bridgeNativeTo
  'function bridgeNativeTo(bytes32,address,uint256,(bytes,bytes,address[],address,address,uint256,bool,address,bytes))',
  'function bridgeNativeTo(uint256,(address,address,uint256,uint256,address,bytes32,uint256,bytes,bytes))',
  'function bridgeNativeTo(uint256,(address[],address,uint256[],uint32[],bytes32))',
  'function bridgeNativeTo(uint256,(uint32,uint256,address,bytes,bytes,(uint256,uint256),bytes32,uint256,address,bytes,uint32,bool))',
  'function bridgeNativeTo(uint256,uint256,bytes32,address,uint32,int64)',

  // old bridgeERC20To
  'function bridgeERC20To(uint256 amount, (address[] senderReceiverAddresses, address[] inputOutputTokens, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData) payable',
  'function bridgeERC20To(uint256,bytes32,address,address,uint256,uint32,uint256)',
  'function bridgeERC20To(uint256 amount, (uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address token, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)',

  // new bridgeERC20To
  'function bridgeERC20To((uint256,address,uint256,uint256,bytes,uint256,address,bool,bytes32))',
  'function bridgeERC20To(address,address,address,uint256,(uint256,uint256,uint256,uint256,uint256,uint16,uint32,bytes32,bytes,bytes))',
  'function bridgeERC20To(address,address,address,uint256,uint256,(uint256,uint256,uint256,uint256,uint256,bytes32))',
  'function bridgeERC20To(address,uint256,(uint32,uint256,address,bytes,bytes,(uint256,uint256),bytes32,uint256,address,bytes,uint32,bool))',
  'function bridgeERC20To(bytes32,address,address,uint256,(bytes,bytes,address[],address,address,uint256,bool,address,bytes))',
  'function bridgeERC20To(uint256,(address,address,uint256,uint256,address,address,bytes32,uint256,bytes,bytes))',
  'function bridgeERC20To(uint256,(address[],address[],uint256[],uint32[],bytes32))',
  'function bridgeERC20To(uint256,bytes32,address,address,uint256,(address,address,uint256,uint256,bytes),(address,address,uint256,uint256,bytes))',
  'function bridgeERC20To(uint256,uint256,bytes32,address,address,uint32,int64)',

  // old swapAndBridge
  'function swapAndBridge(uint32 swapId, bytes swapData, (address[] senderReceiverAddresses, address outputToken, uint256[] outputAmountToChainIdArray, uint32[] quoteAndDeadlineTimeStamps, uint256 bridgeFee, bytes32 metadata) acrossBridgeData) payable',
  'function swapAndBridge(uint32,address,uint256,bytes32,bytes)',
  'function swapAndBridge(uint32 swapId, bytes swapData, tuple(uint256 toChainId, uint256 slippage, uint256 relayerFee, uint32 dstChainDomain, address receiverAddress, bytes32 metadata, bytes callData, address delegate) connextBridgeData)',
  'function swapAndBridge(uint32 swapId, bytes calldata swapData, tuple (address receiverAddress,address senderAddress,uint256 value,uint256 srcPoolId,uint256 dstPoolId,uint256 minReceivedAmt,uint256 destinationGasLimit,bool isNativeSwapRequired,uint16 stargateDstChainId,uint32 swapId,bytes swapData,bytes32 metadata,bytes destinationPayload) acrossBridgeData) payable',
  'function swapAndBridge(uint32 swapId, bytes swapData, (uint32 dstEid, uint256 minAmountLD, address stargatePoolAddress, bytes destinationPayload, bytes destinationExtraOptions, (uint256 nativeFee, uint256 lzTokenFee) messagingFee, bytes32 metadata, uint256 toChainId, address receiver, bytes swapData, uint32 swapId, bool isNativeSwapRequired) stargateBridgeData) payable',

  // new swapAndBridge
  'function swapAndBridge(uint32,bytes,(address,address,uint256,uint256,address,bytes32,uint256,bytes,bytes))',
  'function swapAndBridge(uint32,bytes,(address,address,uint256,uint256,uint256,uint256,uint256,uint256,bytes32))',
  'function swapAndBridge(uint32,bytes,(address,uint256,bytes32,(address,address,uint256,uint256,bytes),(address,address,uint256,uint256,bytes)))',
  'function swapAndBridge(uint32,bytes,(address,uint32,uint256,uint256,bytes32))',
  'function swapAndBridge(uint32,bytes,(address[],address,uint256[],uint32[],bytes32))',
  'function swapAndBridge(uint32,bytes,(uint256,address,uint256,uint256,bytes,uint256,address,bool,bytes32))',
  'function swapAndBridge(uint32,bytes,(uint256,address,uint32,int64,bytes32))',
  'function swapAndBridge(uint32,bytes,bytes32,address,uint256,(bytes,bytes,address[],address,address,uint256,bool,address,bytes))'
]
