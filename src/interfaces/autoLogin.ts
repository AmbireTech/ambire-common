import { ControllerInterface } from './controller'

/**
 * Represents an auto-login policy configuration for SIWE (Sign-In with Ethereum) authentication.
 */
type AutoLoginPolicy = {
  /**
   * The exact domain that must match the SIWE domain.
   * @example "example.com"
   */
  domain: string
  /**
   * The required prefix for SIWE URIs. All SIWE URIs must start with this value.
   * @example "https://example.com/"
   */
  uriPrefix: string
  /**
   * List of allowed blockchain network chain IDs.
   * @example [1]
   */
  allowedChains: number[]
  /**
   * Exact set of allowed resource URIs for authentication.
   * @example ["https://example.com/login"]
   */
  allowedResources: string[]
  /**
   * Indicates whether EIP-6492 signature validation is supported.
   * Required for smooth user experience when using hardware wallets.
   */
  supportsEIP6492: boolean
  /**
   * Default policy expiration time in seconds.
   * @example 2592000
   */
  defaultExpiration: number
  /**
   * Timestamp of the last successful authentication using this policy.
   * (the last time the wallet auto-signed a SIWE message for this policy)
   */
  lastAuthenticated: number
}

type AutoLoginPoliciesByAccount = {
  [account: string]: AutoLoginPolicy[]
}

type AutoLoginSettings = {
  enabled: boolean
  duration: number
}

/**
 * The status of the SIWE message validity.
 * - `valid`: The SIWE message is valid and meets all criteria.
 * - `invalid`: The SIWE message is invalid due to non-critical issues (e.g., expired).
 * - `invalid-critical`: The SIWE message is invalid due to critical issues (e.g., malformed, domain mismatch). In this
 * case the app may be trying to trick the user into signing something dangerous.
 * - `domain-mismatch`: The SIWE message domain does not match the expected domain.
 */
type SiweValidityStatus = 'valid' | 'invalid' | 'invalid-critical' | 'domain-mismatch'

type AutoLoginStatus = 'active' | 'unsupported' | 'expired' | 'no-policy'

type IAutoLoginController = ControllerInterface<
  InstanceType<typeof import('../controllers/autoLogin/autoLogin').AutoLoginController>
>

export type {
  IAutoLoginController,
  AutoLoginPolicy,
  AutoLoginPoliciesByAccount,
  AutoLoginSettings,
  AutoLoginStatus,
  SiweValidityStatus
}
