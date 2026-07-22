/**
 * A non-exclusive list of networks that Safe accounts are supported on.
 * We will use this list to know where to search for Safe accounts
 * and in accordance with the enabled user networks
 */
export const SAFE_NETWORKS = [
  1, 10, 56, 100, 130, 137, 143, 146, 480, 999, 5000, 8453, 9745, 42161, 42220, 43114, 57073, 59144,
  747474, 4326, 8217, 4663, 534352
]

export const SAFE_API_TIMEOUT_MS = 10000

/**
 * Information about Safe contract addresses by their versions
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

/**
 * SimulateTxAccessor addresses by Safe version.
 */
export const safeSimulateTxAccessor = {
  ['v1.3.0']: '0x59AD6735bCd8152B84860Cb256dD9e96b85F69Da',
  ['v1.4.1']: '0x3d4BA2E0884aa488718476ca2FB8Efc291A46199',
  ['v1.5.0']: '0x07EfA797c55B5DdE3698d876b277aBb6B893654C'
}

export const execTransactionAbi = [
  'function execTransaction(address to,uint256 value,bytes calldata data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address payable refundReceiver,bytes memory signatures)'
]
/**
 * In order to do batching, Safe needs an extra contract helper called multisend
 * This is the latest contract and it's Safe to use across versions
 */
export const multiSendAddr = '0x9641d764fc13c8B624c04430C7356C1C7C8102e2'

/**
 * In order to do batching, Safe needs an extra contract helper called multisend
 * This is the latest contract and it's Safe to use across versions
 */
export const safeNullOwner = '0x0000000000000000000000000000000000000002'

export const allowedMulticallContracts = [
  multiSendAddr,
  '0xA83c336B20401Af773B6219BA5027174338D1836',
  '0x40A2aCCbd92BCA938b02010E17A5b8929b49130D',
  '0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B',
  '0x8D29bE29923b68abfDD21e541b9374737B49cdAD'
]
