export const WrappedStETH = [
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function decreaseAllowance(address spender, uint256 subtractedValue) returns (bool)',
  'function getStETHByWstETH(uint256 _wstETHAmount) view returns (uint256)',
  'function getWstETHByStETH(uint256 _stETHAmount) view returns (uint256)',
  'function increaseAllowance(address spender, uint256 addedValue) returns (bool)',
  'function name() view returns (string)',
  'function nonces(address owner) view returns (uint256)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'function stETH() view returns (address)',
  'function stEthPerToken() view returns (uint256)',
  'function symbol() view returns (string)',
  'function tokensPerStEth() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function transfer(address recipient, uint256 amount) returns (bool)',
  'function transferFrom(address sender, address recipient, uint256 amount) returns (bool)',
  'function unwrap(uint256 _wstETHAmount) returns (uint256)',
  'function wrap(uint256 _stETHAmount) returns (uint256)'
]

export const unstETH = [
  'function requestWithdrawals(uint256[] _amounts, address _owner) returns (uint256[] requestIds)',
  'function claimWithdrawals(uint256[] calldata _requestIds, uint256[] calldata _hints)',
  'function claimWithdrawalsTo(uint256[] calldata _requestIds, uint256[] calldata _hints, address _recipient)',
  'function claimWithdrawal(uint256 _requestId)'
]

export const stETH = [
  'function totalSupply() view returns (uint256)',
  'function unsafeChangeDepositedValidators(uint256 _newDepositedValidators)',
  'function increaseAllowance(address _spender, uint256 _addedValue) returns (bool)',
  'function receiveELRewards() payable',
  'function transferSharesFrom(address _sender, address _recipient, uint256 _sharesAmount) returns (uint256)',
  'function receiveWithdrawals() payable',
  'function transferShares(address _recipient, uint256 _sharesAmount) returns (uint256)',
  'function submit(address _referral) payable returns (uint256)',
  'function deposit(uint256 _maxDepositsCount, uint256 _stakingModuleId, bytes _depositCalldata)',
  'function permit(address _owner, address _spender, uint256 _value, uint256 _deadline, uint8 _v, bytes32 _r, bytes32 _s)',
]
