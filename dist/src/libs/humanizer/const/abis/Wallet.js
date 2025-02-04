export const StakingPool = [
    'function ADXToken() view returns (address)',
    'function ADXUSDOracle() view returns (address)',
    'function DOMAIN_SEPARATOR() view returns (bytes32)',
    'function PERMIT_TYPEHASH() view returns (bytes32)',
    'function allowance(address owner, address spender) view returns (uint256 remaining)',
    'function approve(address spender, uint256 amount) returns (bool success)',
    'function balanceOf(address owner) view returns (uint256 balance)',
    'function claim(address tokenOut, address to, uint256 amount)',
    'function commitments(bytes32) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function enter(uint256 amount)',
    'function enterTo(address recipient, uint256 amount)',
    'function governance() view returns (address)',
    'function guardian() view returns (address)',
    'function leave(uint256 shares, bool skipMint)',
    'function limitLastReset() view returns (uint256)',
    'function limitRemaining() view returns (uint256)',
    'function lockedShares(address) view returns (uint256)',
    'function maxDailyPenaltiesPromilles() view returns (uint256)',
    'function name() view returns (string)',
    'function nonces(address) view returns (uint256)',
    'function penalize(uint256 adxAmount)',
    'function permit(address owner, address spender, uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
    'function rageLeave(uint256 shares, bool skipMint)',
    'function rageReceivedPromilles() view returns (uint256)',
    'function setDailyPenaltyMax(uint256 max)',
    'function setGovernance(address addr)',
    'function setGuardian(address newGuardian)',
    'function setRageReceived(uint256 rageReceived)',
    'function setTimeToUnbond(uint256 time)',
    'function setWhitelistedClaimToken(address token, bool whitelisted)',
    'function shareValue() view returns (uint256)',
    'function symbol() view returns (string)',
    'function timeToUnbond() view returns (uint256)',
    'function totalSupply() view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool success)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool success)',
    'function unbondingCommitmentWorth(address owner, uint256 shares, uint256 unlocksAt) view returns (uint256)',
    'function uniswap() view returns (address)',
    'function validator() view returns (address)',
    'function whitelistedClaimTokens(address) view returns (bool)',
    'function withdraw(uint256 shares, uint256 unlocksAt, bool skipMint)'
];
//# sourceMappingURL=Wallet.js.map