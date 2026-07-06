import fetch from 'node-fetch'

import { expect, jest } from '@jest/globals'

import { relayerUrl, velcroUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { suppressConsole } from '../../../test/helpers/console'
import { mockUiManager } from '../../../test/helpers/ui'
import { waitForFnToBeCalledAndExecuted } from '../../../test/recurringTimeout'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { IProvidersController } from '../../interfaces/provider'
import { IRequestsController } from '../../interfaces/requests'
import { Storage } from '../../interfaces/storage'
import { HumanizerMeta } from '../../libs/humanizer/interfaces'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import wait from '../../utils/wait'
import { AccountsController } from '../accounts/accounts'
import { ActivityController } from '../activity/activity'
import { AddressBookController } from '../addressBook/addressBook'
import { AutoLoginController } from '../autoLogin/autoLogin'
import { BannerController } from '../banner/banner'
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
import { SwapAndBridgeController, SwapAndBridgeFormStatus } from './swapAndBridge'

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
  activeRouteId = 'test-active-route-id',
  status = 'broadcasted-but-not-confirmed',
  chainId = 10n
) =>
  ({
    id: `submitted-account-op-${txnId}`,
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
    chainId,
    nonce: 225n,
    signature: '0x0000000000000000000000005be214147ea1ae3653f289e17fe7dc17a73ad17503',
    calls: [
      {
        id: 'safe-request-call-id',
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
    meta: {
      swapTxn: {
        activeRouteId,
        approvalData: null,
        chainId: Number(chainId),
        txData: '0x',
        txTarget: '0x0000000000000000000000000000000000000000',
        userTxIndex: 0,
        value: '0'
      }
    }
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
  banner: bannerCtrl
})

const addressBookCtrl = new AddressBookController(storageCtrl, accountsCtrl, selectedAccountCtrl)

const callRelayer = relayerCall.bind({ url: '', fetch })

const featureFlagsCtrl = new FeatureFlagsController({}, storageCtrl)
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
  featureFlagsCtrl
)

const safe = new SafeController({
  networks: networksCtrl,
  providers: providersCtrl,
  storage: storageCtrl,
  accounts: accountsCtrl
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
  () => Promise.resolve()
)

const phishingCtrl = new PhishingController({
  fetch,
  storage: storageCtrl,
  addressBook: addressBookCtrl,
  ui: uiCtrl
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

const swapAndBridgeController = new SwapAndBridgeController({
  callRelayer: async () => ({}),
  selectedAccount: selectedAccountCtrl,
  networks: networksCtrl,
  accounts: accountsCtrl,
  activity: activityCtrl,
  storage: storageCtrl,
  signAccountOpPreference,
  swapProvider: socketAPIMock as any,
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

const transferCtrl = new TransferController(
  async () => ({}),
  storageCtrl,
  signAccountOpPreference,
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
  uiCtrl
)

requestsCtrl = new RequestsController({
  relayerUrl,
  callRelayer,
  portfolio: portfolioCtrl,
  externalSignerControllers: {},
  activity: activityCtrl,
  phishing: phishingCtrl,
  dapps: dappsControllerMock,
  accounts: accountsCtrl,
  networks: networksCtrl,
  providers: providersCtrl,
  storage: storageCtrl,
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
    await selectedAccountCtrl.setAccount(accounts[0]!)

    expect(swapAndBridgeController).toBeDefined()
    // TODO: move these in beforeEach with an exception for the continuous updates tests where mocks are not needed
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
    let emitCounter = 0
    const unsubscribe = swapAndBridgeController.onUpdate(async () => {
      emitCounter++
      if (emitCounter === 4) {
        expect(swapAndBridgeController.formStatus).toEqual('ready-to-estimate')
        expect(swapAndBridgeController.quote).not.toBeNull()
        expect(swapAndBridgeController.fromAmount).toBe('0.8')
        unsubscribe()
        done()
      }
      if (emitCounter === 2) {
        expect(swapAndBridgeController.formStatus).toEqual('fetching-routes')
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
  test('should switch from and to tokens', async () => {
    const prevFromChainId = swapAndBridgeController.fromChainId
    const prevToChainId = swapAndBridgeController.toChainId
    const prevFromSelectedTokenAddress = swapAndBridgeController.fromSelectedToken?.address
    const prevToSelectedTokenAddress = swapAndBridgeController.toSelectedToken?.address
    const fiatBefore = swapAndBridgeController.fromAmountInFiat
    await swapAndBridgeController.switchFromAndToTokens()
    expect(swapAndBridgeController.fromChainId).toEqual(prevToChainId)
    expect(swapAndBridgeController.toChainId).toEqual(prevFromChainId)
    expect(swapAndBridgeController.toSelectedToken?.address).toEqual(prevFromSelectedTokenAddress)
    expect(swapAndBridgeController.fromSelectedToken?.address).toEqual(prevToSelectedTokenAddress)
    expect(swapAndBridgeController.fromAmountInFiat).toEqual(fiatBefore)
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
    await activityCtrl.addAccountOp(SUBMITTED_ACCOUNT_OP as any)

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
  test('should unload screen', () => {
    swapAndBridgeController.unloadScreen('1')
    expect(swapAndBridgeController.formStatus).toEqual('empty')
    expect(swapAndBridgeController.sessionIds.length).toEqual(0)
  })
  test('should toJSON()', () => {
    expect(swapAndBridgeController.toJSON()).toBeDefined()
  })
})
