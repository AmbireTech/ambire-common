export const Across = [
  'function EMPTY_RELAYER() view returns (address)',
  'function EMPTY_REPAYMENT_CHAIN_ID() view returns (uint256)',
  'function INFINITE_FILL_DEADLINE() view returns (uint32)',
  'function MAX_TRANSFER_SIZE() view returns (uint256)',
  'function UPDATE_V3_DEPOSIT_DETAILS_HASH() view returns (bytes32)',
  'function __SpokePool_init(uint32,address,address)',
  'function cctpTokenMessenger() view returns (address)',
  'function chainId() view returns (uint256)',
  'function crossDomainAdmin() view returns (address)',
  'function deposit(address recipient,address originToken,uint256 amount,uint256 destinationChainId,int64 relayerFeePct,uint32 quoteTimestamp,bytes memory message,uint256 maxCount) payable',
  'function depositFor(address,address,address,uint256,uint256,int64,uint32,bytes,uint256) payable',
  'function depositQuoteTimeBuffer() view returns (uint32)',
  'function depositV3(address depositor,address recipient,address inputToken,address outputToken,uint256 inputAmount,uint256 outputAmount,uint256 destinationChainId,address exclusiveRelayer,uint32 quoteTimestamp,uint32 fillDeadline,uint32 exclusivityDeadline,bytes calldata message) payable',
  'function depositV3Now(address,address,address,address,uint256,uint256,uint256,address,uint32,uint32,bytes) payable',
  'function emergencyDeleteRootBundle(uint256)',
  'function enabledDepositRoutes(address,uint256) view returns (bool)',
  'function executeRelayerRefundLeaf(uint32,tuple(uint256,uint256,uint256[],uint32,address,address[]),bytes32[]) payable',
  'function executeV3SlowRelayLeaf(tuple(tuple(address,address,address,address,address,uint256,uint256,uint256,uint32,uint32,uint32,bytes),uint256,uint256),uint32,bytes32[])',
  'function fillDeadlineBuffer() view returns (uint32)',
  'function fillStatuses(bytes32) view returns (uint256)',
  'function fillV3Relay(tuple(address,address,address,address,address,uint256,uint256,uint256,uint32,uint32,uint32,bytes),uint256)',
  'function fillV3RelayWithUpdatedDeposit(tuple(address,address,address,address,address,uint256,uint256,uint256,uint32,uint32,uint32,bytes),uint256,uint256,address,bytes,bytes)',
  'function fxChild() view returns (address)',
  'function getCurrentTime() view returns (uint256)',
  'function hubPool() view returns (address)',
  'function initialize(uint32,address,address,address,address)',
  'function multicall(bytes[]) returns (bytes[])',
  'function numberOfDeposits() view returns (uint32)',
  'function pauseDeposits(bool)',
  'function pauseFills(bool)',
  'function pausedDeposits() view returns (bool)',
  'function pausedFills() view returns (bool)',
  'function polygonTokenBridger() view returns (address)',
  'function processMessageFromRoot(uint256,address,bytes)',
  'function proxiableUUID() view returns (bytes32)',
  'function recipientCircleDomainId() view returns (uint32)',
  'function relayRootBundle(bytes32,bytes32)',
  'function requestV3SlowFill(tuple(address,address,address,address,address,uint256,uint256,uint256,uint32,uint32,uint32,bytes))',
  'function rootBundles(uint256) view returns (bytes32,bytes32)',
  'function setCrossDomainAdmin(address)',
  'function setEnableRoute(address,uint256,bool)',
  'function setFxChild(address)',
  'function setHubPool(address)',
  'function setPolygonTokenBridger(address)',
  'function speedUpV3Deposit(address,uint32,uint256,address,bytes,bytes)',
  'function tryMulticall(bytes[]) returns (tuple(bool,bytes)[])',
  'function upgradeTo(address)',
  'function upgradeToAndCall(address,bytes) payable',
  'function usdcToken() view returns (address)',
  'function wrap()',
  'function wrappedNativeToken() view returns (address)',
  'receive() payable'
]
