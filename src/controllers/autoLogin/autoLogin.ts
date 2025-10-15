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
    enabled: true,
    duration: 24 * 60 * 60 * 1000
  }

  #signMessage: SignMessageController

  #policiesByAccount: AutoLoginPoliciesByAccount = {}

  #accounts: IAccountsController

  #keystore: IKeystoreController

  initialLoadPromise?: Promise<void>

  statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> = STATUS_WRAPPED_METHODS

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
    this.#accounts = accounts
    this.#keystore = keystore
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
    if (typeof message !== 'string' || message.trim() === '') return null

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
    this.#policiesByAccount = await this.#storage.get('autoLoginPolicies', this.#policiesByAccount)
    this.settings = await this.#storage.get('autoLoginSettings', this.settings)

    this.emitUpdate()
  }

  #createOrUpdatePolicyFromSiwe(
    parsedSiwe: SiweMessage,
    options: {
      autoLoginDuration: number
    }
  ): AutoLoginPolicy {
    // autoLoginDuration is defined always, but we are fallbacking just in case
    const autoLoginDuration = options.autoLoginDuration || this.settings.duration
    const expirationTime = Date.now() + autoLoginDuration

    const accountAddress = parsedSiwe.address
    if (!this.#policiesByAccount[accountAddress]) {
      this.#policiesByAccount[accountAddress] = []
    }

    const accountPolicies = this.#policiesByAccount[accountAddress]
    const existingPolicy = accountPolicies.find((p) =>
      AutoLoginController.isPolicyMatchingDomainAndUri(parsedSiwe, p)
    )

    // Add a new policy
    if (!existingPolicy) {
      const newPolicy: AutoLoginPolicy = {
        domain: parsedSiwe.domain,
        uriPrefix: parsedSiwe.uri,
        allowedChains: parsedSiwe.chainId ? [parsedSiwe.chainId] : [],
        allowedResources: parsedSiwe.resources || [],
        // @TODO: consider when to set to true
        supportsEIP6492: false,
        defaultExpiration: expirationTime,
        lastAuthenticated: Date.now()
      }

      this.#policiesByAccount[accountAddress].push(newPolicy)

      return newPolicy
    }

    // Update existing policy
    existingPolicy.defaultExpiration = expirationTime
    existingPolicy.lastAuthenticated = Date.now()

    if (!existingPolicy.allowedChains.includes(parsedSiwe.chainId)) {
      existingPolicy.allowedChains.push(parsedSiwe.chainId)
    }

    if (parsedSiwe.resources) {
      existingPolicy.allowedResources = Array.from(
        new Set([...existingPolicy.allowedResources, ...parsedSiwe.resources])
      )
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

    const accountPolicies = this.#policiesByAccount[parsedSiwe.address] || []

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
    if (
      !accountKeys.length ||
      (accountKeys.find((k) => k.type !== 'internal') && !policy?.supportsEIP6492)
    )
      return 'unsupported'

    if (!policy) return 'no-policy'

    if (AutoLoginController.isExpiredPolicy(policy)) return 'expired'

    return 'valid-policy'
  }

  async revokePolicy(accountAddress: string, policyDomain: string, policyUriPrefix: string) {
    await this.initialLoadPromise

    await this.withStatus('revokePolicy', async () => {
      const accountPolicies = this.#policiesByAccount[accountAddress] || []

      if (accountPolicies.length === 0) return

      this.#policiesByAccount[accountAddress] = accountPolicies.filter(
        (p) => !(p.domain === policyDomain && p.uriPrefix === policyUriPrefix)
      )

      await this.#storage.set('autoLoginPolicies', this.#policiesByAccount)
    })
  }

  async onSiweMessageSigned(
    parsedSiwe: SiweMessage,
    isAutoLoginEnabledByUser: boolean,
    autoLoginDuration: number
  ): Promise<AutoLoginPolicy | null> {
    await this.initialLoadPromise

    if (!isAutoLoginEnabledByUser) {
      console.log('Debug: Auto-login not enabled by user, skipping policy creation')
      return null
    }

    const policy = this.#createOrUpdatePolicyFromSiwe(parsedSiwe, { autoLoginDuration })
    console.log('Debug: Created/updated auto-login policy', policy)
    await this.#storage.set('autoLoginPolicies', this.#policiesByAccount)
    this.emitUpdate()

    return policy
  }

  getAutoLoginStatus(parsedSiwe: SiweMessage): AutoLoginStatus {
    const accountData = this.#accounts.accounts.find((a) => a.addr === parsedSiwe.address)

    if (!accountData) throw new Error('Account not found')

    const accountKeys = this.#keystore.getAccountKeys(accountData)

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

  async autoLogin(messageToSign: {
    accountAddr: string
    chainId: bigint
    message: PlainTextMessage['message']
  }) {
    await this.initialLoadPromise

    const accountData = this.#accounts.accounts.find((a) => a.addr === messageToSign.accountAddr)
    if (!accountData) throw new Error('Account not found')

    const accountKeys = this.#keystore.getAccountKeys(accountData)

    const key = accountKeys.find((k) => k.type === 'internal')

    if (!key) throw new Error('No internal key available for signing')

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

    this.#signMessage.setSigningKey(key.addr, key.type)

    await this.#signMessage.sign()

    return this.#signMessage.signedMessage
  }

  getAccountPolicyForOrigin(accountAddr: string, origin: string): AutoLoginPolicy | null {
    const accountPolicies = this.#policiesByAccount[accountAddr] || []

    const policy = accountPolicies.find((p) => {
      try {
        const url = new URL(p.uriPrefix)
        return url.origin === origin
      } catch {
        return false
      }
    })

    return policy || null
  }

  getAccountPolicies(accountAddr: string): AutoLoginPolicy[] {
    return this.#policiesByAccount[accountAddr] || []
  }
}
