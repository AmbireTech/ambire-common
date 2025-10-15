import { hexlify, toUtf8Bytes, ZeroAddress } from 'ethers'
import fetch from 'node-fetch'
import { createSiweMessage, CreateSiweMessageParameters } from 'viem/siwe'

import { relayerUrl } from '../../../test/config'
import { mockInternalKeys, produceMemoryStore } from '../../../test/helpers'
import { mockUiManager } from '../../../test/helpers/ui'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks } from '../../consts/networks'
import { AutoLoginPolicy, AutoLoginSettings } from '../../interfaces/autoLogin'
import { IProvidersController } from '../../interfaces/provider'
import { Storage } from '../../interfaces/storage'
import { KeystoreSigner } from '../../libs/keystoreSigner/keystoreSigner'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { StorageController } from '../storage/storage'
import { UiController } from '../ui/ui'
import { AutoLoginController } from './autoLogin'

const providers = Object.fromEntries(
  networks.map((network) => [network.chainId, getRpcProvider(network.rpcUrls, network.chainId)])
)

const storage: Storage = produceMemoryStore()
let providersCtrl: IProvidersController
const storageCtrl = new StorageController(storage)
const networksCtrl = new NetworksController({
  storage: storageCtrl,
  fetch,
  relayerUrl,
  onAddOrUpdateNetworks: (nets) => {
    nets.forEach((n) => {
      providersCtrl.setProvider(n)
    })
  },
  onRemoveNetwork: (id) => {
    providersCtrl.removeProvider(id)
  }
})

providersCtrl = new ProvidersController(networksCtrl)
providersCtrl.providers = providers

const { uiManager } = mockUiManager()
const uiCtrl = new UiController({ uiManager })

const EOA_ACC = {
  addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
  associatedKeys: ['0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'],
  creation: null,
  initialPrivileges: [],
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
  }
}

const HW_ACC = {
  ...EOA_ACC,
  addr: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0',
  associatedKeys: ['0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0']
}

const accounts = [EOA_ACC, HW_ACC]

const prepareTest = async (
  initialSetStorage?: (storageCtrl: StorageController) => Promise<void>
) => {
  const mockEOAKeys = mockInternalKeys([EOA_ACC])
  await storage.set('keystoreKeys', mockEOAKeys)
  await storage.set('accounts', accounts)

  const keystore = new KeystoreController(
    'default',
    storageCtrl,
    { internal: KeystoreSigner },
    uiCtrl
  )

  const accountsCtrl = new AccountsController(
    storageCtrl,
    providersCtrl,
    networksCtrl,
    keystore,
    () => {},
    () => {},
    () => {}
  )

  await networksCtrl.initialLoadPromise
  await accountsCtrl.initialLoadPromise
  await keystore.initialLoadPromise
  await providersCtrl.initialLoadPromise
  if (initialSetStorage) await initialSetStorage(storageCtrl)

  await accountsCtrl.addAccounts(accounts)

  const autoLogin = new AutoLoginController(
    storageCtrl,
    keystore,
    providersCtrl,
    networksCtrl,
    accountsCtrl,
    {},
    new InviteController({
      relayerUrl,
      fetch,
      storage: storageCtrl
    })
  )

  await autoLogin.initialLoadPromise

  return {
    storage,
    controller: autoLogin
  }
}

const generateSiweMessage = (
  // eslint-disable-next-line default-param-last
  overrides: Partial<CreateSiweMessageParameters> = {},
  modifyFunc?: (message: string) => string
) => {
  let message = createSiweMessage({
    domain: 'docs.fileverse.io',
    address: EOA_ACC.addr as `0x${string}`,
    statement: 'Sign in to docs.fileverse.io',
    uri: 'https://docs.fileverse.io/login',
    version: '1',
    chainId: 1,
    resources: ['https://privy.io'],
    nonce: hexlify(toUtf8Bytes('100')),
    ...overrides
  })

  if (modifyFunc) {
    message = modifyFunc(message)
  }

  return hexlify(toUtf8Bytes(message)) as `0x${string}`
}

describe('AutoLoginController', () => {
  /**
   * Test cases:
   * - Should load policies and settings from storage
   * - autoLogin throws an error if there isn't an internal key
   * - getAutoLoginStatus - test each status (active, no-policy, expired, unsupported)
   * - onSiweMessageSigned creates a policy
   * - onSiweMessageSigned updates existing policies
   * - revokePolicy works
   * - getParsedSiweMessage - text message, invalid siwe, expired siwe, typed message
   */

  it('Should load policies and settings from storage', async () => {
    const POLICIES: AutoLoginPolicy[] = [
      {
        domain: 'docs.fileverse.io',
        uriPrefix: 'https://docs.fileverse.io/',
        allowedChains: [1, 137],
        allowedResources: ['https://privy.io'],
        supportsEIP6492: false,
        defaultExpiration: Date.now() + 60000,
        lastAuthenticated: Date.now()
      },
      {
        domain: 'sigtool.ambire.com',
        uriPrefix: 'https://sigtool.ambire.com/',
        allowedChains: [1, 10, 137, 42161],
        allowedResources: [],
        supportsEIP6492: false,
        defaultExpiration: Date.now() + 60000,
        lastAuthenticated: Date.now() - 30000
      }
    ]
    const SETTINGS: AutoLoginSettings = {
      enabled: true,
      duration: 60 * 60 * 60 * 24
    }

    const { controller } = await prepareTest(async (s) => {
      await s.set('autoLoginPolicies', {
        [EOA_ACC.addr]: POLICIES
      })
      await s.set('autoLoginSettings', SETTINGS)
    })

    expect(controller).toBeDefined()
    expect(controller.settings).toEqual(SETTINGS)
    expect(controller.getAccountPolicies(EOA_ACC.addr)).toEqual(POLICIES)
    expect(controller.getAccountPolicies(HW_ACC.addr)).toEqual([])
  })
  describe('getParsedSiweMessage', () => {
    it('text message - should return null', async () => {
      const message = AutoLoginController.getParsedSiweMessage('Hello world')

      expect(message).toBeNull()
    })
    it('invalid siwe - should return null', async () => {
      const malformedMessage = hexlify(
        toUtf8Bytes(
          createSiweMessage({
            domain: 'docs.fileverse.io',
            address: EOA_ACC.addr as `0x${string}`,
            statement: 'Sign in to docs.fileverse.io',
            uri: 'https://docs.fileverse.io/login',
            version: '1',
            chainId: 1,
            resources: ['https://privy.io'],
            nonce: hexlify(toUtf8Bytes('100'))
          }).slice(-50)
        )
      ) as `0x${string}`

      const message = AutoLoginController.getParsedSiweMessage(malformedMessage)

      expect(message).toBeNull()

      const malformedMessage2 = hexlify(
        toUtf8Bytes(
          `
docs.fileverse.io wants you to sign in with your Ethereum account:
0x6de5cD22bC8A54b028E54fC3a7D5b102C7F72109

By signing, you are proving you own this wallet and logging in. This does not initiate a transaction or cost any fees.

URI: https://docs.fileverse.io
          `
        )
      ) as `0x${string}`

      const message2 = AutoLoginController.getParsedSiweMessage(malformedMessage2)

      expect(message2).toBeNull()
    })
    it('not before in the future - should return null', async () => {
      const malformedMessage = generateSiweMessage({
        notBefore: new Date(Date.now() + 60000)
      })
      const message = AutoLoginController.getParsedSiweMessage(malformedMessage)

      expect(message).toBeNull()
    })
    it('invalid nonce - should return null', async () => {
      const malformedMessage = generateSiweMessage(undefined, (message) =>
        message.replace(/Nonce: [a-zA-Z0-9]+/, 'Nonce: invalidnonce')
      )
      const message = AutoLoginController.getParsedSiweMessage(malformedMessage)

      expect(message).toBeNull()
    })
    it('invalid resource uri in resources', async () => {
      const malformedMessage = generateSiweMessage(undefined, (message) =>
        message.replace(/Resources:\n- https:\/\/privy.io/, 'Resources:\n- invaliduri')
      )
      const message = AutoLoginController.getParsedSiweMessage(malformedMessage)

      expect(message).toBeNull()
    })
    it('expired siwe - should return null', async () => {
      const expiredSiwe = generateSiweMessage({
        expirationTime: new Date(Date.now() - 1000)
      })
      const message = AutoLoginController.getParsedSiweMessage(expiredSiwe)

      expect(message).toBeNull()
    })
    it('typed message - should return null', async () => {
      const typedMessage = {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' }
          ],
          Person: [
            { name: 'name', type: 'string' },
            { name: 'wallet', type: 'address' }
          ],
          Mail: [
            { name: 'from', type: 'Person' },
            { name: 'to', type: 'Person' },
            { name: 'contents', type: 'string' }
          ]
        },
        primaryType: 'Mail',
        domain: {
          name: 'Ether Mail',
          version: '1',
          chainId: 1,
          verifyingContract: ZeroAddress
        },
        message: {
          from: {
            name: 'Cow',
            wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826'
          },
          to: {
            name: 'Bob',
            wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
          },
          contents: 'Hello, Bob!'
        }
      }

      const message = AutoLoginController.getParsedSiweMessage(typedMessage as any)

      expect(message).toBeNull()
    })
    it('valid siwe - should return parsed message', async () => {
      const siwe = generateSiweMessage()

      const message = AutoLoginController.getParsedSiweMessage(siwe)

      expect(message).toBeDefined()
      expect(message?.domain).toBe('docs.fileverse.io')
      expect(message?.address).toBe(EOA_ACC.addr)
      expect(message?.uri).toBe('https://docs.fileverse.io/login')
      expect(message?.chainId).toBe(1)
      expect(message?.resources).toEqual(['https://privy.io'])
    })
  })
  it("autoLogin throws an error if there isn't an internal key", async () => {
    const { controller } = await prepareTest()

    const message = generateSiweMessage()

    await expect(
      controller.autoLogin({
        chainId: 1n,
        accountAddr: HW_ACC.addr,
        message
      })
    ).rejects.toThrow('No internal key available for signing')
  })
  describe('getAutoLoginStatus', () => {
    const MOCK_POLICY: AutoLoginPolicy = {
      domain: 'docs.fileverse.io',
      uriPrefix: 'https://docs.fileverse.io/',
      allowedChains: [1, 137],
      allowedResources: ['https://privy.io'],
      supportsEIP6492: false,
      defaultExpiration: Date.now() + 60000,
      lastAuthenticated: Date.now()
    }
    it('returns "active" for valid policy', async () => {
      const { controller } = await prepareTest((s) => {
        return s.set('autoLoginPolicies', {
          [EOA_ACC.addr]: [MOCK_POLICY]
        })
      })

      expect(controller.getAccountPolicies(EOA_ACC.addr)).toEqual([MOCK_POLICY])

      const siwe = generateSiweMessage()

      const status = controller.getAutoLoginStatus(AutoLoginController.getParsedSiweMessage(siwe)!)

      expect(status).toBe('active')
    })
    it('returns "no-policy" if there is no policy', async () => {
      const { controller } = await prepareTest((s) => {
        return s.set('autoLoginPolicies', {
          [EOA_ACC.addr]: [MOCK_POLICY]
        })
      })

      expect(controller.getAccountPolicies(EOA_ACC.addr)).toEqual([MOCK_POLICY])

      const siwe = generateSiweMessage({
        domain: 'some-other-domain.com',
        uri: 'https://some-other-domain.com/login'
      })

      const status = controller.getAutoLoginStatus(AutoLoginController.getParsedSiweMessage(siwe)!)

      expect(status).toBe('no-policy')
    })
    it('returns "expired" for expired policy', async () => {
      const expiredPolicy = {
        ...MOCK_POLICY,
        defaultExpiration: Date.now() - 1000
      }

      const { controller } = await prepareTest((s) => {
        return s.set('autoLoginPolicies', {
          [EOA_ACC.addr]: [expiredPolicy]
        })
      })

      expect(controller.getAccountPolicies(EOA_ACC.addr)).toEqual([expiredPolicy])

      const siwe = generateSiweMessage()

      const status = controller.getAutoLoginStatus(AutoLoginController.getParsedSiweMessage(siwe)!)

      expect(status).toBe('expired')
    })
    it('returns "unsupported" if the account doesn\'t have an internal key', async () => {
      const { controller } = await prepareTest((s) => {
        return s.set('autoLoginPolicies', {
          [HW_ACC.addr]: [MOCK_POLICY]
        })
      })

      expect(controller.getAccountPolicies(HW_ACC.addr)).toEqual([MOCK_POLICY])

      const siwe = generateSiweMessage({
        address: HW_ACC.addr as `0x${string}`
      })

      const status = controller.getAutoLoginStatus(AutoLoginController.getParsedSiweMessage(siwe)!)

      expect(status).toBe('unsupported')
    })
  })
  it('onSiweMessageSigned creates a policy', async () => {
    const { controller } = await prepareTest()

    const parsedSiwe = AutoLoginController.getParsedSiweMessage(generateSiweMessage())!

    const policy = await controller.onSiweMessageSigned(
      parsedSiwe,
      true,
      controller.settings.duration
    )

    if (!policy) throw new Error('Policy not created')

    expect(policy).toBeDefined()
    expect(policy.domain).toBe(parsedSiwe.domain)
    expect(policy.uriPrefix).toBe(parsedSiwe.uri)
    expect(policy.allowedChains).toEqual([Number(parsedSiwe.chainId)])
    expect(policy.allowedResources).toEqual(parsedSiwe.resources)
    expect(policy.supportsEIP6492).toBe(false)
    expect(policy.defaultExpiration).toBeGreaterThan(Date.now())
    expect(policy.lastAuthenticated).toBeLessThanOrEqual(Date.now())
  })
  it('onSiweMessageSigned updates existing policies', async () => {
    const EXISTING_POLICY: AutoLoginPolicy = {
      domain: 'docs.fileverse.io',
      uriPrefix: 'https://docs.fileverse.io/',
      allowedChains: [1],
      allowedResources: ['https://privy.io'],
      supportsEIP6492: false,
      defaultExpiration: Date.now() + 60000,
      lastAuthenticated: Date.now()
    }

    const { controller } = await prepareTest((s) => {
      return s.set('autoLoginPolicies', {
        [EOA_ACC.addr]: [EXISTING_POLICY]
      })
    })

    const parsedSiwe = AutoLoginController.getParsedSiweMessage(
      generateSiweMessage({
        chainId: 137,
        resources: ['https://privy.io', 'https://fileverse.io']
      })
    )!

    const policy = await controller.onSiweMessageSigned(
      parsedSiwe,
      true,
      controller.settings.duration
    )

    if (!policy) throw new Error('Policy not created')

    expect(policy).toBeDefined()
    expect(policy.domain).toBe(EXISTING_POLICY.domain)
    expect(policy.uriPrefix).toBe(EXISTING_POLICY.uriPrefix)
    expect(policy.allowedChains).toEqual([1, 137])
    expect(policy.allowedResources).toEqual(['https://privy.io', 'https://fileverse.io'])
    expect(policy.supportsEIP6492).toBe(false)
    expect(policy.defaultExpiration).toBeGreaterThan(EXISTING_POLICY.defaultExpiration)
    expect(policy.lastAuthenticated).toBeGreaterThan(EXISTING_POLICY.lastAuthenticated)
  })
  it('onSiweMessageSigned does not create a policy if autoLogin is disabled', async () => {
    const { controller } = await prepareTest()

    const parsedSiwe = AutoLoginController.getParsedSiweMessage(generateSiweMessage())!

    const policy = await controller.onSiweMessageSigned(
      parsedSiwe,
      false,
      controller.settings.duration
    )

    expect(policy).toBeNull()
  })
  it('revokePolicy works', async () => {
    const EXISTING_POLICY: AutoLoginPolicy = {
      domain: 'docs.fileverse.io',
      uriPrefix: 'https://docs.fileverse.io/',
      allowedChains: [1],
      allowedResources: ['https://privy.io'],
      supportsEIP6492: false,
      defaultExpiration: Date.now() + 60000,
      lastAuthenticated: Date.now()
    }

    const { controller } = await prepareTest((s) => {
      return s.set('autoLoginPolicies', {
        [EOA_ACC.addr]: [EXISTING_POLICY]
      })
    })

    expect(controller.getAccountPolicies(EOA_ACC.addr)).toEqual([EXISTING_POLICY])

    await controller.revokePolicy(EOA_ACC.addr, EXISTING_POLICY.domain, EXISTING_POLICY.uriPrefix)

    expect(controller.getAccountPolicies(EOA_ACC.addr)).toEqual([])
  })
})
