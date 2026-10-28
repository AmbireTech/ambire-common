import fetch from 'node-fetch'

import { SwapAndBridgeController } from '@/controllers/swapAndBridge/swapAndBridge'
import { SwapAndBridgeFormStatus } from '@/libs/swapAndBridge/constants'
import { getTokenMarketDataKey } from '@/libs/swapAndBridge/tokenMarketData'
import { expect, jest } from '@jest/globals'

import { relayerUrl, velcroUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { suppressConsole } from '../../../test/helpers/console'
import { mockUiManager } from '../../../test/helpers/ui'
import { waitForFnToBeCalledAndExecuted } from '../../../test/recurringTimeout'
import EmittableError from '../../classes/EmittableError'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { networks } from '../../consts/networks'
import { IProvidersController } from '../../interfaces/provider'
import { IRequestsController } from '../../interfaces/requests'
import { Storage } from '../../interfaces/storage'
import { SocketAPIToken } from '../../interfaces/swapAndBridge'
import { HumanizerMeta } from '../../libs/humanizer/interfaces'
import { TokenResult } from '../../libs/portfolio'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import wait from '../../utils/wait'
import { AccountsController } from '../accounts/accounts'
import { ActivityController } from '../activity/activity'
import { AddressBookController } from '../addressBook/addressBook'
import { AutoLoginController } from '../autoLogin/autoLogin'
import { BannerController } from '../banner/banner'
import { ContractInfoController } from '../contractInfo/contractInfo'
import { Erc7730Controller } from '../erc7730/erc7730'
import { FeatureFlagsController } from '../featureFlags/featureFlags'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { PhishingController } from '../phishing/phishing'
import { PortfolioController } from '../portfolio/portfolio'
import { ProvidersController } from '../providers/providers'
import { RequestsController } from '../requests/requests'
import { SafeController } from '../safe/safe'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { SignAccountOpPreferenceController } from '../signAccountOp/signAccountOpPreference'
import { StorageController } from '../storage/storage'
import { SurveyController } from '../survey/survey'
import { TransferController } from '../transfer/transfer'
import { UiController } from '../ui/ui'
import { SocketAPIMock } from './socketApiMock'

const accounts = [
  {
    addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
    associatedKeys: [],
    initialPrivileges: [],
    creation: {
      factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
      bytecode:
        '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
      salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
    },
    preferences: {
      label: DEFAULT_ACCOUNT_LABEL,
      pfp: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    }
  }
]

const getSubmittedAccountOp = (
  txnId: string,
  activeRouteId?: string,
  status = 'broadcasted-but-not-confirmed',
  chainId?: bigint
) =>
  ({
    id: 'submitted-account-op-id',
    accountAddr: accounts[0]!.addr,
    signingKeyAddr: '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
    gasLimit: null,
    gasFeePayment: {
      isGasTank: false,
      paidBy: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      inToken: '0x0000000000000000000000000000000000000000',
      amount: 1n,
      simulatedGasLimit: 1n,
      gasPrice: 1n
    },
    chainId: chainId ? chainId : activeRouteId ? 10n : 1n,
    nonce: 225n,
    signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
    calls: [
      {
        to: '0x18Ce9CF7156584CDffad05003410C3633EFD1ad0',
        value: BigInt(0),
        data: '0x'
      }
    ],
    txnId,
    status,
    timestamp: Date.now(),
    identifiedBy: {
      type: 'Transaction',
      identifier: txnId
    },
    meta: activeRouteId
      ? {
          swapTxn: {
            activeRouteId,
            approvalData: null,
            chainId: 10,
            txData: '0x',
            txTarget: '0x0000000000000000000000000000000000000000',
            userTxIndex: 0,
            value: '0'
          }
        }
      : {}
  }) as any

// Notice
// The status of swapAndBridge.ts is a bit more difficult to test
// as we now have this code:
//
// this.signAccountOpController.estimation.onUpdate(() => {
//   if (
//     this.signAccountOpController?.accountOp.meta?.swapTxn?.activeRouteId &&
//     this.signAccountOpController.estimation.status === EstimationStatus.Error
//   ) {
//     // eslint-disable-next-line @typescript-eslint/no-floating-promises
//     this.onEstimationFailure(this.signAccountOpController.accountOp.meta.swapTxn.activeRouteId)
//   }
// })
//
// meaning we can't use fake data as the estimation is going to throw an error
// and it's going to cut the routes
// so the status of swapAndBridge.ts will always go to FetchingRoutes or NoRoutesFound
//
// In order to test the status better, we either need real data or a mock on signAccountOp

const storage: Storage = produceMemoryStore()
const storageCtrl = new StorageController(storage)
let providersCtrl: IProvidersController
const networksCtrl = new NetworksController({
  storage: storageCtrl,
  fetch,
  relayerUrl,
  useTempProvider: (props, cb) => {
    return providersCtrl.useTempProvider(props, cb)
  },
  onAddOrUpdateNetworks: () => {},
  onReady: async () => {
    await providersCtrl.init({ networks: networksCtrl.allNetworks })
  }
})

const { uiManager } = mockUiManager()
const uiCtrl = new UiController({ uiManager })
// Add the dashboard and swap-and-bridge routes
uiCtrl.addView({
  id: 'dashboard',
  type: 'tab',
  currentRoute: 'dashboard',
  isReady: true,
  searchParams: {}
})
uiCtrl.addView({
  id: 'swap-and-bridge',
  type: 'tab',
  currentRoute: 'dashboard',
  isReady: true,
  searchParams: {}
})

providersCtrl = new ProvidersController({
  storage: storageCtrl,
  getNetworks: () => networksCtrl.allNetworks,
  sendUiMessage: () => uiCtrl.message.sendUiMessage
})

const keystore = new KeystoreController('default', storageCtrl, {}, uiCtrl)

storage.set('selectedAccount', accounts[0]!.addr)

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
const autoLoginCtrl = new AutoLoginController(
  storageCtrl,
  keystore,
  providersCtrl,
  networksCtrl,
  accountsCtrl,
  {},
  new InviteController({ relayerUrl, fetch, storage: storageCtrl })
)
const surveyCtrl = new SurveyController({
  fetch,
  relayerUrl,
  storage: storageCtrl,
  ui: uiCtrl,
  dismissBanner: () => {}
})
const bannerCtrl = new BannerController(
  storageCtrl,
  () => ({
    status: 'has-selected-account',
    address: accounts[0]!.addr,
    hasKeys: true,
    numberOfTransactions: 0,
    totalUsdBalance: 0,
    isBalanceReady: true
  }),
  surveyCtrl,
  '1.0.0'
)
const selectedAccountCtrl = new SelectedAccountController({
  storage: storageCtrl,
  accounts: accountsCtrl,
  autoLogin: autoLoginCtrl,
  banner: bannerCtrl,
  ui: uiCtrl
})

const addressBookCtrl = new AddressBookController(storageCtrl, accountsCtrl, selectedAccountCtrl)

const callRelayer = relayerCall.bind({ url: '', fetch })
const featureFlagsCtrl = new FeatureFlagsController({}, storageCtrl)
const erc7730Ctrl = new Erc7730Controller({
  storage: storageCtrl,
  callRelayer,
  featureFlags: featureFlagsCtrl,
  providers: providersCtrl,
  ui: uiCtrl
})
const contractInfoCtrl = new ContractInfoController({
  fetch,
  storage: storageCtrl,
  featureFlags: featureFlagsCtrl,
  ui: uiCtrl
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
  bannerCtrl,
  featureFlagsCtrl,
  uiCtrl
)

const safe = new SafeController({
  networks: networksCtrl,
  providers: providersCtrl,
  storage: storageCtrl,
  accounts: accountsCtrl,
  keystore
})

const activityCtrl = new ActivityController(
  storageCtrl,
  fetch,
  callRelayer,
  accountsCtrl,
  selectedAccountCtrl,
  providersCtrl,
  networksCtrl,
  portfolioCtrl,
  safe,
  featureFlagsCtrl,
  () => Promise.resolve()
)

const phishingCtrl = new PhishingController({
  fetch,
  storage: storageCtrl,
  addressBook: addressBookCtrl,
  ui: uiCtrl,
  featureFlags: featureFlagsCtrl
})

const socketAPIMock = new SocketAPIMock({ fetch, apiKey: '' })

const PORTFOLIO_TOKENS = [
  {
    address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    amount: 2110000n,
    decimals: 6,
    flags: { onGasTank: false, rewardsType: null, isFeeToken: true, canTopUpGasTank: true },
    chainId: 10n,
    priceIn: [{ baseCurrency: 'usd', price: 0.99785 }],
    marketDataIn: [],
    symbol: 'USDT',
    name: 'Tether'
  },
  {
    address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    amount: 1852n,
    decimals: 8,
    flags: { onGasTank: false, rewardsType: null, isFeeToken: false, canTopUpGasTank: false },
    chainId: 8453n,
    priceIn: [{ baseCurrency: 'usd', price: 64325 }],
    marketDataIn: [],
    symbol: 'cbBTC',
    name: 'Coinbase wrapped BTC'
  },
  {
    address: '0x0000000000000000000000000000000000000000',
    amount: 11756728636013018n,
    decimals: 8,
    flags: { onGasTank: false, rewardsType: null, isFeeToken: true, canTopUpGasTank: true },
    chainId: 10n,
    priceIn: [{ baseCurrency: 'usd', price: 3660.27 }],
    marketDataIn: [],
    symbol: 'ETH',
    name: 'Ether'
  }
]

let requestsCtrl: IRequestsController | undefined
const signAccountOpPreference = new SignAccountOpPreferenceController({ storage: storageCtrl })
const dappsControllerMock = {
  dapps: [],
  isReady: true,
  onUpdate: () => () => {}
} as any

const buildSwapAndBridgeController = (controllerStorage: StorageController = storageCtrl) =>
  new SwapAndBridgeController({
    callRelayer: async () => ({}),
    fetch: fetch as any,
    selectedAccount: selectedAccountCtrl,
    networks: networksCtrl,
    accounts: accountsCtrl,
    activity: activityCtrl,
    storage: controllerStorage,
    signAccountOpPreference,
    featureFlags: featureFlagsCtrl,
    platform: 'browser-webkit',
    swapProvider: socketAPIMock as any,
    erc7730: erc7730Ctrl,
    contractInfo: contractInfoCtrl,
    keystore,
    portfolio: portfolioCtrl,
    providers: providersCtrl,
    phishing: phishingCtrl,
    dapps: dappsControllerMock,
    externalSignerControllers: {},
    relayerUrl,
    getUserRequests: () => [],
    getVisibleUserRequests: () => (requestsCtrl ? requestsCtrl.visibleUserRequests : []),
    onBroadcastSuccess: () => Promise.resolve(),
    onBroadcastFailed: () => {},
    ui: uiCtrl
  })

const swapAndBridgeController = buildSwapAndBridgeController()

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })

  return { promise, resolve }
}

const transferCtrl = new TransferController(
  async () => ({}),
  storageCtrl,
  signAccountOpPreference,
  featureFlagsCtrl,
  humanizerInfo as HumanizerMeta,
  selectedAccountCtrl,
  networksCtrl,
  addressBookCtrl,
  accountsCtrl,
  keystore,
  portfolioCtrl,
  activityCtrl,
  {},
  providersCtrl,
  phishingCtrl,
  dappsControllerMock,
  relayerUrl,
  () => Promise.resolve(),
  uiCtrl,
  erc7730Ctrl,
  contractInfoCtrl,
  'browser-webkit'
)

requestsCtrl = new RequestsController({
  relayerUrl,
  callRelayer,
  portfolio: portfolioCtrl,
  externalSignerControllers: {},
  activity: activityCtrl,
  phishing: phishingCtrl,
  dapps: dappsControllerMock,
  erc7730: erc7730Ctrl,
  contractInfo: contractInfoCtrl,
  accounts: accountsCtrl,
  networks: networksCtrl,
  providers: providersCtrl,
  storage: storageCtrl,
  featureFlags: featureFlagsCtrl,
  platform: 'browser-webkit',
  signAccountOpPreference,
  selectedAccount: selectedAccountCtrl,
  keystore,
  transfer: transferCtrl,
  swapAndBridge: swapAndBridgeController,
  ui: uiCtrl,
  safe,
  autoLogin: autoLoginCtrl,
  getDapp: async () => undefined,
  updateSelectedAccountPortfolio: () => Promise.resolve(),
  addTokensToBeLearned: () => {},
  onSetCurrentUserRequest: () => {},
  onBroadcastSuccess: async () => {},
  onBroadcastFailed: () => {}
})

describe('SwapAndBridge Controller', () => {
  beforeEach(() => {
    jest.spyOn(swapAndBridgeController.updateQuoteInterval, 'start').mockImplementation(jest.fn())
    jest.spyOn(swapAndBridgeController.updateQuoteInterval, 'restart').mockImplementation(jest.fn())
    jest.spyOn(swapAndBridgeController.updateQuoteInterval, 'stop').mockImplementation(jest.fn())
    jest
      .spyOn(swapAndBridgeController.updateActiveRoutesInterval, 'start')
      .mockImplementation(jest.fn())
    jest
      .spyOn(swapAndBridgeController.updateActiveRoutesInterval, 'restart')
      .mockImplementation(jest.fn())
    jest
      .spyOn(swapAndBridgeController.updateActiveRoutesInterval, 'stop')
      .mockImplementation(jest.fn())
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })
  test('should initialize', async () => {
    await storage.set('accounts', accounts)
    await selectedAccountCtrl.initialLoadPromise
    await selectedAccountCtrl.select({ account: accounts[0]! })

    expect(swapAndBridgeController).toBeDefined()
    // TODO: move these in beforeEach with an exception for the continuous updates tests where mocks are not needed
  })
  test('should persist and emit disabled swap providers without an active form session', async () => {
    expect(swapAndBridgeController.swapProviders).toEqual([{ id: 'socket', name: 'Socket' }])
    expect(swapAndBridgeController.getDisabledSwapProviderIds()).toEqual([])
    expect(swapAndBridgeController.sessionIds).toEqual([])

    const emittedDisabledProviderIds: string[][] = []
    const unsubscribe = swapAndBridgeController.onUpdate(() => {
      emittedDisabledProviderIds.push(swapAndBridgeController.getDisabledSwapProviderIds())
    })

    await swapAndBridgeController.setSwapProviderEnabled('unknown-provider', false)
    expect(swapAndBridgeController.getDisabledSwapProviderIds()).toEqual([])
    expect(emittedDisabledProviderIds).toEqual([])

    await swapAndBridgeController.setSwapProviderEnabled('socket', false)
    const disabledProviderIds = swapAndBridgeController.getDisabledSwapProviderIds()
    disabledProviderIds.push('mutated-copy')
    expect(swapAndBridgeController.getDisabledSwapProviderIds()).toEqual(['socket'])
    expect(emittedDisabledProviderIds).toContainEqual(['socket'])
    await expect(storageCtrl.get('disabledSwapProviderIds', [])).resolves.toEqual(['socket'])

    await swapAndBridgeController.setSwapProviderEnabled('socket', true)
    expect(swapAndBridgeController.getDisabledSwapProviderIds()).toEqual([])
    expect(emittedDisabledProviderIds).toContainEqual([])
    await expect(storageCtrl.get('disabledSwapProviderIds', [])).resolves.toEqual([])
    unsubscribe()
  })
  test('should clear the token list error and skip fetching when all providers are disabled', async () => {
    await swapAndBridgeController.initForm('all-providers-disabled-test')
    const toSelectedToken = swapAndBridgeController.toTokenShortList[0]!
    swapAndBridgeController.addOrUpdateError({
      id: 'to-token-list-fetch-failed',
      title: 'Token list fetch failed',
      level: 'error'
    })
    const getToTokenListSpy = jest.spyOn(socketAPIMock, 'getToTokenList')
    getToTokenListSpy.mockClear()

    await swapAndBridgeController.setSwapProviderEnabled('socket', false)

    expect(swapAndBridgeController.getDisabledSwapProviderIds()).toEqual(['socket'])
    expect(getToTokenListSpy).not.toHaveBeenCalled()
    expect(swapAndBridgeController.errors).not.toContainEqual(
      expect.objectContaining({ id: 'to-token-list-fetch-failed' })
    )

    swapAndBridgeController.toSelectedToken = toSelectedToken
    await swapAndBridgeController.updateToTokenList(true)

    expect(getToTokenListSpy).not.toHaveBeenCalled()
    expect(swapAndBridgeController.toSelectedToken).toBeNull()
    expect(swapAndBridgeController.errors).not.toContainEqual(
      expect.objectContaining({ id: 'to-token-list-fetch-failed' })
    )

    await swapAndBridgeController.setSwapProviderEnabled('socket', true)
    swapAndBridgeController.unloadScreen('all-providers-disabled-test', true)
  })
  test('should enable only CoW Swap when MEV protection is enabled', async () => {
    jest.spyOn(socketAPIMock, 'getProvidersInfo').mockReturnValue([
      { id: 'socket', name: 'Socket' },
      { id: 'uniswap', name: 'Uniswap' },
      { id: 'cowswap', name: 'CoW Swap' }
    ])
    const persistedStorage = new StorageController(produceMemoryStore())
    const controller = buildSwapAndBridgeController(persistedStorage)
    const sessionId = 'mev-protection-test'

    await controller.initForm(sessionId)
    controller.unloadScreen(sessionId, true)
    await controller.setSwapProviderEnabled('cowswap', false)
    await controller.setMevProtectionEnabled(true)

    expect(controller.getDisabledSwapProviderIds()).toEqual(['socket', 'uniswap'])
    await expect(persistedStorage.get('disabledSwapProviderIds', [])).resolves.toEqual([
      'socket',
      'uniswap'
    ])

    await controller.setSwapProviderEnabled('uniswap', true)

    expect(controller.getDisabledSwapProviderIds()).toEqual(['socket'])

    await controller.setMevProtectionEnabled(true)
    await controller.setMevProtectionEnabled(false)

    expect(controller.getDisabledSwapProviderIds()).toEqual([])
    await expect(persistedStorage.get('disabledSwapProviderIds', [])).resolves.toEqual([])
  })
  test('should ignore MEV protection when CoW Swap is unavailable', async () => {
    const persistedStorage = new StorageController(produceMemoryStore())
    const controller = buildSwapAndBridgeController(persistedStorage)
    const sessionId = 'mev-protection-without-cow-test'

    await controller.initForm(sessionId)
    controller.unloadScreen(sessionId, true)
    await controller.setSwapProviderEnabled('socket', false)
    await controller.setMevProtectionEnabled(true)

    expect(controller.getDisabledSwapProviderIds()).toEqual(['socket'])
    await expect(persistedStorage.get('disabledSwapProviderIds', [])).resolves.toEqual(['socket'])
  })
  test('should ignore stale supported chains when provider settings change rapidly', async () => {
    await swapAndBridgeController.initForm('rapid-provider-toggle-test')
    await wait(0)
    swapAndBridgeController.unloadScreen('rapid-provider-toggle-test')

    const staleSupportedChains =
      createDeferred<Awaited<ReturnType<SocketAPIMock['getSupportedChains']>>>()
    const latestSupportedChains =
      createDeferred<Awaited<ReturnType<SocketAPIMock['getSupportedChains']>>>()
    const getSupportedChainsSpy = jest
      .spyOn(socketAPIMock, 'getSupportedChains')
      .mockReturnValueOnce(staleSupportedChains.promise)
      .mockReturnValueOnce(latestSupportedChains.promise)

    const disablePromise = swapAndBridgeController.setSwapProviderEnabled('socket', false)
    await wait(0)
    expect(getSupportedChainsSpy).toHaveBeenCalledTimes(1)

    const enablePromise = swapAndBridgeController.setSwapProviderEnabled('socket', true)
    await wait(0)
    expect(getSupportedChainsSpy).toHaveBeenCalledTimes(2)

    const expectedSupportedChains = networks.map(({ chainId }) => ({ chainId }))
    latestSupportedChains.resolve(expectedSupportedChains)
    await enablePromise

    staleSupportedChains.resolve([{ chainId: 999999n }])
    await disablePromise

    expect(swapAndBridgeController.getDisabledSwapProviderIds()).toEqual([])
    expect(swapAndBridgeController.supportedChainIds).toEqual(
      expectedSupportedChains.map(({ chainId }) => chainId)
    )
  })
  test('should restore valid disabled swap providers from storage', async () => {
    const persistedStorage = new StorageController(produceMemoryStore())
    await persistedStorage.set('disabledSwapProviderIds', ['socket', 'unknown-provider', 'socket'])
    const restoredController = buildSwapAndBridgeController(persistedStorage)
    const getToTokenListSpy = jest.spyOn(socketAPIMock, 'getToTokenList')

    await restoredController.initForm('restore-disabled-providers-test')

    expect(restoredController.getDisabledSwapProviderIds()).toEqual(['socket'])
    expect(getToTokenListSpy).not.toHaveBeenCalled()
    expect(restoredController.errors).not.toContainEqual(
      expect.objectContaining({ id: 'to-token-list-fetch-failed' })
    )
    restoredController.unloadScreen('restore-disabled-providers-test', true)
  })
  test('should initForm', async () => {
    await swapAndBridgeController.initForm('1')
    expect(swapAndBridgeController.sessionIds).toContain('1')
  })
  test('should update portfolio token list', async () => {
    expect(swapAndBridgeController.fromChainId).toEqual(1)
    expect(swapAndBridgeController.fromSelectedToken).toEqual(null)
    await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS)
    expect(swapAndBridgeController.toTokenShortList).toHaveLength(3)
    expect(swapAndBridgeController.toTokenShortList).not.toContainEqual(
      expect.objectContaining({
        address: swapAndBridgeController.fromSelectedToken?.address
      })
    )
    expect(swapAndBridgeController.toSelectedToken).toBeNull()
    expect(swapAndBridgeController.fromSelectedToken).not.toBeNull()
    expect(swapAndBridgeController.fromSelectedToken?.address).toEqual(
      '0x0000000000000000000000000000000000000000' // the one with highest balance
    )
    expect(swapAndBridgeController.fromChainId).toEqual(10)
    expect(swapAndBridgeController.toChainId).toEqual(10)
  })
  test('should only require portfolio token prices when token prices are enabled', async () => {
    const controller = buildSwapAndBridgeController()
    const tokensWithoutPrices = PORTFOLIO_TOKENS.map((token) => ({ ...token, priceIn: [] }))

    try {
      await featureFlagsCtrl.setFeatureFlag('tokenPrices', true)
      await controller.updatePortfolioTokenList(tokensWithoutPrices)
      expect(controller.portfolioTokenList).toEqual([])

      await featureFlagsCtrl.setFeatureFlag('tokenPrices', false)
      await controller.updatePortfolioTokenList(tokensWithoutPrices)

      expect(controller.portfolioTokenList).toHaveLength(tokensWithoutPrices.length)
      expect(controller.fromSelectedToken).not.toBeNull()
    } finally {
      await featureFlagsCtrl.setFeatureFlag('tokenPrices', true)
    }
  })
  test('should expose the wrap exemption before a quote is available', () => {
    const network = networksCtrl.networks.find(({ chainId }) => chainId === 10n)
    if (!network?.wrappedAddr)
      throw new Error('Expected OP Mainnet to have a wrapped token address')

    const previousFromSelectedToken = swapAndBridgeController.fromSelectedToken
    const previousToSelectedToken = swapAndBridgeController.toSelectedToken
    const previousFromChainId = swapAndBridgeController.fromChainId
    const previousToChainId = swapAndBridgeController.toChainId
    const previousQuote = swapAndBridgeController.quote

    swapAndBridgeController.fromSelectedToken = PORTFOLIO_TOKENS[2]!
    swapAndBridgeController.toSelectedToken = {
      address: network.wrappedAddr,
      chainId: 10,
      decimals: 18,
      name: 'Wrapped Ether',
      symbol: 'WETH'
    }
    swapAndBridgeController.fromChainId = 10
    swapAndBridgeController.toChainId = 10
    swapAndBridgeController.quote = null

    expect(swapAndBridgeController.feeExemptionReason).toBe('wrap-or-unwrap')
    expect(swapAndBridgeController.toJSON().feeExemptionReason).toBe('wrap-or-unwrap')

    swapAndBridgeController.fromSelectedToken = previousFromSelectedToken
    swapAndBridgeController.toSelectedToken = previousToSelectedToken
    swapAndBridgeController.fromChainId = previousFromChainId
    swapAndBridgeController.toChainId = previousToChainId
    swapAndBridgeController.quote = previousQuote
  })
  test('should display the to token list once the first provider answers, without waiting for the rest', async () => {
    const partialToken: SocketAPIToken = {
      address: '0x0000000000000000000000000000000000000001',
      chainId: 137,
      decimals: 18,
      name: 'Partial token',
      symbol: 'PARTIAL',
      icon: '',
      logoURI: ''
    }
    const finalToken: SocketAPIToken = {
      address: '0x0000000000000000000000000000000000000002',
      chainId: 137,
      decimals: 18,
      name: 'Final token',
      symbol: 'FINAL',
      icon: '',
      logoURI: ''
    }
    let resolveTokenList!: (tokens: SocketAPIToken[]) => void
    const getToTokenListSpy = jest.spyOn(socketAPIMock, 'getToTokenList').mockImplementation(
      (params: any) =>
        new Promise((resolve) => {
          resolveTokenList = resolve
          params.onUpdate([partialToken], ['Slow provider'])
        })
    )

    await swapAndBridgeController.updateForm({ toChainId: 137 }, { updateQuote: false })

    expect(swapAndBridgeController.updateToTokenListStatus).toEqual('INITIAL')
    expect(swapAndBridgeController.toTokenShortList).toContain(partialToken)
    expect(swapAndBridgeController.toTokenListLoadingProviderNames).toEqual(['Slow provider'])

    let unsubscribe = () => {}
    const finalUpdatePromise = new Promise<void>((resolve) => {
      unsubscribe = swapAndBridgeController.onUpdate(() => {
        if (!swapAndBridgeController.toTokenShortList.includes(finalToken)) return

        unsubscribe()
        resolve()
      })
    })

    resolveTokenList([partialToken, finalToken])
    await finalUpdatePromise
    expect(swapAndBridgeController.toTokenListLoadingProviderNames).toEqual([])

    getToTokenListSpy.mockRestore()
    swapAndBridgeController.reset()
    await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS)
  })
  describe('requested to token missing from the first provider answer', () => {
    const fastProviderTokenAddr = '0x0000000000000000000000000000000000000001'
    const requestedTokenAddr = '0x0000000000000000000000000000000000000003'
    const fromTokenOnBase = PORTFOLIO_TOKENS[1]! // cbBTC on Base
    const createToken = (address: string, symbol: string, chainId: number): SocketAPIToken => ({
      address,
      chainId,
      decimals: 18,
      name: symbol,
      symbol,
      icon: '',
      logoURI: ''
    })

    // The fast provider answers at once, the slow one only when told to
    const mockSlowProvider = (fastProviderTokens: SocketAPIToken[]) => {
      const slowProvider: {
        reportTokenListUpdate: (tokens: SocketAPIToken[], loadingProviderNames: string[]) => void
        resolveTokenList: (tokens: SocketAPIToken[]) => void
      } = { reportTokenListUpdate: () => {}, resolveTokenList: () => {} }

      jest.spyOn(socketAPIMock, 'getToTokenList').mockImplementation(
        (params: any) =>
          new Promise((resolve) => {
            slowProvider.resolveTokenList = resolve
            slowProvider.reportTokenListUpdate = params.onUpdate
            params.onUpdate(fastProviderTokens, ['Slow provider'])
          })
      )

      return slowProvider
    }

    const waitForUpdate = (isDone: () => boolean) =>
      new Promise<void>((resolve) => {
        const unsubscribe = swapAndBridgeController.onUpdate(() => {
          if (!isDone()) return

          unsubscribe()
          resolve()
        })
      })

    afterEach(async () => {
      jest.mocked(socketAPIMock.getToTokenList).mockRestore()
      jest.mocked(socketAPIMock.getToken).mockRestore()
      swapAndBridgeController.reset()
      await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS)
    })

    test('is looked up and selected without waiting for a slower provider', async () => {
      // Each test uses its own pair of networks, so it never hits a list cached by another test
      const toChainId = 43114
      const fastProviderToken = createToken(fastProviderTokenAddr, 'FAST', toChainId)
      const slowProvider = mockSlowProvider([fastProviderToken])
      const getTokenSpy = jest.spyOn(socketAPIMock, 'getToken')

      await swapAndBridgeController.updateForm(
        { toChainId, toSelectedTokenAddr: requestedTokenAddr },
        { updateQuote: false }
      )

      expect(swapAndBridgeController.toTokenListLoadingProviderNames).toEqual(['Slow provider'])
      expect(getTokenSpy).toHaveBeenCalledTimes(1)
      expect(swapAndBridgeController.toSelectedToken?.address).toEqual(requestedTokenAddr)
      expect(swapAndBridgeController.isToTokenSelectionPending).toBe(false)

      slowProvider.resolveTokenList([fastProviderToken])
      await wait(0)
    })

    test('is selected once a slower provider lists it, when the lookup finds nothing', async () => {
      const toChainId = 43114
      const fastProviderToken = createToken(fastProviderTokenAddr, 'FAST', toChainId)
      const requestedToken = createToken(requestedTokenAddr, 'REQUESTED', toChainId)
      const slowProvider = mockSlowProvider([fastProviderToken])
      const getTokenSpy = jest.spyOn(socketAPIMock, 'getToken').mockResolvedValue(null as never)

      await swapAndBridgeController.updateForm(
        { fromSelectedToken: fromTokenOnBase, toChainId, toSelectedTokenAddr: requestedTokenAddr },
        { updateQuote: false }
      )

      expect(getTokenSpy).toHaveBeenCalledTimes(1)
      expect(swapAndBridgeController.toSelectedToken).toBeNull()
      expect(swapAndBridgeController.isToTokenSelectionPending).toBe(true)

      const selectionPromise = waitForUpdate(() => !!swapAndBridgeController.toSelectedToken)
      const fullTokenList = [fastProviderToken, requestedToken]
      slowProvider.reportTokenListUpdate(fullTokenList, [])
      await selectionPromise

      expect(swapAndBridgeController.toSelectedToken?.address).toEqual(requestedTokenAddr)
      expect(getTokenSpy).toHaveBeenCalledTimes(1)

      slowProvider.resolveTokenList(fullTokenList)
      await wait(0)
    })

    test('stops loading once every provider answered without it and the lookup found nothing', async () => {
      const toChainId = 137
      const fastProviderToken = createToken(fastProviderTokenAddr, 'FAST', toChainId)
      const slowProvider = mockSlowProvider([fastProviderToken])
      const getTokenSpy = jest.spyOn(socketAPIMock, 'getToken').mockResolvedValue(null as never)

      await swapAndBridgeController.updateForm(
        { fromSelectedToken: fromTokenOnBase, toChainId, toSelectedTokenAddr: requestedTokenAddr },
        { updateQuote: false }
      )

      expect(swapAndBridgeController.isToTokenSelectionPending).toBe(true)

      const settledPromise = waitForUpdate(() => !swapAndBridgeController.isToTokenSelectionPending)
      slowProvider.resolveTokenList([fastProviderToken])
      await settledPromise

      expect(swapAndBridgeController.toSelectedToken).toBeNull()
      // Not looked up again for the slower provider's answer
      expect(getTokenSpy).toHaveBeenCalledTimes(1)
    })

    test('is neither looked up nor selected when the list bans it', async () => {
      const toChainId = 1
      // An old JPYC, left out of the Ethereum to token list
      const bannedTokenAddr = '0x431D5dfF03120AFA4bDf332c61A6e1766eF37BDB'
      const bannedToken = createToken(bannedTokenAddr, 'JPYC', toChainId)
      const fastProviderToken = createToken(fastProviderTokenAddr, 'FAST', toChainId)
      const slowProvider = mockSlowProvider([fastProviderToken])
      const getTokenSpy = jest
        .spyOn(socketAPIMock, 'getToken')
        // Stops finding it after two lookups, so a lookup loop fails the test instead of hanging it
        .mockResolvedValueOnce(bannedToken)
        .mockResolvedValueOnce(bannedToken)
        .mockResolvedValue(null as never)

      await swapAndBridgeController.updateForm(
        { fromSelectedToken: fromTokenOnBase, toChainId, toSelectedTokenAddr: bannedTokenAddr },
        { updateQuote: false }
      )

      expect(getTokenSpy).not.toHaveBeenCalled()
      expect(swapAndBridgeController.toSelectedToken).toBeNull()
      expect(swapAndBridgeController.isToTokenSelectionPending).toBe(false)

      slowProvider.resolveTokenList([fastProviderToken])
      await wait(0)
    })
  })
  test('should look up a requested to token that no provider lists only once, even if the list updates meanwhile', async () => {
    const toChainId = 8453
    const missingToken: SocketAPIToken = {
      address: '0x00000000000000000000000000000000000000aa',
      chainId: toChainId,
      decimals: 18,
      name: 'Missing token',
      symbol: 'MISSING',
      icon: '',
      logoURI: ''
    }
    const lookupStarted = createDeferred<void>()
    const lookup = createDeferred<SocketAPIToken>()
    const getTokenSpy = jest.spyOn(socketAPIMock, 'getToken').mockImplementation(async () => {
      lookupStarted.resolve()
      return lookup.promise
    })

    const selectionPromise = swapAndBridgeController.updateForm(
      { toChainId, toSelectedTokenAddr: missingToken.address },
      { updateQuote: false }
    )
    await lookupStarted.promise

    // Portfolio refreshes and repeated requests for the same token while the lookup runs
    const listUpdatesPromise = Promise.all([
      swapAndBridgeController.updateToTokenList(false),
      swapAndBridgeController.updateToTokenList(false, missingToken.address)
    ])
    await wait(0)

    lookup.resolve(missingToken)
    await Promise.all([selectionPromise, listUpdatesPromise])
    await swapAndBridgeController.searchToToken(missingToken.address)

    expect(getTokenSpy).toHaveBeenCalledTimes(1)
    expect(swapAndBridgeController.toSelectedToken?.address).toEqual(missingToken.address)
    const matchingAddresses = swapAndBridgeController.toTokenSearchResults
      .map(({ address }) => address)
      .filter((address) => address === missingToken.address)
    expect(matchingAddresses).toEqual([missingToken.address])

    getTokenSpy.mockRestore()
    swapAndBridgeController.reset()
    await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS)
  })
  test('should keep a to token added by address when a slower provider answers later', async () => {
    // A network no other test fetches the list of, so the list is never cached
    const toChainId = 534352
    const createToken = (address: string, symbol: string): SocketAPIToken => ({
      address,
      chainId: toChainId,
      decimals: 18,
      name: symbol,
      symbol,
      icon: '',
      logoURI: ''
    })
    const fastProviderToken = createToken('0x0000000000000000000000000000000000000001', 'FAST')
    const slowProviderToken = createToken('0x0000000000000000000000000000000000000002', 'SLOW')
    const addedTokenAddr = '0x00000000000000000000000000000000000000bb'
    let reportTokenListUpdate!: (tokens: SocketAPIToken[], loadingProviderNames: string[]) => void
    let resolveTokenList!: (tokens: SocketAPIToken[]) => void
    const getToTokenListSpy = jest.spyOn(socketAPIMock, 'getToTokenList').mockImplementation(
      (params: any) =>
        new Promise((resolve) => {
          resolveTokenList = resolve
          reportTokenListUpdate = params.onUpdate
          params.onUpdate([fastProviderToken], ['Slow provider'])
        })
    )

    await swapAndBridgeController.updateForm({ toChainId }, { updateQuote: false })
    await swapAndBridgeController.addToTokenByAddress(addedTokenAddr)

    const getSearchedAddresses = () =>
      swapAndBridgeController.toTokenSearchResults.map(({ address }) => address)
    expect(getSearchedAddresses()).toEqual([addedTokenAddr])

    let unsubscribe = () => {}
    const laterAnswerPromise = new Promise<void>((resolve) => {
      unsubscribe = swapAndBridgeController.onUpdate(() => {
        if (!swapAndBridgeController.toTokenShortList.includes(slowProviderToken)) return

        unsubscribe()
        resolve()
      })
    })

    const fullTokenList = [fastProviderToken, slowProviderToken]
    reportTokenListUpdate(fullTokenList, [])
    await laterAnswerPromise

    expect(getSearchedAddresses()).toEqual([addedTokenAddr])

    resolveTokenList(fullTokenList)
    await wait(0)
    getToTokenListSpy.mockRestore()
    swapAndBridgeController.reset()
    await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS)
  })
  test('should stop waiting for a requested to token when all providers get disabled', async () => {
    // A network no other test fetches the list of, so the list is never cached
    const toChainId = 5000
    const listRequested = createDeferred<void>()
    const providerAnswer = createDeferred<SocketAPIToken[]>()
    const getToTokenListSpy = jest
      .spyOn(socketAPIMock, 'getToTokenList')
      .mockImplementation(async () => {
        listRequested.resolve()
        return providerAnswer.promise
      })

    const selectionPromise = swapAndBridgeController.updateForm(
      { toChainId, toSelectedTokenAddr: '0x00000000000000000000000000000000000000cc' },
      { updateQuote: false }
    )
    await listRequested.promise
    expect(swapAndBridgeController.isToTokenSelectionPending).toBe(true)

    await swapAndBridgeController.setSwapProviderEnabled('socket', false)

    expect(swapAndBridgeController.isToTokenSelectionPending).toBe(false)

    providerAnswer.resolve([])
    await selectionPromise
    getToTokenListSpy.mockRestore()
    await swapAndBridgeController.setSwapProviderEnabled('socket', true)
    swapAndBridgeController.reset()
    await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS)
  })
  test('should sync toChainId to the preselected from token chain when no to token is provided', async () => {
    const preselectedToken = PORTFOLIO_TOKENS[1]!

    swapAndBridgeController.reset()
    await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS, {
      preselectedToken: {
        address: preselectedToken.address,
        chainId: preselectedToken.chainId
      }
    })

    expect(swapAndBridgeController.fromSelectedToken?.address).toEqual(preselectedToken.address)
    expect(swapAndBridgeController.fromChainId).toEqual(Number(preselectedToken.chainId))
    expect(swapAndBridgeController.toChainId).toEqual(Number(preselectedToken.chainId))

    swapAndBridgeController.reset()
    await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS)
  })
  test('should select a preselected to token that the service provider returns in another case', async () => {
    // Trending tokens carry lowercased CoinGecko addresses, while the service providers return
    // checksummed ones.
    const toTokenAddr = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'

    swapAndBridgeController.reset()
    await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS, {
      preselectedToToken: { address: toTokenAddr.toLowerCase(), chainId: 8453n }
    })

    expect(swapAndBridgeController.toChainId).toEqual(8453)
    expect(swapAndBridgeController.toSelectedToken?.address).toEqual(toTokenAddr)

    swapAndBridgeController.reset()
    await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS)
  })
  test('should select a preselected to token that is missing from the service provider list', async () => {
    const toTokenAddr = '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984'

    swapAndBridgeController.reset()
    await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS, {
      preselectedToToken: { address: toTokenAddr, chainId: 8453n }
    })

    expect(swapAndBridgeController.toSelectedToken?.address).toEqual(toTokenAddr)
    expect(swapAndBridgeController.toTokenShortList).toContainEqual(
      expect.objectContaining({ address: toTokenAddr })
    )

    swapAndBridgeController.reset()
    await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS)
  })
  test('should keep a preselected to token when the from token network changes', async () => {
    const toTokenAddr = '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58' // USDT
    const fromToken = PORTFOLIO_TOKENS[2]! // ETH on Optimism
    const fromTokenOnAnotherChain = PORTFOLIO_TOKENS[1]! // cbBTC on Base

    swapAndBridgeController.reset()
    await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS, {
      preselectedToken: { address: fromToken.address, chainId: fromToken.chainId },
      preselectedToToken: { address: toTokenAddr, chainId: 8453n }
    })
    expect(swapAndBridgeController.fromChainId).toEqual(10)
    expect(swapAndBridgeController.toSelectedToken?.address).toEqual(toTokenAddr)

    await swapAndBridgeController.updateForm({ fromSelectedToken: fromTokenOnAnotherChain })

    expect(swapAndBridgeController.fromChainId).toEqual(8453)
    expect(swapAndBridgeController.toChainId).toEqual(8453)
    expect(swapAndBridgeController.toSelectedToken?.address).toEqual(toTokenAddr)

    swapAndBridgeController.reset()
    await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS)
  })
  test('should keep a to token the user selected when the from token network changes', async () => {
    const toTokenAddr = '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58' // USDT
    const userSelectedToTokenAddr = '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22' // cbETH
    const fromToken = PORTFOLIO_TOKENS[2]! // ETH on Optimism
    const fromTokenOnAnotherChain = PORTFOLIO_TOKENS[1]! // cbBTC on Base

    swapAndBridgeController.reset()
    await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS, {
      preselectedToken: { address: fromToken.address, chainId: fromToken.chainId },
      preselectedToToken: { address: toTokenAddr, chainId: 8453n }
    })
    await swapAndBridgeController.updateForm(
      { toSelectedTokenAddr: userSelectedToTokenAddr },
      { isToSelectionByUser: true }
    )
    expect(swapAndBridgeController.toSelectedToken?.address).toEqual(userSelectedToTokenAddr)

    await swapAndBridgeController.updateForm({ fromSelectedToken: fromTokenOnAnotherChain })

    expect(swapAndBridgeController.fromChainId).toEqual(8453)
    expect(swapAndBridgeController.toSelectedToken?.address).toEqual(userSelectedToTokenAddr)

    swapAndBridgeController.reset()
    await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS)
  })
  describe('preselected to token while the to token list is still loading', () => {
    const toTokenAddr = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' // cbBTC, in the mocked list

    // Holds the provider's answer until released, like a slow provider does
    const holdToTokenList = () => {
      const getToTokenList = socketAPIMock.getToTokenList.bind(socketAPIMock)
      let release!: () => void
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      let markRequested!: () => void
      const requested = new Promise<void>((resolve) => {
        markRequested = resolve
      })
      jest.spyOn(socketAPIMock, 'getToTokenList').mockImplementation(async (params: any) => {
        markRequested()
        await released
        return getToTokenList(params)
      })
      return { requested, release }
    }

    afterEach(async () => {
      swapAndBridgeController.reset()
      await swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS)
    })

    test('is selected once the list loads', async () => {
      // Each test uses its own network, so it never hits a list cached by another test
      const toChainId = 42161
      const { requested, release } = holdToTokenList()
      swapAndBridgeController.reset()

      const preselectPromise = swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS, {
        preselectedToToken: { address: toTokenAddr, chainId: BigInt(toChainId) }
      })
      await requested
      release()
      await preselectPromise

      expect(swapAndBridgeController.toChainId).toEqual(toChainId)
      expect(swapAndBridgeController.toSelectedToken?.address).toEqual(toTokenAddr)
    })

    test('is kept when a portfolio refresh changes the from token balance while the list loads', async () => {
      const toChainId = 56
      const fromToken = PORTFOLIO_TOKENS[2]! // ETH on Optimism
      const { requested, release } = holdToTokenList()
      swapAndBridgeController.reset()

      const preselectPromise = swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS, {
        preselectedToken: { address: fromToken.address, chainId: fromToken.chainId },
        preselectedToToken: { address: toTokenAddr, chainId: BigInt(toChainId) }
      })
      await requested

      const refreshedPortfolio = PORTFOLIO_TOKENS.map((token) =>
        token === fromToken ? { ...token, amount: token.amount + 1n } : token
      )
      const refreshPromise = swapAndBridgeController.updatePortfolioTokenList(refreshedPortfolio)
      await wait(0)

      release()
      await Promise.all([preselectPromise, refreshPromise])

      expect(swapAndBridgeController.toChainId).toEqual(toChainId)
      expect(swapAndBridgeController.toSelectedToken?.address).toEqual(toTokenAddr)
    })

    test('is selected from the new list when the from token network changes while the list loads', async () => {
      const toChainId = 534352
      const fromToken = PORTFOLIO_TOKENS[2]! // ETH on Optimism
      const fromTokenOnAnotherChain = PORTFOLIO_TOKENS[1]! // cbBTC on Base
      const { requested, release } = holdToTokenList()
      swapAndBridgeController.reset()

      const preselectPromise = swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS, {
        preselectedToken: { address: fromToken.address, chainId: fromToken.chainId },
        preselectedToToken: { address: toTokenAddr, chainId: BigInt(toChainId) }
      })
      await requested

      const fromChangePromise = swapAndBridgeController.updateForm({
        fromSelectedToken: fromTokenOnAnotherChain
      })
      await wait(0)

      release()
      await Promise.all([preselectPromise, fromChangePromise])

      expect(swapAndBridgeController.fromChainId).toEqual(Number(fromTokenOnAnotherChain.chainId))
      expect(swapAndBridgeController.toChainId).toEqual(toChainId)
      expect(swapAndBridgeController.toSelectedToken?.address).toEqual(toTokenAddr)
    })
  })
  describe('preselected to token when the form is kept from a previous screen', () => {
    const toChainId = 8453
    const toTokenAddr = '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58' // USDT
    const keptToTokenAddr = '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22' // cbETH
    let controller: SwapAndBridgeController
    let portfolioReplacement: { restore: () => void }

    const openScreenWithKeptToToken = async (sessionId: string) => {
      await controller.initForm(sessionId)
      await controller.updateForm(
        { toChainId, toSelectedTokenAddr: keptToTokenAddr },
        { isToSelectionByUser: true }
      )
      expect(controller.toSelectedToken?.address).toEqual(keptToTokenAddr)
    }

    beforeEach(() => {
      controller = buildSwapAndBridgeController()
      // initForm reads the "from" tokens from the selected account's portfolio
      portfolioReplacement = jest.replaceProperty(selectedAccountCtrl, 'portfolio', {
        ...selectedAccountCtrl.portfolio,
        tokens: PORTFOLIO_TOKENS
      })
    })

    afterEach(() => {
      ;[...controller.sessionIds].forEach((sessionId) => controller.unloadScreen(sessionId, true))
      portfolioReplacement.restore()
    })

    test('is selected when the popup session kept the previous form', async () => {
      await openScreenWithKeptToToken('popup')
      // The popup keeps a filled form when the user leaves the screen
      controller.unloadScreen('popup')
      expect(controller.sessionIds).toEqual(['popup'])

      await controller.initForm('popup', {
        preselectedToToken: { address: toTokenAddr, chainId: BigInt(toChainId) }
      })

      expect(controller.sessionIds).toEqual(['popup'])
      expect(controller.toChainId).toEqual(toChainId)
      expect(controller.toSelectedToken?.address).toEqual(toTokenAddr)
    })

    test('is selected when another open screen keeps the form', async () => {
      await openScreenWithKeptToToken('first-screen')
      const keptFromTokenAddr = controller.fromSelectedToken?.address

      await controller.initForm('second-screen', {
        preselectedToToken: { address: toTokenAddr, chainId: BigInt(toChainId) }
      })

      expect(controller.sessionIds).toEqual(['first-screen', 'second-screen'])
      expect(controller.fromSelectedToken?.address).toEqual(keptFromTokenAddr)
      expect(controller.toSelectedToken?.address).toEqual(toTokenAddr)
    })

    test('replaces the kept to token when the from token was switched from a to token', async () => {
      await openScreenWithKeptToToken('first-screen')
      await controller.switchFromAndToTokens()
      expect(controller.fromSelectedToken?.isSwitchedToToken).toBe(true)

      await controller.initForm('second-screen', {
        preselectedToToken: { address: toTokenAddr, chainId: BigInt(toChainId) }
      })

      expect(controller.fromSelectedToken?.isSwitchedToToken).toBeFalsy()
      expect(controller.toSelectedToken?.address).toEqual(toTokenAddr)
    })

    test('does not keep the previous to token as the to token of a preselected from token', async () => {
      const fromToken = PORTFOLIO_TOKENS[1]! // cbBTC on Base, also in the mocked to token list
      await controller.initForm('popup')
      await controller.updateForm(
        { toChainId: Number(fromToken.chainId), toSelectedTokenAddr: fromToken.address },
        { isToSelectionByUser: true }
      )
      expect(controller.toSelectedToken?.address).toEqual(fromToken.address)
      controller.unloadScreen('popup')

      await controller.initForm('popup', {
        preselectedFromToken: { address: fromToken.address, chainId: fromToken.chainId }
      })

      expect(controller.fromSelectedToken?.address).toEqual(fromToken.address)
      expect(controller.toSelectedToken).toBeNull()
      expect(controller.toChainId).toEqual(Number(fromToken.chainId))
    })

    test('keeps the form when an open session is opened again without a preselected token', async () => {
      await openScreenWithKeptToToken('popup')
      controller.unloadScreen('popup')

      await controller.initForm('popup')

      expect(controller.sessionIds).toEqual(['popup'])
      expect(controller.toSelectedToken?.address).toEqual(keptToTokenAddr)
    })
  })
  test('should update toChainId', (done) => {
    let emitCounter = 0
    const unsubscribe = swapAndBridgeController.onUpdate(async () => {
      emitCounter++
      if (emitCounter === 3) {
        expect(swapAndBridgeController.toChainId).toEqual(8453)
        unsubscribe()
        done()
      }
    })
    swapAndBridgeController.updateForm({ toChainId: 8453 })
  })
  test('should select toToken', (done) => {
    let emitCounter = 0
    const unsubscribe = swapAndBridgeController.onUpdate(async () => {
      emitCounter++
      if (emitCounter === 1) {
        expect(swapAndBridgeController.toChainId).toEqual(8453)
        unsubscribe()
        done()
      }
    })
    swapAndBridgeController.updateForm({
      toSelectedTokenAddr: swapAndBridgeController.toTokenShortList[0]!.address
    })
  })
  test('should update fromAmount', (done) => {
    // Asserting on the status transitions instead of on a fixed number of emits, as
    // the controller also emits for updates unrelated to the form (fetching the market
    // data of the receive tokens, for instance).
    let didPassThroughFetchingRoutes = false
    const unsubscribe = swapAndBridgeController.onUpdate(async () => {
      if (swapAndBridgeController.formStatus === 'fetching-routes')
        didPassThroughFetchingRoutes = true

      if (swapAndBridgeController.formStatus === 'ready-to-estimate') {
        expect(didPassThroughFetchingRoutes).toBe(true)
        expect(swapAndBridgeController.quote).not.toBeNull()
        expect(swapAndBridgeController.fromAmount).toBe('0.8')
        unsubscribe()
        done()
      }
    })
    swapAndBridgeController.updateForm({ fromAmount: '0.8' })
  })
  test('should keep the provider quote when the receive token price lookup times out', async () => {
    jest.useFakeTimers()
    const { restore } = suppressConsole()
    jest.spyOn(portfolioCtrl, 'getTokenPrice').mockImplementation(() => new Promise(() => {}))
    jest.spyOn(swapAndBridgeController, 'initSignAccountOpIfNeeded').mockResolvedValue()

    const updateQuotePromise = swapAndBridgeController.updateQuote({
      skipQuoteUpdateOnSameValues: false
    })

    await jest.advanceTimersByTimeAsync(4000)
    await updateQuotePromise

    expect(swapAndBridgeController.quote).not.toBeNull()

    jest.clearAllTimers()
    jest.useRealTimers()
    restore()
  })
  test('should emit quote failures silently', async () => {
    const { restore } = suppressConsole()
    const emittedErrorLevels: string[] = []
    const unsubscribe = swapAndBridgeController.onError((error) => {
      emittedErrorLevels.push(error.level)
    })
    jest.spyOn(socketAPIMock, 'quote').mockRejectedValueOnce(new Error('Quote failed'))

    await swapAndBridgeController.updateQuote({ skipQuoteUpdateOnSameValues: false })

    expect(emittedErrorLevels).toEqual(['silent'])

    unsubscribe()
    await swapAndBridgeController.updateQuote({ skipQuoteUpdateOnSameValues: false })
    expect(swapAndBridgeController.quote).not.toBeNull()
    restore()
  })
  test('should emit receive token lookup failures silently', async () => {
    const { restore } = suppressConsole()
    const emittedErrorLevels: string[] = []
    const unsubscribe = swapAndBridgeController.onError((error) => {
      emittedErrorLevels.push(error.level)
    })
    jest.spyOn(socketAPIMock, 'getToken').mockRejectedValueOnce(new Error('Token lookup failed'))

    await swapAndBridgeController.addToTokenByAddress('0x0000000000000000000000000000000000000001')

    expect(emittedErrorLevels).toEqual(['silent'])

    unsubscribe()
    restore()
  })
  describe('receive token that no provider lists', () => {
    // A token added by address stays in the shared token list, so each test uses its own address
    const getTokenAddress = (suffix: string) => `0x00000000000000000000000000000000000000${suffix}`
    const makeChainToken = (address: string, overrides: Partial<TokenResult> = {}) =>
      ({
        address,
        chainId: BigInt(swapAndBridgeController.toChainId!),
        symbol: 'ONCHAIN',
        name: 'On-chain token',
        decimals: 6,
        amount: 0n,
        priceIn: [],
        marketDataIn: [],
        ...overrides
      }) as TokenResult
    let isTokenSupported: jest.Mock<() => Promise<boolean>>

    const mockLookup = ({
      isSupported,
      chainResult
    }: {
      isSupported: boolean
      chainResult: [string, TokenResult][]
    }) => {
      jest.spyOn(socketAPIMock, 'getToken').mockResolvedValue(null as never)
      isTokenSupported = jest.fn<() => Promise<boolean>>().mockResolvedValue(isSupported)
      Object.assign(socketAPIMock, { isTokenSupported })
      return jest.spyOn(portfolioCtrl, 'getTokensInfo').mockResolvedValue(chainResult)
    }
    const getSearchedAddresses = () =>
      swapAndBridgeController.toTokenSearchResults.map(({ address }) => address)

    afterEach(() => {
      jest.mocked(socketAPIMock.getToken).mockRestore()
      jest.mocked(portfolioCtrl.getTokensInfo).mockRestore()
      delete (socketAPIMock as any).isTokenSupported
    })

    test('is read from the chain when a provider can trade it', async () => {
      const address = getTokenAddress('cc')
      const readSpy = mockLookup({
        isSupported: true,
        chainResult: [['0x', makeChainToken(address)]]
      })

      await swapAndBridgeController.addToTokenByAddress(address)

      expect(isTokenSupported).toHaveBeenCalledTimes(1)
      expect(readSpy).toHaveBeenCalledTimes(1)
      expect(readSpy).toHaveBeenCalledWith(BigInt(swapAndBridgeController.toChainId!), [address])
      expect(getSearchedAddresses()).toEqual([address])
      expect(swapAndBridgeController.toTokenSearchResults[0]).toMatchObject({
        symbol: 'ONCHAIN',
        decimals: 6,
        icon: ''
      })
    })

    test('is not read from the chain when no provider can trade it', async () => {
      const { restore } = suppressConsole()
      const address = getTokenAddress('dd')
      const readSpy = mockLookup({
        isSupported: false,
        chainResult: [['0x', makeChainToken(address)]]
      })

      await swapAndBridgeController.addToTokenByAddress(address)

      expect(isTokenSupported).toHaveBeenCalledTimes(1)
      expect(readSpy).not.toHaveBeenCalled()
      expect(getSearchedAddresses()).not.toContain(address)
      restore()
    })

    test('is not added when the address is not a token on the chain', async () => {
      const { restore } = suppressConsole()
      const address = getTokenAddress('ee')
      const readSpy = mockLookup({
        isSupported: true,
        chainResult: [
          ['0x756e6b6e', makeChainToken(address, { symbol: '', name: '', decimals: 0 })]
        ]
      })

      await swapAndBridgeController.addToTokenByAddress(address)

      expect(readSpy).toHaveBeenCalledTimes(1)
      expect(getSearchedAddresses()).not.toContain(address)
      restore()
    })

    test('is not looked up on the chain when a provider lists it', async () => {
      const address = getTokenAddress('ff')
      const readSpy = mockLookup({
        isSupported: true,
        chainResult: [['0x', makeChainToken(address)]]
      })
      jest.spyOn(socketAPIMock, 'getToken').mockResolvedValue({
        address,
        chainId: swapAndBridgeController.toChainId!,
        decimals: 18,
        name: 'Listed token',
        symbol: 'LISTED',
        icon: '',
        logoURI: ''
      } as never)

      await swapAndBridgeController.addToTokenByAddress(address)

      expect(isTokenSupported).not.toHaveBeenCalled()
      expect(readSpy).not.toHaveBeenCalled()
      expect(getSearchedAddresses()).toEqual([address])
      expect(swapAndBridgeController.toTokenSearchResults[0]).toMatchObject({ symbol: 'LISTED' })
    })
  })
  test('should switch from and to tokens', async () => {
    const prevFromChainId = swapAndBridgeController.fromChainId
    const prevToChainId = swapAndBridgeController.toChainId
    const prevFromSelectedTokenAddress = swapAndBridgeController.fromSelectedToken?.address
    const prevToSelectedTokenAddress = swapAndBridgeController.toSelectedToken?.address
    await swapAndBridgeController.switchFromAndToTokens()
    expect(swapAndBridgeController.fromChainId).toEqual(prevToChainId)
    expect(swapAndBridgeController.toChainId).toEqual(prevFromChainId)
    expect(swapAndBridgeController.toSelectedToken?.address).toEqual(prevFromSelectedTokenAddress)
    expect(swapAndBridgeController.fromSelectedToken?.address).toEqual(prevToSelectedTokenAddress)
    // The switched-in token has fewer decimals, so the carried over amount rounds down to
    // nothing - the fiat amount has to follow it instead of keeping the previous token's value
    expect(Number(swapAndBridgeController.fromAmount)).toBeLessThan(1e-8)
    expect(Number(swapAndBridgeController.fromAmountInFiat)).toBe(0)
    await swapAndBridgeController.switchFromAndToTokens()
    expect(swapAndBridgeController.fromChainId).toEqual(prevFromChainId)
    expect(swapAndBridgeController.toChainId).toEqual(prevToChainId)
    expect(swapAndBridgeController.toSelectedToken?.address).toEqual(prevToSelectedTokenAddress)
    expect(swapAndBridgeController.fromSelectedToken?.address).toEqual(prevFromSelectedTokenAddress)
  })
  test('should update fromAmount to make the form valid again', async () => {
    swapAndBridgeController.updateForm({ fromAmount: '0.02' })

    const check = async (attempt = 0) => {
      if (attempt > 10) {
        throw new Error('Quote timeout')
      }
      if (swapAndBridgeController.updateQuoteStatus === 'LOADING') {
        await wait(1000)
        await check(attempt + 1)
        return
      }

      expect(swapAndBridgeController.quote).toBeDefined()
    }

    await check()
  })
  test('should not refresh the quote while the swap is being signed, even if the screen that proceeded is gone', async () => {
    const quoteBeingSigned = swapAndBridgeController.quote
    expect(quoteBeingSigned).toBeTruthy()
    const getQuoteSpy = jest.spyOn(socketAPIMock, 'quote')

    swapAndBridgeController.setUserProceeded(true)
    // A real sign controller can't be built here, as estimating the swap needs the network.
    // Signing with a hardware wallet that waits for the user to confirm on the device:
    const isSigningSpy = jest
      .spyOn(swapAndBridgeController, 'isSignAndBroadcastInProgress', 'get')
      .mockReturnValue(true)
    // The popup is force-unloaded once the request window that took over the signing opens
    swapAndBridgeController.unloadScreen('popup', true)
    expect(swapAndBridgeController.hasProceeded).toBe(false)

    expect(swapAndBridgeController.formStatus).toBe(SwapAndBridgeFormStatus.Proceeded)
    await swapAndBridgeController.updateQuote({ skipQuoteUpdateOnSameValues: false })
    expect(getQuoteSpy).not.toHaveBeenCalled()
    expect(swapAndBridgeController.quote).toBe(quoteBeingSigned)

    // e.g. the user rejected on the device
    isSigningSpy.mockReturnValue(false)
    expect(swapAndBridgeController.formStatus).not.toBe(SwapAndBridgeFormStatus.Proceeded)
  })
  describe('continuous quote updates', () => {
    beforeEach(() => {
      // These tests need real interval behavior - undo the outer beforeEach mocks
      jest.restoreAllMocks()
    })

    it('should continuously update the quote', async () => {
      // Set #isOnSwapAndBridgeRoute = true so #shouldAutoUpdateQuote can pass.
      // The controller listens on 'updateView' (not 'addView'), so we add a view
      // with a different route first, then update it to 'swap-and-bridge'.
      // Must happen before useFakeTimers so the restart() queued by the listener
      // resolves immediately and doesn't interfere with the test timers.
      uiCtrl.addView({ id: 'test-quote', type: 'tab', currentRoute: 'other', isReady: true })
      uiCtrl.updateView('test-quote', { currentRoute: 'swap-and-bridge', isReady: true })

      jest.useFakeTimers()
      const { restore } = suppressConsole()

      uiCtrl.updateView('swap-and-bridge', {
        currentRoute: 'swap-and-bridge',
        isReady: true,
        searchParams: {}
      })

      const updateQuoteSpy = jest
        .spyOn(swapAndBridgeController, 'updateQuote')
        .mockImplementation((() => {}) as any)
      jest.spyOn(swapAndBridgeController, 'continuouslyUpdateQuote')
      const updateQuoteIntervalRestartSpy = jest.spyOn(
        swapAndBridgeController.updateQuoteInterval,
        'restart'
      )
      const updateQuoteIntervalStopSpy = jest.spyOn(
        swapAndBridgeController.updateQuoteInterval,
        'stop'
      )

      expect(swapAndBridgeController.formStatus).not.toBe(SwapAndBridgeFormStatus.ReadyToSubmit)

      swapAndBridgeController.updateQuoteInterval.restart()
      expect(updateQuoteIntervalRestartSpy).toHaveBeenCalledTimes(1)
      expect(updateQuoteIntervalStopSpy).toHaveBeenCalledTimes(0)
      await waitForFnToBeCalledAndExecuted(swapAndBridgeController.updateQuoteInterval)
      expect(updateQuoteSpy).toHaveBeenCalledTimes(0)
      expect(updateQuoteIntervalStopSpy).toHaveBeenCalledTimes(1)

      jest
        .spyOn(swapAndBridgeController, 'formStatus', 'get')
        .mockReturnValueOnce(SwapAndBridgeFormStatus.ReadyToSubmit)

      // Otherwise the interval won't run
      swapAndBridgeController.quote!.selectedRoute!.disabled = false

      swapAndBridgeController.updateQuoteInterval.restart()
      expect(updateQuoteIntervalRestartSpy).toHaveBeenCalledTimes(2)
      expect(updateQuoteIntervalStopSpy).toHaveBeenCalledTimes(1)
      await waitForFnToBeCalledAndExecuted(swapAndBridgeController.updateQuoteInterval)
      expect(updateQuoteSpy).toHaveBeenCalledTimes(1)
      expect(updateQuoteIntervalStopSpy).toHaveBeenCalledTimes(1)
      jest.clearAllTimers()
      jest.useRealTimers()
      restore()
    })
    it('should not continuously update the quote when not on the swap and bridge route', async () => {
      jest.useFakeTimers()
      const { restore } = suppressConsole()

      // Navigate to dashboard
      uiCtrl.updateView('swap-and-bridge', {
        currentRoute: 'dashboard',
        isReady: true,
        searchParams: {}
      })

      const updateQuoteSpy = jest
        .spyOn(swapAndBridgeController, 'updateQuote')
        .mockImplementation((() => {}) as any)
      jest.spyOn(swapAndBridgeController, 'continuouslyUpdateQuote')
      const updateQuoteIntervalRestartSpy = jest.spyOn(
        swapAndBridgeController.updateQuoteInterval,
        'restart'
      )
      const updateQuoteIntervalStopSpy = jest.spyOn(
        swapAndBridgeController.updateQuoteInterval,
        'stop'
      )

      // Set all the conditions that would normally allow updateQuote to run
      jest
        .spyOn(swapAndBridgeController, 'formStatus', 'get')
        .mockReturnValue(SwapAndBridgeFormStatus.ReadyToSubmit)
      swapAndBridgeController.quote!.selectedRoute!.disabled = false

      expect(swapAndBridgeController.updateQuoteInterval.running).toBe(false)

      swapAndBridgeController.updateQuoteInterval.restart()
      expect(updateQuoteIntervalRestartSpy).toHaveBeenCalledTimes(1)
      expect(updateQuoteIntervalStopSpy).toHaveBeenCalledTimes(0)
      await waitForFnToBeCalledAndExecuted(swapAndBridgeController.updateQuoteInterval)

      // updateQuote must not be called even though all other conditions are met,
      // because we are on dashboard and not on the swap-and-bridge route
      expect(updateQuoteSpy).toHaveBeenCalledTimes(0)
      expect(updateQuoteIntervalStopSpy).toHaveBeenCalledTimes(1)

      jest.clearAllTimers()
      jest.useRealTimers()
      restore()
    })
  }) // end describe('continuous quote updates')

  test('should add an activeRoute', async () => {
    const userTx = await socketAPIMock.startRoute({
      route: swapAndBridgeController.quote!.selectedRoute!
    })
    swapAndBridgeController.addActiveRoute({
      userTxIndex: userTx.userTxIndex
    })
    expect(swapAndBridgeController.activeRoutes).toHaveLength(1)
    expect(swapAndBridgeController.activeRoutes[0]!.routeStatus).toEqual('ready')
    expect(swapAndBridgeController.quote).toBeDefined()
    expect(swapAndBridgeController.banners).toHaveLength(0)
  })
  test('should make active route errors silent', () => {
    const previousQuote = swapAndBridgeController.quote
    swapAndBridgeController.quote = null

    try {
      swapAndBridgeController.addActiveRoute({ userTxIndex: 0 })
      throw new Error('Expected addActiveRoute to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(EmittableError)
      if (!(error instanceof EmittableError)) throw error
      expect(error.level).toBe('silent')
    } finally {
      swapAndBridgeController.quote = previousQuote
    }
  })
  test('should update an existing activeRoute when adding the same route again', async () => {
    const activeRouteId = swapAndBridgeController.activeRoutes[0]!.activeRouteId

    swapAndBridgeController.addActiveRoute({
      userTxIndex: swapAndBridgeController.activeRoutes[0]!.userTxIndex,
      routeStatus: 'in-progress'
    })
    swapAndBridgeController.updateActiveRoute(activeRouteId, {
      userTxHash: 'test'
    })

    expect(swapAndBridgeController.activeRoutes).toHaveLength(1)
    expect(swapAndBridgeController.activeRoutes[0]!.routeStatus).toEqual('in-progress')
    expect(swapAndBridgeController.activeRoutes[0]!.userTxHash).toEqual('test')
    expect(swapAndBridgeController.activeRoutesInProgress).toHaveLength(1)
  })
  test('should update an activeRoute userTxHash from submitted account op swapTxn meta', async () => {
    const activeRouteId = swapAndBridgeController.activeRoutes[0]!.activeRouteId
    const submittedAccountOp = getSubmittedAccountOp('test', activeRouteId)

    swapAndBridgeController.updateActiveRoute(activeRouteId, {
      routeStatus: 'in-progress',
      userTxHash: null,
      identifiedBy: null
    })
    swapAndBridgeController.handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(
      submittedAccountOp
    )

    expect(swapAndBridgeController.activeRoutes[0]!.userTxHash).toEqual('test')
    expect(swapAndBridgeController.activeRoutesInProgress).toHaveLength(1)
  })
  test('should fail an activeRoute from submitted account op swapTxn meta', async () => {
    const activeRouteId = swapAndBridgeController.activeRoutes[0]!.activeRouteId
    const submittedAccountOp = getSubmittedAccountOp('test', activeRouteId, 'failure')

    swapAndBridgeController.updateActiveRoute(activeRouteId, {
      routeStatus: 'in-progress',
      userTxHash: 'test'
    })
    swapAndBridgeController.handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(
      submittedAccountOp
    )

    expect(swapAndBridgeController.activeRoutes[0]!.routeStatus).toEqual('failed')
    expect(swapAndBridgeController.activeRoutes[0]!.error).toEqual('The transaction failed onchain')
    expect(swapAndBridgeController.activeRoutesInProgress).toHaveLength(0)
  })
  test('should update an activeRoute', async () => {
    const activeRouteId = swapAndBridgeController.activeRoutes[0]!.activeRouteId
    swapAndBridgeController.updateActiveRoute(activeRouteId, {
      routeStatus: 'in-progress',
      userTxHash: 'test'
    })
    swapAndBridgeController.updateActiveRoute(activeRouteId) // for the coverage
    expect(swapAndBridgeController.activeRoutes).toHaveLength(1)
    expect(swapAndBridgeController.activeRoutes[0]!.routeStatus).toEqual('in-progress')
    expect(swapAndBridgeController.banners).toHaveLength(1)
    expect(swapAndBridgeController.banners[0]!.actions).toHaveLength(1)
    expect(swapAndBridgeController.banners[0]!.meta?.accountAddr).toEqual(
      '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    )
  })
  describe('continuous active-route updates', () => {
    beforeEach(() => {
      // These tests need real interval behavior — undo the outer beforeEach mocks
      jest.restoreAllMocks()
    })

    it('should continuously update active routes', async () => {
      const { restore } = suppressConsole()
      jest.useFakeTimers()

      const checkForActiveRoutesStatusUpdateSpy = jest
        .spyOn(swapAndBridgeController, 'checkForActiveRoutesStatusUpdate')
        .mockImplementation((() => {}) as any)
      jest.spyOn(swapAndBridgeController, 'continuouslyUpdateActiveRoutes')
      const updateActiveRoutesIntervalStartSpy = jest.spyOn(
        swapAndBridgeController.updateActiveRoutesInterval,
        'start'
      )
      const updateActiveRoutesIntervalUpdateTimeoutSpy = jest.spyOn(
        swapAndBridgeController.updateActiveRoutesInterval,
        'updateTimeout'
      )
      const updateActiveRoutesIntervalStopSpy = jest.spyOn(
        swapAndBridgeController.updateActiveRoutesInterval,
        'stop'
      )

      expect(updateActiveRoutesIntervalStartSpy).toHaveBeenCalledTimes(0)
      expect(updateActiveRoutesIntervalStopSpy).toHaveBeenCalledTimes(0)
      expect(checkForActiveRoutesStatusUpdateSpy).toHaveBeenCalledTimes(0)
      expect(swapAndBridgeController.activeRoutes.length).toEqual(1)
      expect(swapAndBridgeController.activeRoutesInProgress.length).toEqual(1)
      swapAndBridgeController.activeRoutes = [...swapAndBridgeController.activeRoutes]
      expect(updateActiveRoutesIntervalStartSpy).toHaveBeenCalledTimes(1)
      expect(updateActiveRoutesIntervalStopSpy).toHaveBeenCalledTimes(0)
      expect(checkForActiveRoutesStatusUpdateSpy).toHaveBeenCalledTimes(0)
      await waitForFnToBeCalledAndExecuted(swapAndBridgeController.updateActiveRoutesInterval)
      expect(updateActiveRoutesIntervalStartSpy).toHaveBeenCalledTimes(1)
      expect(updateActiveRoutesIntervalStopSpy).toHaveBeenCalledTimes(0)
      expect(swapAndBridgeController.continuouslyUpdateActiveRoutes).toHaveBeenCalledTimes(1)
      expect(checkForActiveRoutesStatusUpdateSpy).toHaveBeenCalledTimes(1)
      expect(updateActiveRoutesIntervalUpdateTimeoutSpy).toHaveBeenCalledTimes(2)
      await waitForFnToBeCalledAndExecuted(swapAndBridgeController.updateActiveRoutesInterval)
      expect(updateActiveRoutesIntervalStartSpy).toHaveBeenCalledTimes(1)
      expect(swapAndBridgeController.continuouslyUpdateActiveRoutes).toHaveBeenCalledTimes(2)
      expect(checkForActiveRoutesStatusUpdateSpy).toHaveBeenCalledTimes(2)
      expect(updateActiveRoutesIntervalUpdateTimeoutSpy).toHaveBeenCalledTimes(3)
      jest.clearAllTimers()
      jest.useRealTimers()
      restore()
    })
  }) // end describe('continuous active-route updates')

  test('should check for route status', async () => {
    await swapAndBridgeController.checkForActiveRoutesStatusUpdate()
    swapAndBridgeController.updateActiveRoute(
      swapAndBridgeController.activeRoutes[0]!.activeRouteId,
      {
        routeStatus: 'in-progress',
        userTxHash: 'test',
        userTxIndex: 1
      }
    )

    const submittedAccountOp = getSubmittedAccountOp(
      swapAndBridgeController.activeRoutes[0]!.userTxHash!
    )

    await activityCtrl.addAccountOp(submittedAccountOp as any)

    await swapAndBridgeController.checkForActiveRoutesStatusUpdate()
    expect(swapAndBridgeController.activeRoutes[0]!.routeStatus).toEqual('completed')
  })
  test('should wait for a CoW Swap PreSign transaction before submitting the order', async () => {
    const activeRoute = swapAndBridgeController.activeRoutes[0]!
    const originalProviderId = activeRoute.route!.providerId
    const userTxHash = 'cowswap-presign-pending'
    const getRouteStatusSpy = jest.spyOn(socketAPIMock, 'getRouteStatus')

    activeRoute.route!.providerId = 'cowswap'
    swapAndBridgeController.updateActiveRoute(activeRoute.activeRouteId, {
      routeStatus: 'in-progress',
      userTxHash
    })
    await activityCtrl.addAccountOp(getSubmittedAccountOp(userTxHash))

    await swapAndBridgeController.checkForActiveRoutesStatusUpdate()

    expect(getRouteStatusSpy).not.toHaveBeenCalled()
    activeRoute.route!.providerId = originalProviderId
  })
  test('should check a CoW Swap order immediately after the PreSign transaction succeeds', () => {
    const originalActiveRoutes = swapAndBridgeController.activeRoutes
    const activeRoute = originalActiveRoutes[0]!
    const submittedAccountOp = getSubmittedAccountOp(
      'cowswap-presign-success',
      activeRoute.activeRouteId,
      'success'
    )
    submittedAccountOp.calls[0]!.id = activeRoute.activeRouteId

    swapAndBridgeController.activeRoutes = [
      {
        ...activeRoute,
        routeStatus: 'in-progress',
        userTxHash: submittedAccountOp.txnId,
        route: {
          ...activeRoute.route!,
          providerId: 'cowswap',
          userTxs: activeRoute.route!.userTxs.map((userTx) => ({
            ...userTx,
            serviceTime: 10
          }))
        }
      }
    ]
    const updateActiveRoutesIntervalRestartSpy = jest.spyOn(
      swapAndBridgeController.updateActiveRoutesInterval,
      'restart'
    )
    updateActiveRoutesIntervalRestartSpy.mockClear()

    swapAndBridgeController.handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(
      submittedAccountOp
    )

    expect(updateActiveRoutesIntervalRestartSpy).toHaveBeenCalledWith({
      timeout: 10000,
      runImmediately: true
    })

    swapAndBridgeController.activeRoutes = originalActiveRoutes
  })
  describe('intent activity recording', () => {
    let originalActiveRoutes: typeof swapAndBridgeController.activeRoutes

    const setActiveRouteForStatusCheck = (providerId: string) => {
      const baseActiveRoute = originalActiveRoutes[0]!
      const activeRoute = {
        ...baseActiveRoute,
        activeRouteId: `${providerId}-activity-route`,
        routeStatus: 'in-progress' as const,
        userTxHash: `${providerId}-source-transaction`,
        route: {
          ...baseActiveRoute.route!,
          routeId: `${providerId}-activity-route`,
          providerId,
          fromChainId: 1,
          toChainId: 1,
          isIntent: false
        }
      }

      swapAndBridgeController.activeRoutes = [activeRoute]
      jest
        .spyOn(activityCtrl, 'getAccountOpsForAccount')
        .mockReturnValue([getSubmittedAccountOp(activeRoute.userTxHash, undefined, 'success', 1n)])

      return activeRoute
    }

    beforeEach(() => {
      originalActiveRoutes = swapAndBridgeController.activeRoutes
    })

    afterEach(() => {
      swapAndBridgeController.activeRoutes = originalActiveRoutes
    })

    test('records a completed same-chain CoW Swap settlement in Activity', async () => {
      const activeRoute = setActiveRouteForStatusCheck('cowswap')
      const settlementTxnId = 'cowswap-settlement-transaction'
      jest
        .spyOn(socketAPIMock, 'getRouteStatus')
        .mockResolvedValue({ status: 'completed', txnId: settlementTxnId })
      const recordIntentActivitySpy = jest
        .spyOn(swapAndBridgeController, 'recordIntentActivity')
        .mockResolvedValue()

      await swapAndBridgeController.continuouslyUpdateActiveRoutes()

      expect(recordIntentActivitySpy).toHaveBeenCalledTimes(1)
      expect(recordIntentActivitySpy).toHaveBeenCalledWith(
        settlementTxnId,
        activeRoute,
        'completed'
      )
      expect(swapAndBridgeController.activeRoutes[0]!.routeStatus).toBe('completed')
    })

    test('does not create an external Activity record for a regular same-chain swap', async () => {
      setActiveRouteForStatusCheck('socket')
      jest.spyOn(socketAPIMock, 'getRouteStatus').mockResolvedValue({
        status: 'completed',
        txnId: 'regular-swap-transaction'
      })
      const recordIntentActivitySpy = jest
        .spyOn(swapAndBridgeController, 'recordIntentActivity')
        .mockResolvedValue()

      await swapAndBridgeController.continuouslyUpdateActiveRoutes()

      expect(recordIntentActivitySpy).not.toHaveBeenCalled()
    })

    test('does not create an Activity record without a settlement transaction ID', async () => {
      setActiveRouteForStatusCheck('cowswap')
      jest
        .spyOn(socketAPIMock, 'getRouteStatus')
        .mockResolvedValue({ status: 'completed', txnId: null })
      const recordIntentActivitySpy = jest
        .spyOn(swapAndBridgeController, 'recordIntentActivity')
        .mockResolvedValue()

      await swapAndBridgeController.continuouslyUpdateActiveRoutes()

      expect(recordIntentActivitySpy).not.toHaveBeenCalled()
    })

    test('does not create a completed Activity record for a failed CoW Swap order', async () => {
      setActiveRouteForStatusCheck('cowswap')
      jest
        .spyOn(socketAPIMock, 'getRouteStatus')
        .mockResolvedValue({ status: 'failed', txnId: null })
      const recordIntentActivitySpy = jest
        .spyOn(swapAndBridgeController, 'recordIntentActivity')
        .mockResolvedValue()

      await swapAndBridgeController.continuouslyUpdateActiveRoutes()

      expect(recordIntentActivitySpy).not.toHaveBeenCalled()
      expect(swapAndBridgeController.activeRoutes[0]!.routeStatus).toBe('failed')
    })
  })
  test('should remove an activeRoute', async () => {
    const activeRouteId = swapAndBridgeController.activeRoutes[0]!.activeRouteId
    swapAndBridgeController.removeActiveRoute(activeRouteId)
    expect(swapAndBridgeController.activeRoutes).toHaveLength(0)
    expect(swapAndBridgeController.banners).toHaveLength(0)
  })
  test('removeFailedRouteAndHideBanner removes the failed route and hides its activity banner', async () => {
    const { restore } = suppressConsole()
    const hideSpy = jest
      .spyOn(activityCtrl, 'setDashboardBannersSeen')
      .mockImplementationOnce(() => Promise.resolve())

    const SUBMITTED_ACCOUNT_OP = getSubmittedAccountOp(
      '0xbe0a59b6b409f9e61f96f2a18be67d8caf086e59785a24120f0df54693e8a197',
      'failed-route-id',
      'failure',
      1n
    )
    await activityCtrl.addAccountOp(SUBMITTED_ACCOUNT_OP)

    swapAndBridgeController.activeRoutes = [
      {
        activeRouteId: 'failed-route-id',
        routeStatus: 'failed',
        sender: accounts[0]!.addr,
        userTxHash: '0xbe0a59b6b409f9e61f96f2a18be67d8caf086e59785a24120f0df54693e8a197',
        identifiedBy: SUBMITTED_ACCOUNT_OP.identifiedBy,
        route: { fromChainId: 1, toChainId: 8453 }
      } as any
    ]

    await swapAndBridgeController.removeFailedRouteAndHideBanner('failed-route-id')

    // The stale activity failed banner/badge is hidden for the original op...
    expect(hideSpy).toHaveBeenCalledWith('dashboard', accounts[0]!.addr, {
      accountOpIds: [SUBMITTED_ACCOUNT_OP.id],
      emitUpdate: true,
      hideImmediately: true
    })
    // ...and the failed route is removed (which removes the "Failed bridge" banner)
    expect(swapAndBridgeController.activeRoutes).toHaveLength(0)
    expect(swapAndBridgeController.banners).toHaveLength(0)

    hideSpy.mockRestore()
    restore()
  })
  test('removeFailedRouteAndHideBanner is a no-op for an unknown route', async () => {
    const hideSpy = jest
      .spyOn(activityCtrl, 'setDashboardBannersSeen')
      .mockImplementationOnce(() => Promise.resolve())

    await swapAndBridgeController.removeFailedRouteAndHideBanner('does-not-exist')

    expect(hideSpy).not.toHaveBeenCalled()
    hideSpy.mockRestore()
  })
  test('should switch fromAmountFieldMode', () => {
    swapAndBridgeController.updateForm({ fromSelectedToken: PORTFOLIO_TOKENS[0] }) // select USDT for easier calcs
    swapAndBridgeController.updateForm({ fromAmountFieldMode: 'fiat' })
    expect(swapAndBridgeController.fromAmountFieldMode).toEqual('fiat')
    swapAndBridgeController.updateForm({ fromAmount: '0.99785' }) // USDT price in USD
    expect(swapAndBridgeController.fromAmount).toEqual('1.0')
    expect(swapAndBridgeController.validateFromAmount.severity).toEqual('success')
  })
  test('should clear the fiat amount when the amount is cleared to zero', () => {
    swapAndBridgeController.updateForm({ fromSelectedToken: PORTFOLIO_TOKENS[0] })
    swapAndBridgeController.updateForm({ fromAmountFieldMode: 'token' })

    swapAndBridgeController.updateForm({ fromAmount: '1' })
    expect(Number(swapAndBridgeController.fromAmountInFiat)).toBeGreaterThan(0)

    // The amount field turns a cleared input into a '0', so the fiat amount has to follow it
    swapAndBridgeController.updateForm({ fromAmount: '0' })
    expect(Number(swapAndBridgeController.fromAmountInFiat)).toBe(0)
  })
  test('should unload screen', () => {
    swapAndBridgeController.unloadScreen('1')
    expect(swapAndBridgeController.formStatus).toEqual('empty')
    expect(swapAndBridgeController.sessionIds.length).toEqual(0)
  })
  test('should toJSON()', () => {
    expect(swapAndBridgeController.toJSON()).toBeDefined()
  })
})

describe('SwapAndBridge Controller: to token market data', () => {
  // Longer than the batcher debounce, so that the fire-and-forget fetch has settled
  const waitForMarketData = () => wait(400)

  const MARKET_DATA_RESPONSE = {
    usd: 1.0001,
    usd_24h_change: -2.5,
    usd_market_cap: 1200000000,
    usd_24h_vol: 500000,
    exchanges: ['binance', 'uniswap']
  }

  let marketDataFetch: jest.Mock<any>
  let ctrl: SwapAndBridgeController

  const buildController = (fetchMock: any) =>
    new SwapAndBridgeController({
      callRelayer: async () => ({}),
      fetch: fetchMock,
      selectedAccount: selectedAccountCtrl,
      networks: networksCtrl,
      accounts: accountsCtrl,
      activity: activityCtrl,
      storage: storageCtrl,
      signAccountOpPreference,
      featureFlags: featureFlagsCtrl,
      platform: 'browser-webkit',
      swapProvider: socketAPIMock as any,
      erc7730: erc7730Ctrl,
      contractInfo: contractInfoCtrl,
      keystore,
      portfolio: portfolioCtrl,
      providers: providersCtrl,
      phishing: phishingCtrl,
      dapps: dappsControllerMock,
      externalSignerControllers: {},
      relayerUrl,
      getUserRequests: () => [],
      getVisibleUserRequests: () => [],
      onBroadcastSuccess: () => Promise.resolve(),
      onBroadcastFailed: () => {},
      ui: uiCtrl
    })

  const initFormAndTokenList = async () => {
    await ctrl.initForm('market-data-session')
    await ctrl.updatePortfolioTokenList(PORTFOLIO_TOKENS)
    await waitForMarketData()
  }

  beforeEach(async () => {
    marketDataFetch = jest.fn(async () => ({
      status: 200,
      json: async () => ({
        // Our price API keys the response by lowercased contract address
        '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58': MARKET_DATA_RESPONSE
      })
    })) as any

    ctrl = buildController(marketDataFetch)
    await selectedAccountCtrl.initialLoadPromise
    await selectedAccountCtrl.select({ account: accounts[0]! })
  })

  afterEach(() => {
    ctrl.unloadScreen('market-data-session')
    jest.restoreAllMocks()
  })

  test('exposes the market data of a token our price API knows about', async () => {
    await initFormAndTokenList()

    const usdt = ctrl.toTokenShortList.find((t) => t.symbol === 'USDT')
    expect(usdt).toBeDefined()

    const marketData = ctrl.toTokenMarketData[getTokenMarketDataKey(usdt!.chainId, usdt!.address)]

    expect(marketData).toEqual({
      status: 'DONE',
      exchanges: ['binance', 'uniswap']
    })
  })

  test('marks the tokens missing from the response as not found', async () => {
    await initFormAndTokenList()

    const notInResponse = ctrl.toTokenShortList.find((t) => t.symbol !== 'USDT')
    expect(notInResponse).toBeDefined()

    expect(
      ctrl.toTokenMarketData[getTokenMarketDataKey(notInResponse!.chainId, notInResponse!.address)]
    ).toEqual({ status: 'NOT_FOUND' })
  })

  test('does not request the market data of a token that already has fresh data', async () => {
    await initFormAndTokenList()
    const callsAfterFirstFetch = marketDataFetch.mock.calls.length
    expect(callsAfterFirstFetch).toBeGreaterThan(0)

    await ctrl.searchToToken('USDT')
    await waitForMarketData()

    expect(marketDataFetch.mock.calls.length).toEqual(callsAfterFirstFetch)
  })

  test('hides the market data that went stale and requests it again', async () => {
    await initFormAndTokenList()
    const callsAfterFirstFetch = marketDataFetch.mock.calls.length

    const usdt = ctrl.toTokenShortList.find((t) => t.symbol === 'USDT')!
    const usdtKey = getTokenMarketDataKey(usdt.chainId, usdt.address)

    // 11 minutes later, past the 10 minute threshold of a successfully fetched record
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000 * 60 * 11)

    expect(ctrl.toTokenMarketData[usdtKey]).toEqual({ status: 'LOADING' })

    await ctrl.searchToToken('USDT')
    nowSpy.mockRestore()
    await waitForMarketData()

    expect(marketDataFetch.mock.calls.length).toBeGreaterThan(callsAfterFirstFetch)
    expect(ctrl.toTokenMarketData[usdtKey]?.status).toEqual('DONE')
  })

  test('marks the tokens as failed when the request fails, without throwing', async () => {
    const { restore } = suppressConsole()
    ctrl = buildController(jest.fn(async () => ({ status: 500, json: async () => ({}) })) as any)

    await initFormAndTokenList()

    const usdt = ctrl.toTokenShortList.find((t) => t.symbol === 'USDT')!

    expect(ctrl.toTokenMarketData[getTokenMarketDataKey(usdt.chainId, usdt.address)]).toEqual({
      status: 'FAIL'
    })
    restore()
  })

  test('reports the tokens it has not fetched yet as loading', async () => {
    await ctrl.initForm('market-data-session')
    await ctrl.updatePortfolioTokenList(PORTFOLIO_TOKENS)

    const statuses = Object.values(ctrl.toTokenMarketData).map(({ status }) => status)

    expect(statuses.length).toBeGreaterThan(0)
    expect(statuses.every((status) => status === 'LOADING')).toBe(true)

    await waitForMarketData()
  })

  describe('when the user has opted out', () => {
    beforeEach(async () => {
      await featureFlagsCtrl.setFeatureFlag('swapAndBridgeTokenInfo', false)
    })

    afterEach(async () => {
      await featureFlagsCtrl.setFeatureFlag('swapAndBridgeTokenInfo', true)
    })

    test('sends no token addresses to the price API', async () => {
      await initFormAndTokenList()

      expect(marketDataFetch).not.toHaveBeenCalled()
    })

    test('keeps the data fetched before the opt out out of the UI state', async () => {
      await featureFlagsCtrl.setFeatureFlag('swapAndBridgeTokenInfo', true)
      await initFormAndTokenList()
      expect(Object.keys(ctrl.toTokenMarketData).length).toBeGreaterThan(0)

      await featureFlagsCtrl.setFeatureFlag('swapAndBridgeTokenInfo', false)

      expect(ctrl.toTokenMarketData).toEqual({})
    })
  })
})
