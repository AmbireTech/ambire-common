const ERROR_PREFIX = '0x08c379a0'
const PANIC_ERROR_PREFIX = '0x4e487b71'
const CONTRACT_ERRORS = [
  'caller is a contract',
  'contract not allowed',
  'contract not supported',
  'No contractz allowed',
  /* no */ 'contracts allowed',
  /* c or C */ 'ontract is not allowed'
]

// Signature of TransactionDeadlinePassed
const EXPIRED_PREFIX = '0x5bf6f916'

export { ERROR_PREFIX, PANIC_ERROR_PREFIX, CONTRACT_ERRORS, EXPIRED_PREFIX }
