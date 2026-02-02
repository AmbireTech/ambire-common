import { isHexString, toUtf8String } from 'ethers'
import { SiweMessage } from 'siwe'
import { getDomain } from 'tldts'
import { getAddress } from 'viem'
import { SiweMessage as SiweMessageType } from 'viem/siwe'

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
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter'
import { IInviteController } from '../../interfaces/invite'
import { ExternalSignerControllers, IKeystoreController, Key } from '../../interfaces/keystore'
import { INetworksController } from '../../interfaces/network'
import { IProvidersController } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
import { PlainTextMessageUserRequest } from '../../interfaces/userRequest'
import EventEmitter from '../eventEmitter/eventEmitter'
import { SignMessageController } from '../signMessage/signMessage'

export const STATUS_WRAPPED_METHODS = {
  revokePolicy: 'INITIAL',
  revokeAllPoliciesForDomain: 'INITIAL'
} as const

// Taken from viem's parseSiweMessage.ts
const prefixRegex =
  /^(?:(?<scheme>[a-zA-Z][a-zA-Z0-9+-.]*):\/\/)?(?<domain>[a-zA-Z0-9+-.]*(?::[0-9]{1,5})?) (?:wants you to sign in with your Ethereum account:\n)(?<address>0x[a-fA-F0-9]{40})\n\n(?:(?<statement>.*)\n\n)?/

/**
 * A list of default policies for popular apps
 */
const DEFAULT_POLICIES: DefaultAutoLoginPolicy[] = []

const DEFAULT_AUTO_LOGIN_DURATION_OPTION = {
  label: '30 days',
  value: 30 * 24 * 60 * 60 * 1000
}

// Implemented here to ensure consistency between the controller and the UI
// Also, in the future when the duration setting becomes exposed to the UI we
// will need to validate the input from the UI, so these will be useful
export const AUTO_LOGIN_DURATION_OPTIONS = [
  { label: '24 hours', value: 24 * 60 * 60 * 1000 },
  {
    label: '7 days',
    value: 7 * 24 * 60 * 60 * 1000
  },
  {
    label: '14 days',
    value: 14 * 24 * 60 * 60 * 1000
  },
  DEFAULT_AUTO_LOGIN_DURATION_OPTION
]

/**
 * The controller handles SIWE-like messages and provides auto-login functionality.
 * It creates and manages auto-login policies based on signed SIWE messages, and
 * automatically signs messages when auto-login is applicable.
 * In essence, it implements:
 * - ERC-4361: Sign-In with Ethereum (https://github.com/ethereum/ERCs/blob/aa5a30ab9b23c317c8a3206b70ee4ff7fbe8dc33/ERCS/erc-4361.md)
 * - ERC-8019: Auto-Login for SIWE (https://github.com/ethereum/ERCs/blob/aa5a30ab9b23c317c8a3206b70ee4ff7fbe8dc33/ERCS/erc-8019.md)
 */
export class AutoLoginController extends EventEmitter implements IAutoLoginController {
  #storage: IStorageController

  settings: AutoLoginSettings = {
    enabled: true,
    duration: DEFAULT_AUTO_LOGIN_DURATION_OPTION.value
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
    invite: IInviteController,
    eventEmitterRegistry?: IEventEmitterRegistryController
  ) {
    super(eventEmitterRegistry)
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
    // Policies with 0 expiration never expire
    if (policy.expiresAt === 0) return false

    return Date.now() > policy.expiresAt
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
    requestOrigin: string,
    signerAddress?: string
  ): null | {
    parsedSiwe: SiweMessageType
    status: SiweValidityStatus
  } {
    if (typeof message !== 'string' || message.trim() === '') return null

    let messageString: string

    try {
      messageString = message.startsWith('0x') ? toUtf8String(message) : message

      // Quick check to see if it looks like a SIWE message at all
      if (messageString.match(prefixRegex) === null) return null
    } catch (e) {
      return null
    }

    try {
      const requestHostname = new URL(requestOrigin).host

      // Some dApps don't use checksum addresses in the SIWE message
      // Which makes verification by the 'siwe' package fail (as it's very strict)
      if (signerAddress) {
        messageString = messageString.replace(
          signerAddress.toLowerCase(),
          getAddress(signerAddress)
        )
      }

      const parsedSiweMessage = new SiweMessage(messageString)

      if (!parsedSiweMessage || !Object.keys(parsedSiweMessage).length) return null

      if (getDomain(parsedSiweMessage.domain) !== getDomain(requestHostname))
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
      console.error('Error parsing message:', e, 'Original message:', messageString)

      // Fallback to regular sign message if parsing fails
      return null
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
        expiresAt: expirationTime,
        lastAuthenticated: Date.now()
      }

      this.#policiesByAccount[accountAddress].push(newPolicy)

      return newPolicy
    }

    // Update existing policy
    existingPolicy.expiresAt = expirationTime
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

  async revokeAllPoliciesForDomain(policyDomain: string, policyUriPrefix: string) {
    await this.initialLoadPromise

    await this.withStatus('revokeAllPoliciesForDomain', async () => {
      Object.keys(this.#policiesByAccount).forEach((accountAddress) => {
        const accountPolicies = this.#policiesByAccount[accountAddress] || []

        if (accountPolicies.length === 0) return

        this.#policiesByAccount[accountAddress] = accountPolicies.filter(
          (p) => !(p.domain === policyDomain && p.uriPrefix === policyUriPrefix)
        )
      })

      await this.#storage.set('autoLoginPolicies', this.#policiesByAccount)
    })
  }

  async onSiweMessageSigned(
    parsedSiwe: SiweMessageType,
    isAutoLoginEnabledByUser: boolean,
    autoLoginDuration: number
  ): Promise<AutoLoginPolicy | null> {
    await this.initialLoadPromise

    if (!isAutoLoginEnabledByUser) return null

    // If there is a default policy skip creating a new one
    // The only downside is that we don't save the lastAuthenticated time
    if (
      DEFAULT_POLICIES.find((p) => AutoLoginController.isPolicyMatchingDomainAndUri(parsedSiwe, p))
    ) {
      return null
    }

    const policy = this.#createOrUpdatePolicyFromSiwe(parsedSiwe, { autoLoginDuration })
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
    message: PlainTextMessageUserRequest['meta']['params']['message']
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
        fromRequestId: 'siwe-auto-login',
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
      allowedChains: this.#networks.networks.map((n) => Number(n.chainId))
    }
  }

  getAccountPolicyForOrigin(
    accountAddr: string,
    origin: string,
    chainId?: number
  ): AutoLoginPolicy | null {
    const accountPolicies = this.getAccountPolicies(accountAddr)

    const policy = accountPolicies.find((p) => {
      try {
        const url = new URL(p.uriPrefix)
        return url.origin === origin
      } catch {
        return false
      }
    })

    if (
      !policy ||
      AutoLoginController.isExpiredPolicy(policy) ||
      (chainId && !policy.allowedChains.includes(chainId))
    )
      return null

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

  getAccountPolicies(accountAddr: string, withDefaultPolicies: boolean = false): AutoLoginPolicy[] {
    const accountPolicies = this.#policiesByAccount[accountAddr] || []

    if (!withDefaultPolicies) return accountPolicies

    const defaultPoliciesConverted = DEFAULT_POLICIES.map((p) => this.getPolicyFromDefaultPolicy(p))

    return [...accountPolicies, ...defaultPoliciesConverted]
  }
}
