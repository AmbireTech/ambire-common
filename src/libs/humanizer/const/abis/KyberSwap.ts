export const KyberSwap = [
  'function WETH() view returns (address)',
  'function isWhitelist(address) view returns (bool)',
  'function owner() view returns (address)',
  'function renounceOwnership()',
  'function rescueFunds(address,uint256)',
  'function swap(tuple(address callTarget,address approveTarget,bytes targetData,tuple(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes clientData) execution) payable returns (uint256,uint256)',
  'function swapGeneric(tuple(address,address,bytes,tuple(address,address,address[],uint256[],address[],uint256[],address,uint256,uint256,uint256,bytes),bytes)) payable returns (uint256,uint256)',
  'function swapSimpleMode(address caller, tuple(address srcToken,address dstToken,address[] srcReceivers,uint256[] srcAmounts,address[] feeReceivers,uint256[] feeAmounts,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags,bytes permit) desc,bytes executorData,bytes clientData) returns (uint256,uint256)',
  'function transferOwnership(address)',
  'function updateWhitelist(address[],bool[])',
  'receive() payable'
]
