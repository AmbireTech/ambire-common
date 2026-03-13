export const Allowance = [
  'function setAllowance(address delegate, address token, uint96 allowanceAmount, uint16 resetTimeMin, uint32 resetBaseMin)',
  'function deleteAllowance(address delegate, address token)',
  'function executeAllowanceTransfer(address safe, address token, address payable to, uint96 amount, address paymentToken, uint96 payment, address delegate, bytes memory signature)',
  'function addDelegate(address delegate) public',
  'function removeDelegate(address delegate, bool removeAllowances)'
]
