export const RouteProcessor = [
  'function bentoBox() view returns (address)',
  'function owner() view returns (address)',
  'function pause()',
  'function processRoute(address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOutMin, address to, bytes route) payable returns (uint256 amountOut)',
  'function renounceOwnership()',
  'function resume()',
  'function setPriviledge(address user, bool priviledge)',
  'function transferOwnership(address newOwner)',
  'function transferValueAndprocessRoute(address transferValueTo, uint256 amountValueTransfer, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOutMin, address to, bytes route) payable returns (uint256 amountOut)',
  'function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes data)'
]
