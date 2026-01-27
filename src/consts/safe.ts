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
 * We support Safe accounts that are at least v1.3 or above.
 * The reason for that is prior version have different addresses
 * on different chains. Since Ambire is chain-agnostic, we cannot
 * expect to handle accounts with different cross-chain addresses
 */
export const SAFE_SMALLEST_SUPPORTED_V = '1.3'

/**
 * Information about safe contract addresses by their versions
 */
const vOneFourOne = {
  singleton: '0x41675C099F32341bf84BFc5382aF534df5C7461a'
}
