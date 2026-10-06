/**
 * A non-exclusive list of networks that Safe accounts are supported on.
 * We will use this list to know where to search for Safe accounts
 * and in accordance with the enabled user networks
 */
export const SAFE_NETWORKS = [
  1, 10, 56, 100, 130, 137, 143, 146, 480, 999, 5000, 8453, 9745, 42161, 42220, 43114, 57073, 59144,
  747474, 4326, 8217, 4663, 534352, 5042
]

export const SAFE_API_TIMEOUT_MS = 15000

export const SAFE_DEPLOYMENT_UNAVAILABLE_MESSAGE =
  "We can't activate this Safe account on this network. To use it here, activate it in the Safe app first."

// Keep Safe Transaction Service requests below its bulk request limits.
export const SAFE_API_BATCH_SIZE = 4

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
 * This is the latest contract and it's safe to use across versions
 */
export const multiSendAddr = '0x9641d764fc13c8B624c04430C7356C1C7C8102e2'

export const safeNullOwner = '0x0000000000000000000000000000000000000002'

export const allowedMulticallContracts = [
  multiSendAddr,
  '0xA83c336B20401Af773B6219BA5027174338D1836',
  '0x40A2aCCbd92BCA938b02010E17A5b8929b49130D',
  '0xA1dabEF33b3B82c7814B6D82A79e50F4AC44102B',
  '0x8D29bE29923b68abfDD21e541b9374737B49cdAD'
]

/**
 * Known default Safe fallback handler addresses (CompatibilityFallbackHandler).
 * Any other fallback handler (e.g. an ExtensibleFallbackHandler used to register
 * per-domain EIP-1271 signature verifiers) can change how the Safe validates
 * signatures and should be flagged for user review.
 */
export const allowedFallbackHandlers = [
  '0xf48f2B2d2a534e402487b3ee7C18c33Aec0Fe5e4', // CompatibilityFallbackHandler v1.3.0
  '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99' // CompatibilityFallbackHandler v1.4.1
]

/**
 * Canonical Safe v1.4.1 contracts used to create new Safe accounts. They share the same
 * address on all SAFE_NETWORKS, so a new Safe gets the same counterfactual address everywhere.
 * https://github.com/safe-global/safe-deployments/tree/main/src/assets/v1.4.1
 */
export const SAFE_V1_4_1 = {
  /**
   * SafeL2 emits events for every executed txn, which the Safe Transaction Service
   * needs to index the Safe on L2s. It's used on all networks, incl. Ethereum, so the
   * singleton is the same everywhere and so is the counterfactual address
   */
  singletonL2: '0x29fcB43b46531BcA003ddC8FCB67FFE91900C762',
  proxyFactory: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
  compatibilityFallbackHandler: '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99',
  /**
   * The result of proxyCreationCode() on the v1.4.1 SafeProxyFactory - the SafeProxy
   * creation bytecode. Hardcoded so the counterfactual address is derived without an RPC call
   */
  proxyCreationCode:
    '0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f7669646564'
} as const
