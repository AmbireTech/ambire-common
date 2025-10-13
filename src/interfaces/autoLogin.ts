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
}

type AutoLoginSettings = {
  enabled: boolean
}

type AutoLoginStatus = 'active' | 'unsupported' | 'expired' | 'no-policy'

type IAutoLoginController = ControllerInterface<
  InstanceType<typeof import('../controllers/autoLogin/autoLogin').AutoLoginController>
>

export type { IAutoLoginController, AutoLoginPolicy, AutoLoginSettings, AutoLoginStatus }
