/**
 * A non-exclusive list of networks that safe accounts are supported on.
 * We will use this list to know where to search for safe accounts
 * and in accordance with the enabled user networks
 */
export const SAFE_NETWORKS = [
  1, 10, 56, 100, 130, 137, 143, 146, 480, 999, 5000, 8453, 9745, 42161, 42220, 43114, 57073, 59144,
  747474
]

/**
 * Information about safe contract addresses by their versions
 */
const vOneThree = {
  singleton: '0xd9Db270c1B5E3Bd161E8c8503c55cEABeE709552'
}
const vOneFourOne = {
  singleton: '0x41675C099F32341bf84BFc5382aF534df5C7461a'
}
const vOneFive = {
  singleton: '0xFf51A5898e281Db6DfC7855790607438dF2ca44b'
}

export const execTransactionAbi = [
  'function execTransaction(address to,uint256 value,bytes calldata data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address payable refundReceiver,bytes memory signatures)'
]
/**
 * In order to do batching, safe needs an extra contract helper called multisend
 * This is the latest contract and it's safe to use across versions
 */
export const multiSendAddr = '0x218543288004CD07832472D464648173c77D7eB7'

/**
 * In order to do batching, safe needs an extra contract helper called multisend
 * This is the latest contract and it's safe to use across versions
 */
export const safeNullOwner = '0x0000000000000000000000000000000000000002'
