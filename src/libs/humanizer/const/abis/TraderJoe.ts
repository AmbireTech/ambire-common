export const JoeRouter = [
  'function addLiquidity(tuple(address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],address,address,uint256)) returns (uint256,uint256,uint256,uint256,uint256[],uint256[])',
  'function addLiquidityNATIVE(tuple(address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,int256[],uint256[],uint256[],address,address,uint256)) payable returns (uint256,uint256,uint256,uint256,uint256[],uint256[])',
  'function createLBPair(address,address,uint24,uint16) returns (address)',
  'function getFactory() view returns (address)',
  'function getFactoryV2_1() view returns (address)',
  'function getIdFromPrice(address,uint256) view returns (uint24)',
  'function getLegacyFactory() view returns (address)',
  'function getLegacyRouter() view returns (address)',
  'function getPriceFromId(address,uint24) view returns (uint256)',
  'function getSwapIn(address,uint128,bool) view returns (uint128,uint128,uint128)',
  'function getSwapOut(address,uint128,bool) view returns (uint128,uint128,uint128)',
  'function getV1Factory() view returns (address)',
  'function getWNATIVE() view returns (address)',
  'function removeLiquidity(address,address,uint16,uint256,uint256,uint256[],uint256[],address,uint256) returns (uint256,uint256)',
  'function removeLiquidityNATIVE(address,uint16,uint256,uint256,uint256[],uint256[],address,uint256) returns (uint256,uint256)',
  'function swapExactNATIVEForTokens(uint256 amountOutMin,(uint256[],uint8[],address[]) path,address to,uint256 deadline) payable returns (uint256)',
  'function swapExactNATIVEForTokensSupportingFeeOnTransferTokens(uint256,tuple(uint256[],uint8[],address[]),address,uint256) payable returns (uint256)',
  'function swapExactTokensForNATIVE(uint256 amountIn,uint256 amountOutMinNATIVE,tuple(uint256[],uint8[],address[]) path,address to,uint256 deadline) returns (uint256)',
  'function swapExactTokensForNATIVESupportingFeeOnTransferTokens(uint256,uint256,tuple(uint256[],uint8[],address[]),address,uint256) returns (uint256)',
  'function swapExactTokensForTokens(uint256 amountIn,uint256 amountOutMin,tuple(uint256[],uint8[],address[]) path,address to,uint256 deadline) returns (uint256)',
  'function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256,uint256,tuple(uint256[],uint8[],address[]),address,uint256) returns (uint256)',
  'function swapNATIVEForExactTokens(uint256 amountOut,tuple(uint256[],uint8[],address[]) path,address to,uint256 deadline) payable returns (uint256[])',
  'function swapTokensForExactNATIVE(uint256 amountNATIVEOut,uint256 amountInMax,tuple(uint256[],uint8[],address[]) path,address to,uint256 deadline) returns (uint256[])',
  'function swapTokensForExactTokens(uint256 amountOut,uint256 amountInMax,tuple(uint256[],uint8[],address[]) path,address to,uint256 deadline) returns (uint256[])',
  'function sweep(address,address,uint256)',
  'function sweepLBToken(address,address,uint256[],uint256[])',
  'receive() payable'
]
