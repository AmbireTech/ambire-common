import { parseAbi } from 'viem'

// The fragments below come from the verified ABI of the Base deployment at
// https://basescan.org/address/0x4D28D900e381eCE4B351302f1Abe588496793A2b#code.
const blueBundlesV1Structs = [
  'struct MarketParams { address loanToken; address collateralToken; address oracle; address irm; uint256 lltv; }',
  'struct Signature { uint8 v; bytes32 r; bytes32 s; }',
  'struct SignedAuthorization { Signature signature; uint256 nonce; uint256 deadline; }',
  'struct TokenPermit { uint8 kind; bytes data; }',
  'struct PublicAllocations { address vault; address adapter; MarketParams marketParams; bool fromIdle; address sourceAdapter; MarketParams sourceMarketParams; uint128 assets; uint64 penalty; }'
] as const

/** Supply-collateral-and-borrow ABI from the verified Base BlueBundlesV1 deployment. */
export const blueBundlesV1SupplyCollateralAndBorrowAbi = parseAbi([
  ...blueBundlesV1Structs,
  'function blueBundlesV1SupplyCollateralAndBorrow(MarketParams marketParams, uint256 collateralAssets, uint256 borrowAssets, uint256 maxLtv, TokenPermit collateralPermit, SignedAuthorization signedAuthorization, PublicAllocations[] reallocations, uint256 referralFeePct, address referralFeeRecipient, uint256 deadline) payable'
])

/** Repay-and-withdraw-collateral ABI from the verified Base BlueBundlesV1 deployment. */
export const blueBundlesV1RepayAndWithdrawCollateralAbi = parseAbi([
  ...blueBundlesV1Structs,
  'function blueBundlesV1RepayAndWithdrawCollateral(MarketParams marketParams, uint256 repayAssets, uint256 repayShares, uint256 maxRepayAssets, uint256 collateralAssets, uint256 maxLtv, TokenPermit loanTokenPermit, SignedAuthorization signedAuthorization, uint256 referralFeePct, address referralFeeRecipient, uint256 deadline) payable'
])

/** Loan-asset supply ABI from the verified Base BlueBundlesV1 deployment. */
export const blueBundlesV1SupplyAbi = parseAbi([
  ...blueBundlesV1Structs,
  'function blueBundlesV1Supply(MarketParams marketParams, uint256 assets, TokenPermit loanTokenPermit, uint256 referralFeePct, address referralFeeRecipient, uint256 deadline) payable'
])

/** Loan-asset withdrawal ABI from the verified Base BlueBundlesV1 deployment. */
export const blueBundlesV1WithdrawAbi = parseAbi([
  ...blueBundlesV1Structs,
  'function blueBundlesV1Withdraw(MarketParams marketParams, uint256 withdrawAssets, uint256 withdrawShares, SignedAuthorization signedAuthorization, PublicAllocations[] reallocations, uint256 referralFeePct, address referralFeeRecipient, uint256 deadline)'
])

/** Borrowing-position migration ABI from the verified Base BlueBundlesV1 deployment. */
export const blueBundlesV1MigrateBorrowPositionAbi = parseAbi([
  ...blueBundlesV1Structs,
  'function blueBundlesV1MigrateBorrowPosition(MarketParams sourceMarketParams, MarketParams destMarketParams, uint256 maxLtv, SignedAuthorization signedAuthorization, PublicAllocations[] reallocations, uint256 referralFeePct, address referralFeeRecipient, uint256 deadline)'
])
