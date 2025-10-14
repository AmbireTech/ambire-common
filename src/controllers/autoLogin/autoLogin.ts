import { toUtf8String } from 'ethers'
import { parseSiweMessage, SiweMessage, validateSiweMessage } from 'viem/siwe'

import { IAccountsController } from '../../interfaces/account'
import {
  AutoLoginPoliciesByAccount,
  AutoLoginPolicy,
  AutoLoginSettings,
  AutoLoginStatus,
  IAutoLoginController
} from '../../interfaces/autoLogin'
import { Statuses } from '../../interfaces/eventEmitter'
import { IInviteController } from '../../interfaces/invite'
import { ExternalSignerControllers, IKeystoreController, Key } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
import { PlainTextMessage } from '../../interfaces/userRequest'
import EventEmitter from '../eventEmitter/eventEmitter'
import { SignMessageController } from '../signMessage/signMessage'

export const STATUS_WRAPPED_METHODS = {
  revokePolicy: 'INITIAL'
} as const

/**
 * A list of resources allowed by default. Users will auto-login
 * without signing a message if all requested resources are in this list.
 */
const DEFAULT_ALLOWED_RESOURCES: string[] = []

export class AutoLoginController extends EventEmitter implements IAutoLoginController {
  #storage: IStorageController

  settings: AutoLoginSettings = {
    enabled: true
  }

  #signMessage: SignMessageController

  initialLoadPromise?: Promise<void>

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

  policiesByAccount: AutoLoginPoliciesByAccount = {}

  constructor(
    storage: IStorageController,
    keystore: IKeystoreController,
    providers: IProvidersController,
    networks: INetworksController,
    accounts: IAccountsController,
    externalSignerControllers: ExternalSignerControllers,
    invite: IInviteController
  ) {
    super()
    this.#storage = storage
    this.#signMessage = new SignMessageController(
      keystore,
      providers,
      networks,
      accounts,
      externalSignerControllers,
      invite
    )

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  static isExpiredPolicy(policy: AutoLoginPolicy): boolean {
    return Date.now() > policy.defaultExpiration
  }

  static getParsedSiweMessage(message: string | `0x${string}`): SiweMessage | null {
    const messageString = message.startsWith('0x') ? toUtf8String(message) : message

    const parsedSiweMessage = parseSiweMessage(messageString)

    if (
      !validateSiweMessage({
        ...parsedSiweMessage,
        message: parsedSiweMessage
      })
    )
      return null

    return parsedSiweMessage as SiweMessage
  }

  static isPolicyMatchingDomainAndUri(parsedSiwe: SiweMessage, policy: AutoLoginPolicy): boolean {
    return policy.domain === parsedSiwe.domain && parsedSiwe.uri.startsWith(policy.uriPrefix)
  }

  async #load() {
    this.policiesByAccount = await this.#storage.get('autoLoginPolicies', this.policiesByAccount)
    this.settings = await this.#storage.get('autoLoginSettings', this.settings)

    this.emitUpdate()
  }

  #createOrUpdatePolicyFromSiwe(parsedSiwe: SiweMessage): AutoLoginPolicy {
    const accountAddress = parsedSiwe.address
    if (!this.policiesByAccount[accountAddress]) {
      this.policiesByAccount[accountAddress] = []
    }

    const accountPolicies = this.policiesByAccount[accountAddress]
    const existingPolicy = accountPolicies.find((p) =>
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

      this.policiesByAccount[accountAddress].push(newPolicy)

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

    const accountPolicies = this.policiesByAccount[parsedSiwe.address] || []

    const policy = accountPolicies.find((p) => {
      if (!AutoLoginController.isPolicyMatchingDomainAndUri(parsedSiwe, p)) return false

      if (parsedSiwe.chainId && !p.allowedChains.includes(parsedSiwe.chainId)) return false

      // Either all resources must be present and be a subset of the allowed resources,
      // or no resources should be present at all
      if (!parsedSiwe.resources || parsedSiwe.resources.length === 0) return true

      return parsedSiwe.resources.every((resource) => p.allowedResources.includes(resource))
    })

    // @TODO: This will always be false if the policy doesn't exist??? Maybe we should
    // store the flag somewhere else
    if (accountKeys.find((k) => k.type !== 'internal') && !policy?.supportsEIP6492)
      return 'unsupported'

    if (!policy) return 'no-policy'

    if (AutoLoginController.isExpiredPolicy(policy)) return 'expired'

    return 'valid-policy'
  }

  async revokePolicy(accountAddress: string, policyDomain: string, policyUriPrefix: string) {
    await this.withStatus('revokePolicy', async () => {
      const accountPolicies = this.policiesByAccount[accountAddress] || []

      if (accountPolicies.length === 0) return

      this.policiesByAccount[accountAddress] = accountPolicies.filter(
        (p) => !(p.domain === policyDomain && p.uriPrefix === policyUriPrefix)
      )

      await this.#storage.set('autoLoginPolicies', this.policiesByAccount)
    })
  }

  async onSiweMessageSigned(
    parsedSiwe: SiweMessage,
    isAutoLoginEnabledByUser: boolean
  ): Promise<AutoLoginPolicy | null> {
    if (!isAutoLoginEnabledByUser) {
      console.log('Debug: Auto-login not enabled by user, skipping policy creation')
      return null
    }

    const policy = this.#createOrUpdatePolicyFromSiwe(parsedSiwe)
    console.log('Debug: Created/updated auto-login policy', policy)
    await this.#storage.set('autoLoginPolicies', this.policiesByAccount)
    this.emitUpdate()

    return policy
  }

  getAutoLoginStatus(parsedSiwe: SiweMessage, accountKeys: Key[]): AutoLoginStatus {
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

  async autoLogin({
    messageToSign,
    accountKeys
  }: {
    messageToSign: {
      accountAddr: string
      chainId: bigint
      message: PlainTextMessage['message']
    }
    accountKeys: Key[]
  }) {
    await this.#signMessage.init({
      messageToSign: {
        accountAddr: messageToSign.accountAddr,
        chainId: messageToSign.chainId,
        content: {
          kind: 'message',
          message: messageToSign.message
        },
        fromActionId: 'siwe-auto-login',
        signature: null
      }
    })

    const key = accountKeys.find((k) => k.type === 'internal')

    if (!key) throw new Error('No internal key available for signing')

    this.#signMessage.setSigningKey(key.addr, key.type)

    await this.#signMessage.sign()

    return this.#signMessage.signedMessage
  }
}
