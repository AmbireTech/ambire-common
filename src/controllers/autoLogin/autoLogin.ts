import { isHexString, toUtf8String } from 'ethers'
import { SiweMessage } from 'siwe'
import { parseSiweMessage, SiweMessage as SiweMessageType } from 'viem/siwe'

import { IAccountsController } from '../../interfaces/account'
import {
  AutoLoginPoliciesByAccount,
  AutoLoginPolicy,
  AutoLoginSettings,
  AutoLoginStatus,
  DefaultAutoLoginPolicy,
  IAutoLoginController,
  SiweValidityStatus
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

// Taken from viem's parseSiweMessage.ts
const prefixRegex =
  /^(?:(?<scheme>[a-zA-Z][a-zA-Z0-9+-.]*):\/\/)?(?<domain>[a-zA-Z0-9+-.]*(?::[0-9]{1,5})?) (?:wants you to sign in with your Ethereum account:\n)(?<address>0x[a-fA-F0-9]{40})\n\n(?:(?<statement>.*)\n\n)?/

/**
 * A list of default policies for popular apps
 */
const DEFAULT_POLICIES: DefaultAutoLoginPolicy[] = []

export class AutoLoginController extends EventEmitter implements IAutoLoginController {
  #storage: IStorageController

  settings: AutoLoginSettings = {
    enabled: true,
    duration: 24 * 60 * 60 * 1000
  }

  #signMessage: SignMessageController

  #policiesByAccount: AutoLoginPoliciesByAccount = {}

  #accounts: IAccountsController

  #networks: INetworksController

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
    this.#networks = networks
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

  static convertSiweToViemFormat(parsedSiweMessage: SiweMessage): SiweMessageType {
    const { expirationTime, notBefore, issuedAt, address, ...viemFormatParsedMessage } =
      parsedSiweMessage

    const parsedSiweMessageViemFormat: SiweMessageType = {
      ...viemFormatParsedMessage,
      version: parsedSiweMessage.version as '1', // hack to stop viem from whining
      address: parsedSiweMessage.address as `0x${string}`,
      ...(parsedSiweMessage.expirationTime
        ? { expirationTime: new Date(parsedSiweMessage.expirationTime) }
        : {}),
      ...(parsedSiweMessage.notBefore ? { notBefore: new Date(parsedSiweMessage.notBefore) } : {}),
      ...(parsedSiweMessage.issuedAt ? { issuedAt: new Date(parsedSiweMessage.issuedAt) } : {})
    }

    return parsedSiweMessageViemFormat
  }

  static getParsedSiweMessage(
    message: string | `0x${string}`,
    requestOrigin: string
  ): null | {
    parsedSiwe: SiweMessageType
    status: SiweValidityStatus
  } {
    if (typeof message !== 'string' || message.trim() === '') return null
    const messageString = message.startsWith('0x') ? toUtf8String(message) : message

    // Quick check to see if it looks like a SIWE message at all
    if (messageString.match(prefixRegex) === null) return null

    try {
      const requestDomain = new URL(requestOrigin).host
      const parsedSiweMessage = new SiweMessage(messageString)

      if (!parsedSiweMessage || !Object.keys(parsedSiweMessage).length) return null

      if (parsedSiweMessage.domain !== requestDomain)
        return {
          parsedSiwe: AutoLoginController.convertSiweToViemFormat(parsedSiweMessage),
          status: 'domain-mismatch'
        }

      if (
        parsedSiweMessage.notBefore &&
        new Date(parsedSiweMessage.notBefore).getTime() > Date.now()
      )
        return {
          parsedSiwe: AutoLoginController.convertSiweToViemFormat(parsedSiweMessage),
          status: 'invalid'
        }
      if (
        parsedSiweMessage.expirationTime &&
        new Date(parsedSiweMessage.expirationTime).getTime() < Date.now()
      )
        return {
          parsedSiwe: AutoLoginController.convertSiweToViemFormat(parsedSiweMessage),
          status: 'invalid'
        }

      if (!isHexString(parsedSiweMessage.address))
        return {
          parsedSiwe: AutoLoginController.convertSiweToViemFormat(parsedSiweMessage),
          status: 'invalid'
        }

      return {
        parsedSiwe: AutoLoginController.convertSiweToViemFormat(parsedSiweMessage),
        status: 'valid'
      }
    } catch (e: any) {
      console.error('Error parsing message:', e)

      return {
        // Parse it again with viem to get as much info as possible
        // so we can display it to the user
        parsedSiwe: parseSiweMessage(messageString) as SiweMessageType,
        status: 'invalid-critical'
      }
    }
  }

  static isPolicyMatchingDomainAndUri(
    parsedSiwe: SiweMessageType,
    policy: Pick<AutoLoginPolicy, 'domain' | 'uriPrefix'>
  ): boolean {
    return policy.domain === parsedSiwe.domain && parsedSiwe.uri.startsWith(policy.uriPrefix)
  }

  async #load() {
    this.#policiesByAccount = await this.#storage.get('autoLoginPolicies', this.#policiesByAccount)
    this.settings = await this.#storage.get('autoLoginSettings', this.settings)

    this.emitUpdate()
  }

  #createOrUpdatePolicyFromSiwe(
    parsedSiwe: SiweMessageType,
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
    parsedSiwe: SiweMessageType,
    accountKeys: Key[]
  ): 'no-policy' | 'expired' | 'valid-policy' | 'unsupported' {
    const accountPolicies = this.getAccountPolicies(parsedSiwe.address)

    let policy = accountPolicies.find((p) => {
      if (!AutoLoginController.isPolicyMatchingDomainAndUri(parsedSiwe, p)) return false

      if (parsedSiwe.chainId && !p.allowedChains.includes(parsedSiwe.chainId)) return false

      // Either all resources must be present and be a subset of the allowed resources,
      // or no resources should be present at all
      if (!parsedSiwe.resources || parsedSiwe.resources.length === 0) return true

      return parsedSiwe.resources.every((resource) => p.allowedResources.includes(resource))
    })

    if (!policy) {
      // Check default policies
      const defaultPolicy = DEFAULT_POLICIES.find((p) =>
        AutoLoginController.isPolicyMatchingDomainAndUri(parsedSiwe, p)
      )

      if (defaultPolicy) policy = this.getPolicyFromDefaultPolicy(defaultPolicy)
    }

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
    parsedSiwe: SiweMessageType,
    isAutoLoginEnabledByUser: boolean,
    autoLoginDuration: number
  ): Promise<AutoLoginPolicy | null> {
    await this.initialLoadPromise

    if (!isAutoLoginEnabledByUser) {
      console.log('Debug: Auto-login not enabled by user, skipping policy creation')
      return null
    }

    if (
      DEFAULT_POLICIES.find((p) => AutoLoginController.isPolicyMatchingDomainAndUri(parsedSiwe, p))
    ) {
      console.log('Debug: Matched a default policy, skipping custom policy creation')
      return null
    }

    const policy = this.#createOrUpdatePolicyFromSiwe(parsedSiwe, { autoLoginDuration })
    console.log('Debug: Created/updated auto-login policy', policy)
    await this.#storage.set('autoLoginPolicies', this.#policiesByAccount)
    this.emitUpdate()

    return policy
  }

  getAutoLoginStatus(parsedSiwe: SiweMessageType): AutoLoginStatus {
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

  getPolicyFromDefaultPolicy(defaultPolicy: DefaultAutoLoginPolicy): AutoLoginPolicy {
    return {
      ...defaultPolicy,
      allowedChains: this.#networks.networks.map((n) => Number(n.chainId)),
      defaultExpiration: Date.now() + this.settings.duration
    }
  }

  getAccountPolicyForOrigin(accountAddr: string, origin: string): AutoLoginPolicy | null {
    const accountPolicies = this.getAccountPolicies(accountAddr)

    const policy = accountPolicies.find((p) => {
      try {
        const url = new URL(p.uriPrefix)
        return url.origin === origin
      } catch {
        return false
      }
    })

    if (!policy || AutoLoginController.isExpiredPolicy(policy)) return null

    if (policy) return policy

    // Check for default policies first
    const defaultPolicy = DEFAULT_POLICIES.find((p) => {
      try {
        const url = new URL(p.uriPrefix)
        return url.origin === origin
      } catch {
        return false
      }
    })

    if (defaultPolicy) return this.getPolicyFromDefaultPolicy(defaultPolicy)

    return null
  }

  getAccountPolicies(accountAddr: string): AutoLoginPolicy[] {
    return this.#policiesByAccount[accountAddr] || []
  }
}
