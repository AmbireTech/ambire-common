import { SiweMessage } from 'viem/siwe'

import {
  AutoLoginPolicy,
  AutoLoginSettings,
  AutoLoginStatus,
  IAutoLoginController
} from '../../interfaces/autoLogin'
import { Statuses } from '../../interfaces/eventEmitter'
import { Key } from '../../interfaces/keystore'
import { IStorageController } from '../../interfaces/storage'
import EventEmitter from '../eventEmitter/eventEmitter'

const DEFAULT_ALLOWED_RESOURCES = ['TODO']
export const STATUS_WRAPPED_METHODS = {
  revokePolicy: 'INITIAL'
} as const

export class AutoLoginController extends EventEmitter implements IAutoLoginController {
  #storage: IStorageController

  #settings: AutoLoginSettings = {
    enabled: true
  }

  initialLoadPromise?: Promise<void>

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  policies: AutoLoginPolicy[] = []

  constructor(storage: IStorageController) {
    super()
    this.#storage = storage

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  static isExpiredPolicy(policy: AutoLoginPolicy): boolean {
    return Date.now() > policy.defaultExpiration
  }

  static isPolicyMatchingDomainAndUri(parsedSiwe: SiweMessage, policy: AutoLoginPolicy): boolean {
    return policy.domain === parsedSiwe.domain && parsedSiwe.uri.startsWith(policy.uriPrefix)
  }

  async #load() {
    this.policies = await this.#storage.get('autoLoginPolicies', this.policies)
    this.#settings = await this.#storage.get('autoLoginSettings', this.#settings)

    this.emitUpdate()
  }

  #createOrUpdatePolicyFromSiwe(parsedSiwe: SiweMessage): AutoLoginPolicy {
    const existingPolicy = this.policies.find((p) =>
      AutoLoginController.isPolicyMatchingDomainAndUri(parsedSiwe, p)
    )

    if (!existingPolicy) {
      const newPolicy: AutoLoginPolicy = {
        domain: parsedSiwe.domain,
        uriPrefix: parsedSiwe.uri,
        allowedChains: parsedSiwe.chainId ? [parsedSiwe.chainId] : [],
        allowedResources:
          parsedSiwe.resources && parsedSiwe.resources.length > 0
            ? parsedSiwe.resources
            : DEFAULT_ALLOWED_RESOURCES,
        // @TODO: consider when to set to true
        supportsEIP6492: false,
        defaultExpiration: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days from now
      }

      this.policies.push(newPolicy)

      return newPolicy
    }

    if (existingPolicy && !existingPolicy.allowedChains.includes(parsedSiwe.chainId)) {
      existingPolicy.allowedChains.push(parsedSiwe.chainId)
    }

    return existingPolicy
  }

  #getPolicyStatus(
    parsedSiwe: SiweMessage,
    accountKeys: Key[]
  ): 'no-policy' | 'expired' | 'valid-policy' | 'unsupported' {
    // All resources are allowed by the wallet
    if (
      parsedSiwe.resources &&
      parsedSiwe.resources.length > 0 &&
      parsedSiwe.resources.every((r) => DEFAULT_ALLOWED_RESOURCES.includes(r))
    ) {
      return 'valid-policy'
    }

    const policy = this.policies.find((p) => {
      if (!AutoLoginController.isPolicyMatchingDomainAndUri(parsedSiwe, p)) return false

      if (parsedSiwe.chainId && !p.allowedChains.includes(parsedSiwe.chainId)) return false

      // Either all resources must be present and be a subset of the allowed resources,
      // or no resources should be present at all
      if (!parsedSiwe.resources || parsedSiwe.resources.length === 0) return true

      return parsedSiwe.resources.every((resource) => p.allowedResources.includes(resource))
    })

    if (!policy) return 'no-policy'

    if (AutoLoginController.isExpiredPolicy(policy)) return 'expired'

    if (accountKeys.find((k) => k.type !== 'internal') && !policy.supportsEIP6492)
      return 'unsupported'

    return 'valid-policy'
  }

  async revokePolicy(policyDomain: string, policyUriPrefix: string) {
    await this.withStatus('revokePolicy', async () => {
      this.policies = this.policies.filter(
        (p) => !(p.domain === policyDomain && p.uriPrefix === policyUriPrefix)
      )

      await this.#storage.set('autoLoginPolicies', this.policies)
    })
  }

  async onSiweMessageSigned(parsedSiwe: SiweMessage): Promise<AutoLoginPolicy> {
    const policy = this.#createOrUpdatePolicyFromSiwe(parsedSiwe)
    await this.#storage.set('autoLoginPolicies', this.policies)
    this.emitUpdate()

    return policy
  }

  autoLogin(parsedSiwe: SiweMessage, accountKeys: Key[]): AutoLoginStatus {
    const policyStatus = this.#getPolicyStatus(parsedSiwe, accountKeys)

    switch (policyStatus) {
      case 'valid-policy':
        return 'active'
      case 'no-policy':
        return 'no-policy'
      case 'unsupported':
        return 'unsupported'
      case 'expired':
        return 'expired'
      default:
        throw new Error('Unrecognized policy status')
    }
  }
}
