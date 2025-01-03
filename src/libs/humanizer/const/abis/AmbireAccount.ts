export const AmbireAccount = [
  // executable by address(this)
  'function tryCatch(address to, uint256 value, bytes calldata data)',
  'function tryCatchLimit(address to, uint256 value, bytes calldata data, uint256 gasLimit)',
  'function executeBySelfSingle((address to, uint256 value, bytes data) call)',
  'function executeBySelf((address to, uint256 value, bytes data)[] calls)',
  // executed with signature
  'function execute((address to, uint256 value, bytes data)[] calls, bytes signature) payable',
  'function executeMultiple(((address to, uint256 value, bytes data)[] calls, bytes signature)[] toExec) payable',
  // executable by signer
  'function executeBySender((address to, uint256 value, bytes data)[] calls) payable'
]
