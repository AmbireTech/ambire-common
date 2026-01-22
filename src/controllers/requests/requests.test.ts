import fetch from 'node-fetch'

import { describe, expect, test } from '@jest/globals'

import { relayerUrl, velcroUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { mockUiManager } from '../../../test/helpers/ui'
import { Session } from '../../classes/session'
import humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { networks } from '../../consts/networks'
import { Account } from '../../interfaces/account'
import { RPCProviders } from '../../interfaces/provider'
import { IRequestsController } from '../../interfaces/requests'
import {
  BenzinUserRequest,
  CallsUserRequest,
  DappConnectRequest,
  UserRequest
} from '../../interfaces/userRequest'
import { HumanizerMeta } from '../../libs/humanizer/interfaces'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { ActivityController } from '../activity/activity'
import { AddressBookController } from '../addressBook/addressBook'
import { AutoLoginController } from '../autoLogin/autoLogin'
import { BannerController } from '../banner/banner'
import { EventEmitterRegistryController } from '../eventEmitterRegistry/eventEmitterRegistry'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { PhishingController } from '../phishing/phishing'
import { PortfolioController } from '../portfolio/portfolio'
import { ProvidersController } from '../providers/providers'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { SignAccountOpController } from '../signAccountOp/signAccountOp'
import { StorageController } from '../storage/storage'
import { SocketAPIMock } from '../swapAndBridge/socketApiMock'
import { SwapAndBridgeController } from '../swapAndBridge/swapAndBridge'
import { TransferController } from '../transfer/transfer'
import { UiController } from '../ui/ui'
import { RequestsController } from './requests'

const { uiManager, getWindowId, eventEmitter: event } = mockUiManager()

const MOCK_SESSION = new Session({ tabId: 1, url: 'https://test-dApp.com' })

const accounts: Account[] = [
  {
    addr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
    associatedKeys: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
    creation: {
      factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
      bytecode:
        '0x7f28d4ea8f825adb036e9b306b2269570e63d2aa5bd10751437d98ed83551ba1cd7fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
      salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
    },
    preferences: {
      label: 'does-not-matter',
      pfp: 'also-does-not-matter'
    },
    initialPrivileges: []
  },
  {
    addr: '0x6C0937c7a04487573673a47F22E4Af9e96b91ecd',
    associatedKeys: ['0xfF3f6D14DF43c112aB98834Ee1F82083E07c26BF'],
    creation: {
      factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
      bytecode:
        '0x7f1e7646e4695bead8bb0596679b0caf3a7ff6c4e04d2ad79103c8fa61fb6337f47fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
      salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
    },
    preferences: {
      label: 'does-not-matter',
      pfp: 'also-does-not-matter'
    },
    initialPrivileges: []
  },
  {
    addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
    associatedKeys: [],
    creation: {
      factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
      bytecode:
        '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
      salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
    },
    preferences: {
      label: 'does-not-matter',
      pfp: 'also-does-not-matter'
    },
    initialPrivileges: []
  }
]

const waitForAccountsCtrlFirstLoad = async (accountsCtrl: AccountsController) => {
  return new Promise<void>((resolve) => {
    const unsubscribe = accountsCtrl.onUpdate(() => {
      if (
        accountsCtrl.accounts.length &&
        Object.keys(accountsCtrl.accountStates).length &&
        !accountsCtrl.areAccountStatesLoading
      ) {
        unsubscribe()
        resolve()
      }
    })
  })
}

const prepareTest = async () => {
  const storage = produceMemoryStore()
  await storage.set('accounts', accounts)
  await storage.set('selectedAccount', '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8')
  const storageCtrl = new StorageController(storage)
  const uiCtrl = new UiController({ uiManager })
  const keystore = new KeystoreController('default', storageCtrl, {}, uiCtrl)
  let providersCtrl: ProvidersController
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
  providersCtrl = new ProvidersController(networksCtrl, storageCtrl)
  const providers: RPCProviders = {}
  networks.forEach((network) => {
    providers[network.chainId.toString()] = getRpcProvider(network.rpcUrls, network.chainId)
    providers[network.chainId.toString()]!.isWorking = true
  })
  providersCtrl.providers = providers
  const accountsCtrl = new AccountsController(
    storageCtrl,
    providersCtrl,
    networksCtrl,
    keystore,
    () => {},
    () => {},
    () => {},
    relayerUrl,
    fetch
  )

  const keystoreCtrl = new KeystoreController('default', storageCtrl, {}, uiCtrl)

  const autoLoginCtrl = new AutoLoginController(
    storageCtrl,
    keystoreCtrl,
    providersCtrl,
    networksCtrl,
    accountsCtrl,
    {},
    new InviteController({ relayerUrl, fetch, storage: storageCtrl })
  )

  const selectedAccountCtrl = new SelectedAccountController({
    storage: storageCtrl,
    accounts: accountsCtrl,
    keystore: keystoreCtrl,
    autoLogin: autoLoginCtrl
  })

  const addressBookCtrl = new AddressBookController(storageCtrl, accountsCtrl, selectedAccountCtrl)

  await addressBookCtrl.initialLoadPromise

  const phishingCtrl = new PhishingController({
    fetch,
    storage: storageCtrl,
    addressBook: addressBookCtrl
  })

  const portfolioCtrl = new PortfolioController(
    storageCtrl,
    fetch,
    providersCtrl,
    networksCtrl,
    accountsCtrl,
    keystore,
    relayerUrl,
    velcroUrl,
    new BannerController(storageCtrl)
  )
  const callRelayer = relayerCall.bind({ url: '', fetch })
  const activityCtrl = new ActivityController(
    storageCtrl,
    fetch,
    callRelayer,
    accountsCtrl,
    selectedAccountCtrl,
    providersCtrl,
    networksCtrl,
    portfolioCtrl,
    () => Promise.resolve()
  )

  const transferCtrl = new TransferController(
    () => {},
    storageCtrl,
    humanizerInfo as HumanizerMeta,
    selectedAccountCtrl,
    networksCtrl,
    addressBookCtrl,
    accountsCtrl,
    keystoreCtrl,
    portfolioCtrl,
    activityCtrl,
    {},
    providersCtrl,
    phishingCtrl,
    relayerUrl,
    () => Promise.resolve(),
    uiCtrl
  )

  const requestsController: IRequestsController = {} as IRequestsController

  const swapAndBridgeCtrl = new SwapAndBridgeController({
    callRelayer: () => {},
    selectedAccount: selectedAccountCtrl,
    networks: networksCtrl,
    accounts: accountsCtrl,
    activity: activityCtrl,
    storage: storageCtrl,
    swapProvider: new SocketAPIMock({ fetch, apiKey: '' }) as any,
    keystore,
    portfolio: portfolioCtrl,
    providers: providersCtrl,
    phishing: phishingCtrl,
    externalSignerControllers: {},
    relayerUrl,
    getUserRequests: () => {
      return requestsController?.userRequests || []
    },
    getVisibleUserRequests: () => {
      return requestsController?.visibleUserRequests || []
    },
    onBroadcastSuccess: () => Promise.resolve(),
    onBroadcastFailed: () => {}
  })

  const eventEmitterRegistry = new EventEmitterRegistryController(() => null)

  const getSignAccountOp = async ({
    addr,
    chainId,
    requestId
  }: {
    addr: string
    chainId: bigint
    requestId: string
  }) => {
    await accountsCtrl.initialLoadPromise
    await waitForAccountsCtrlFirstLoad(accountsCtrl)
    await networksCtrl.initialLoadPromise
    const account = accountsCtrl.accounts.find((a) => a.addr === addr)!
    const network = networksCtrl.networks.find((n) => n.chainId === chainId)!

    return new SignAccountOpController({
      type: 'default',
      callRelayer,
      accounts: accountsCtrl,
      networks: networksCtrl,
      keystore: keystoreCtrl,
      portfolio: portfolioCtrl,
      externalSignerControllers: {},
      activity: activityCtrl,
      account,
      network,
      eventEmitterRegistry,
      provider: providersCtrl.providers[network.chainId.toString()]!,
      phishing: phishingCtrl,
      fromRequestId: requestId,
      accountOp: {
        accountAddr: addr,
        signingKeyAddr: null,
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        chainId,
        nonce: 0n, // does not matter when estimating
        calls: [
          {
            id: 'testID',
            to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            value: BigInt(0),
            data: '0xa9059cbb000000000000000000000000e5a4dad2ea987215460379ab285df87136e83bea00000000000000000000000000000000000000000000000000000000005040aa'
          }
        ],
        signature: null
      },
      shouldSimulate: false,
      onUpdateAfterTraceCallSuccess: async () => {},
      onBroadcastSuccess: async () => {},
      onBroadcastFailed: () => {}
    })
  }

  const getCallsRequest = async ({ addr, chainId }: { addr: string; chainId: bigint }) => {
    const requestId = `${addr}-${chainId}`
    return {
      id: requestId,
      kind: 'calls',
      signAccountOp: await getSignAccountOp({ addr, chainId, requestId }),
      meta: {
        accountAddr: addr,
        isWalletSendCalls: false,
        chainId,
        paymasterService: undefined
      },
      dappPromises: [
        {
          id: 'testID',
          resolve: () => {},
          reject: () => {},
          session: MOCK_SESSION,
          meta: {}
        }
      ]
    } as CallsUserRequest
  }

  return {
    selectedAccountCtrl,
    controller: new RequestsController({
      relayerUrl,
      callRelayer,
      portfolio: portfolioCtrl,
      externalSignerControllers: {},
      activity: activityCtrl,
      phishing: phishingCtrl,
      accounts: accountsCtrl,
      networks: networksCtrl,
      providers: providersCtrl,
      selectedAccount: selectedAccountCtrl,
      keystore: keystoreCtrl,
      transfer: transferCtrl,
      swapAndBridge: swapAndBridgeCtrl,
      ui: uiCtrl,
      autoLogin: autoLoginCtrl,
      getDapp: async () => undefined,
      updateSelectedAccountPortfolio: () => Promise.resolve(),
      addTokensToBeLearned: () => {},
      onSetCurrentUserRequest: () => {},
      onBroadcastSuccess: async () => {},
      onBroadcastFailed: () => {},
      eventEmitterRegistry
    }),
    getSignAccountOp,
    getCallsRequest
  }
}

const DAPP_CONNECT_REQUEST: DappConnectRequest = {
  id: 1,
  kind: 'dappConnect',
  meta: {},
  dappPromises: [
    {
      id: 'testID',
      resolve: () => {},
      reject: () => {},
      session: MOCK_SESSION,
      meta: {}
    }
  ]
}

describe('RequestsController ', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
  })
  test('Init controller', async () => {
    const { controller } = await prepareTest()
    expect(controller.initialLoadPromise).toBeInstanceOf(Promise)
    await expect(controller.initialLoadPromise).resolves.toBeUndefined()
  })

  test('Add and then remove a user request', async () => {
    const { controller, getCallsRequest } = await prepareTest()
    const req: UserRequest = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 1n
    })

    await controller.addUserRequests([req])
    expect(controller.userRequests.length).toBe(1)
    expect(controller.visibleUserRequests.length).toBe(1)

    await controller.removeUserRequests([req.id])
    expect(controller.userRequests.length).toBe(0)
    expect(controller.visibleUserRequests.length).toBe(0)
  })
  test('build dapp request', async () => {
    const { controller } = await prepareTest()

    await controller.build({
      type: 'dappRequest',
      params: {
        request: {
          method: 'dapp_connect',
          params: {},
          session: MOCK_SESSION
        },
        dappPromise: { id: 'testID', resolve: () => {}, reject: () => {}, session: MOCK_SESSION }
      }
    })

    expect(controller.userRequests.length).toBe(1)
    expect(controller.userRequests[0]!.kind).toBe('dappConnect')
  })
  test('build transfer request', async () => {
    const { controller } = await prepareTest()

    await controller.build({
      type: 'transferRequest',
      params: {
        selectedToken: {
          address: '0x0000000000000000000000000000000000000000',
          amount: 1n,
          symbol: 'ETH',
          name: 'Ether',
          chainId: 1n,
          decimals: 18,
          priceIn: [],
          flags: {
            onGasTank: false,
            rewardsType: null,
            canTopUpGasTank: true,
            isFeeToken: true
          }
        },
        amount: '1',
        amountInFiat: 100000n,
        executionType: 'open-request-window',
        recipientAddress: '0xa07D75aacEFd11b425AF7181958F0F85c312f143'
      }
    })

    expect(controller.userRequests.length).toBe(1)
    expect(controller.userRequests[0]!.kind).toBe('calls')
  })
  test('resolve user request', async () => {
    const { controller, getCallsRequest } = await prepareTest()

    const resolveMock = jest.fn()
    const rejectMock = jest.fn()
    const req: UserRequest = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 1n
    })

    req.dappPromises = [
      { id: 'testID', resolve: resolveMock, reject: rejectMock, session: MOCK_SESSION, meta: {} }
    ]

    await controller.addUserRequests([req])
    expect(controller.userRequests.length).toBe(1)
    expect(controller.visibleUserRequests.length).toBe(1)

    await controller.resolveUserRequest(null, req.id)
    expect(controller.userRequests.length).toBe(0)
    expect(controller.visibleUserRequests.length).toBe(0)
    expect(resolveMock).toHaveBeenCalled()
    expect(rejectMock).not.toHaveBeenCalled()
  })
  test('reject user request', async () => {
    const { controller, getCallsRequest } = await prepareTest()

    const resolveMock = jest.fn()
    const rejectMock = jest.fn()

    const req: UserRequest = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 1n
    })

    req.dappPromises = [
      { id: 'testID', resolve: resolveMock, reject: rejectMock, session: MOCK_SESSION, meta: {} }
    ]

    await controller.addUserRequests([req])
    expect(controller.userRequests.length).toBe(1)
    expect(controller.visibleUserRequests.length).toBe(1)

    await controller.rejectUserRequests('User rejected', [req.id])
    expect(controller.userRequests.length).toBe(0)
    expect(controller.visibleUserRequests.length).toBe(0)
    expect(rejectMock).toHaveBeenCalled()
    expect(resolveMock).not.toHaveBeenCalled()
  })
  test('add multiple user requests', async () => {
    const { controller, getCallsRequest } = await prepareTest()
    const SIGN_ACCOUNT_OP_REQUEST = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 10n
    })
    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    await controller.addUserRequests([SIGN_ACCOUNT_OP_REQUEST])
    expect(controller.userRequests.length).toBe(2)
    expect(controller.visibleUserRequests.length).toBe(2)
    expect(controller.currentUserRequest).not.toBe(null)
    expect(controller.currentUserRequest!.kind).toBe(SIGN_ACCOUNT_OP_REQUEST.kind)
  })
  test('should set window loaded', async () => {
    const { controller } = await prepareTest()
    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    expect(controller.currentUserRequest).not.toBe(null)
    controller.setWindowLoaded()
    expect(controller.requestWindow.loaded).toEqual(true)
  })
  test('should reject calls and remove the user request', async () => {
    const { controller, getCallsRequest } = await prepareTest()
    const SIGN_ACCOUNT_OP_REQUEST = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 10n
    })
    await controller.addUserRequests([SIGN_ACCOUNT_OP_REQUEST])
    expect(controller.currentUserRequest).not.toBe(null)
    expect(
      (controller.currentUserRequest as CallsUserRequest).signAccountOp.accountOp.calls.length
    ).toBe(1)
    await controller.rejectCalls({ callIds: ['testID'] })
    expect(controller.currentUserRequest).toBe(null)
    expect(controller.userRequests.length).toBe(0)
  })
  test('should add request with priority', async () => {
    const { controller } = await prepareTest()
    const BENZIN_REQUEST: BenzinUserRequest = {
      id: 'test',
      kind: 'benzin',
      meta: {
        accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
        chainId: 10n,
        txnId: 'id',
        userOpHash: 'hash'
      },
      dappPromises: []
    }

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    await controller.addUserRequests([BENZIN_REQUEST], { position: 'first' })
    expect(controller.visibleUserRequests[0]).not.toBe(null)
    expect(controller.visibleUserRequests[0]!.kind).toBe('benzin')
  })
  test('should have banners', async () => {
    const { controller, getCallsRequest } = await prepareTest()
    const SIGN_ACCOUNT_OP_REQUEST = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 10n
    })

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    await controller.addUserRequests([SIGN_ACCOUNT_OP_REQUEST])

    expect(controller.banners).toHaveLength(2)
  })
  test('should update visible requests on account change', async () => {
    const { controller, selectedAccountCtrl, getCallsRequest } = await prepareTest()
    const SIGN_ACCOUNT_OP_REQUEST = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 10n
    })

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    await controller.addUserRequests([SIGN_ACCOUNT_OP_REQUEST])

    expect(controller.visibleUserRequests).toHaveLength(2)
    await selectedAccountCtrl.setAccount(accounts[0]! as any)
    expect(controller.visibleUserRequests).toHaveLength(1)
  })
  test('should select request by id', async () => {
    const { controller, getCallsRequest } = await prepareTest()
    const SIGN_ACCOUNT_OP_REQUEST = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 10n
    })

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    await controller.addUserRequests([SIGN_ACCOUNT_OP_REQUEST])

    expect(controller.currentUserRequest).toBe(SIGN_ACCOUNT_OP_REQUEST)
    await controller.setCurrentUserRequestById(DAPP_CONNECT_REQUEST.id)
    expect(controller.currentUserRequest).toBe(DAPP_CONNECT_REQUEST)
  })
  test('should select request by index', async () => {
    const { controller, getCallsRequest } = await prepareTest()
    const SIGN_ACCOUNT_OP_REQUEST = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 10n
    })

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    await controller.addUserRequests([SIGN_ACCOUNT_OP_REQUEST])

    expect(controller.currentUserRequest).toBe(SIGN_ACCOUNT_OP_REQUEST)
    await controller.setCurrentUserRequestByIndex(0)
    expect(controller.currentUserRequest).toBe(DAPP_CONNECT_REQUEST)
  })
  test('should focus out and then focus on the current request window', async () => {
    const { controller } = await prepareTest()

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])
    event.emit('windowFocusChange', 'random-window-id')
    let emitCounter = 0
    const finishPromise = new Promise((resolve) => {
      emitCounter++

      if (emitCounter === 1) {
        expect(controller.requestWindow.windowProps).not.toBe(null)
        expect(controller.requestWindow.windowProps?.focused).toEqual(false)
        event.emit('windowFocusChange', getWindowId())
      }
      if (emitCounter === 1) {
        expect(controller.requestWindow.windowProps).not.toBe(null)
        expect(controller.requestWindow.windowProps?.focused).toEqual(true)
        resolve(null)
      }
    })
    await finishPromise
  })
  test('should close the request window', async () => {
    const { controller } = await prepareTest()

    await controller.addUserRequests([DAPP_CONNECT_REQUEST])

    expect(controller.requestWindow.windowProps).not.toBe(null)
    await controller.closeRequestWindow()
    expect(controller.requestWindow.windowProps).toBe(null)
  })
  test('removeAccountData', async () => {
    const { controller, getCallsRequest } = await prepareTest()
    const SIGN_ACCOUNT_OP_REQUEST = await getCallsRequest({
      addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      chainId: 10n
    })

    await controller.addUserRequests([DAPP_CONNECT_REQUEST], {
      position: 'last',
      executionType: 'queue'
    })
    await controller.addUserRequests([SIGN_ACCOUNT_OP_REQUEST], {
      position: 'last',
      executionType: 'open-request-window'
    })

    expect(controller.userRequests.length).toBeGreaterThanOrEqual(2)

    // Remove account data
    controller.removeAccountData('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8')

    const globalActions = controller.userRequests.filter((a) => !['calls'].includes(a?.kind))

    expect(controller.userRequests).toHaveLength(globalActions.length)
  })
  test('should toJSON()', async () => {
    const { controller } = await prepareTest()

    const json = controller.toJSON()
    expect(json).toBeDefined()
  })
})
