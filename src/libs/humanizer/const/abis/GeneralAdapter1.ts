export const GeneralAdapter1 = [
  'function erc20TransferFrom(address token, address receiver, uint256 amount)',
  'function wrapNative(uint256 amount, address receiver)',
  'function unwrapNative(uint256 amount, address receiver)',
  'function morphoSupplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) calldata marketParams,uint256 assets,address onBehalf,bytes calldata data)',
  'function morphoBorrow((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) calldata marketParams,uint256 assets,uint256 shares,uint256 minSharePriceE27,address receiver)',
  'function morphoRepay((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) calldata marketParams,uint256 assets,uint256 shares,uint256 maxSharePriceE27,address onBehalf,bytes calldata data)',
  'function morphoWithdrawCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) calldata marketParams, uint256 assets, address receiver)',
  'function permit2TransferFrom(address token, address receiver, uint256 amount)',
  'function morphoFlashLoan(address token, uint256 assets, bytes calldata data)',
  'function erc4626Mint(address vault, uint256 shares, uint256 maxSharePriceE27, address receiver)',
  'function erc4626Deposit(address vault, uint256 assets, uint256 maxSharePriceE27, address receiver)',
  'function erc4626Redeem(address vault, uint256 shares, uint256 minSharePriceE27, address receiver, address owner)',
  'function erc4626Withdraw(address vault, uint256 assets, uint256 minSharePriceE27, address receiver, address owner)',

  // done but from CoreAdapter.sol, inherit
  'function erc20Transfer(address token, address receiver, uint256 amount)',
  'function nativeTransfer(address receiver, uint256 amount)',

  // todo
  'function morphoSupply((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) calldata marketParams,uint256 assets,uint256 shares,uint256 maxSharePriceE27,address onBehalf,bytes calldata data)',
  'function morphoWithdraw((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) calldata marketParams,uint256 assets,uint256 shares,uint256 minSharePriceE27,address receiver)'
]
