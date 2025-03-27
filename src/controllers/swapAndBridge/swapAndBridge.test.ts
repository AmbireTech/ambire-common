import EventEmitter from 'events'
import fetch from 'node-fetch'

import { expect } from '@jest/globals'

import { relayerUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks } from '../../consts/networks'
import { Storage } from '../../interfaces/storage'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { ActionsController } from '../actions/actions'
import { ActivityController } from '../activity/activity'
import { InviteController } from '../invite/invite'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { StorageController } from '../storage/storage'
import { SocketAPIMock } from './socketApiMock'
import { SwapAndBridgeController } from './swapAndBridge'

let swapAndBridgeController: SwapAndBridgeController
const event = new EventEmitter()
let windowId = 0
const windowManager = {
  event,
  focus: () => Promise.resolve(),
  open: () => {
    windowId++
    return Promise.resolve({
      id: windowId,
      top: 0,
      left: 0,
      width: 100,
      height: 100,
      focused: true
    })
  },
  remove: () => {
    event.emit('windowRemoved', windowId)
    return Promise.resolve()
  },
  sendWindowToastMessage: () => {},
  sendWindowUiMessage: () => {}
}

const notificationManager = {
  create: () => Promise.resolve()
}

const providers = Object.fromEntries(
  networks.map((network) => [network.chainId, getRpcProvider(network.rpcUrls, network.chainId)])
)

const storage: Storage = produceMemoryStore()
const storageCtrl = new StorageController(storage)
let providersCtrl: ProvidersController
const networksCtrl = new NetworksController(
  storageCtrl,
  fetch,
  relayerUrl,
  (net) => {
    providersCtrl.setProvider(net)
  },
  (id) => {
    providersCtrl.removeProvider(id)
  }
)

providersCtrl = new ProvidersController(networksCtrl)
providersCtrl.providers = providers
const accountsCtrl = new AccountsController(
  storageCtrl,
  providersCtrl,
  networksCtrl,
  () => {},
  () => {},
  () => {}
)
const selectedAccountCtrl = new SelectedAccountController({
  storage: storageCtrl,
  accounts: accountsCtrl
})

const actionsCtrl = new ActionsController({
  selectedAccount: selectedAccountCtrl,
  windowManager,
  notificationManager,
  onActionWindowClose: () => {}
})

const inviteCtrl = new InviteController({
  relayerUrl: '',
  fetch,
  storage: storageCtrl
})

const callRelayer = relayerCall.bind({ url: '', fetch })

const activityCtrl = new ActivityController(
  storageCtrl,
  fetch,
  callRelayer,
  accountsCtrl,
  selectedAccountCtrl,
  providersCtrl,
  networksCtrl,
  () => Promise.resolve()
)

const socketAPIMock = new SocketAPIMock({ fetch, apiKey: '' })

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

const PORTFOLIO_TOKENS = [
  {
    address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    amount: 2110000n,
    decimals: 6,
    flags: { onGasTank: false, rewardsType: null, isFeeToken: true, canTopUpGasTank: true },
    chainId: 10n,
    priceIn: [{ baseCurrency: 'usd', price: 0.99785 }],
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
    symbol: 'ETH',
    name: 'Ether'
  }
]

describe('SwapAndBridge Controller', () => {
  test('should initialize', async () => {
    await storage.set('accounts', accounts)
    await selectedAccountCtrl.initialLoadPromise
    await selectedAccountCtrl.setAccount(accounts[0])
    swapAndBridgeController = new SwapAndBridgeController({
      selectedAccount: selectedAccountCtrl,
      networks: networksCtrl,
      activity: activityCtrl,
      storage: storageCtrl,
      socketAPI: socketAPIMock as any,
      actions: actionsCtrl,
      invite: inviteCtrl
    })

    expect(swapAndBridgeController).toBeDefined()
  })
  test('should initForm', async () => {
    await swapAndBridgeController.initForm('1')
    expect(swapAndBridgeController.sessionIds).toContain('1')
  })
  test('should update portfolio token list', (done) => {
    let emitCounter = 0
    const unsubscribe = swapAndBridgeController.onUpdate(async () => {
      emitCounter++
      if (emitCounter === 4) {
        expect(swapAndBridgeController.toTokenList).toHaveLength(3)
        expect(swapAndBridgeController.toTokenList).not.toContainEqual(
          expect.objectContaining({
            address: swapAndBridgeController.fromSelectedToken?.address
          })
        )
        expect(swapAndBridgeController.toSelectedToken).toBeNull()
        unsubscribe()
        done()
      }
    })

    expect(swapAndBridgeController.fromChainId).toEqual(1)
    expect(swapAndBridgeController.fromSelectedToken).toEqual(null)
    swapAndBridgeController.updatePortfolioTokenList(PORTFOLIO_TOKENS)
    expect(swapAndBridgeController.fromSelectedToken).not.toBeNull()
    expect(swapAndBridgeController.fromSelectedToken?.address).toEqual(
      '0x0000000000000000000000000000000000000000' // the one with highest balance
    )
    expect(swapAndBridgeController.fromChainId).toEqual(10)
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
    swapAndBridgeController.updateForm({ toSelectedToken: swapAndBridgeController.toTokenList[0] })
  })
  test('should update fromAmount', (done) => {
    let emitCounter = 0
    const unsubscribe = swapAndBridgeController.onUpdate(async () => {
      emitCounter++
      if (emitCounter === 4) {
        expect(swapAndBridgeController.formStatus).toEqual('ready-to-submit')
        expect(swapAndBridgeController.quote).not.toBeNull()
        unsubscribe()
        done()
      }
      if (emitCounter === 2) {
        expect(swapAndBridgeController.formStatus).toEqual('fetching-routes')
      }
    })
    swapAndBridgeController.updateForm({ fromAmount: '0.8' })
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
    expect(swapAndBridgeController.fromAmount).toEqual('')
    expect(swapAndBridgeController.formStatus).toEqual('empty')
    await swapAndBridgeController.switchFromAndToTokens()
    expect(swapAndBridgeController.fromChainId).toEqual(prevFromChainId)
    expect(swapAndBridgeController.toChainId).toEqual(prevToChainId)
    expect(swapAndBridgeController.toSelectedToken?.address).toEqual(prevToSelectedTokenAddress)
    expect(swapAndBridgeController.fromSelectedToken?.address).toEqual(prevFromSelectedTokenAddress)
  })
  test('should update fromAmount to make the form valid again', (done) => {
    let emitCounter = 0
    const unsubscribe = swapAndBridgeController.onUpdate(async () => {
      emitCounter++
      if (emitCounter === 4) {
        expect(swapAndBridgeController.formStatus).toEqual('ready-to-submit')
        expect(swapAndBridgeController.quote).not.toBeNull()
        unsubscribe()
        done()
      }
    })
    swapAndBridgeController.updateForm({ fromAmount: '0.02' })
  })
  test('should add an activeRoute', async () => {
    const userTx = await socketAPIMock.startRoute({
      fromChainId: swapAndBridgeController.fromChainId!,
      toChainId: swapAndBridgeController.toChainId!,
      fromAssetAddress: swapAndBridgeController.fromSelectedToken!.address,
      toAssetAddress: swapAndBridgeController.toSelectedToken!.address,
      route: swapAndBridgeController.quote!.selectedRoute
    })
    await swapAndBridgeController.addActiveRoute({
      activeRouteId: userTx.activeRouteId,
      userTxIndex: userTx.userTxIndex
    })
    expect(swapAndBridgeController.activeRoutes).toHaveLength(1)
    expect(swapAndBridgeController.activeRoutes[0].routeStatus).toEqual('ready')
    expect(swapAndBridgeController.formStatus).toEqual('empty')
    expect(swapAndBridgeController.quote).toBeNull()
    expect(swapAndBridgeController.banners).toHaveLength(1)
  })
  test('should update an activeRoute', async () => {
    const activeRouteId = swapAndBridgeController.activeRoutes[0].activeRouteId
    swapAndBridgeController.updateActiveRoute(activeRouteId, {
      routeStatus: 'in-progress',
      userTxHash: 'test'
    })
    swapAndBridgeController.updateActiveRoute(activeRouteId) // for the coverage
    expect(swapAndBridgeController.activeRoutes).toHaveLength(1)
    expect(swapAndBridgeController.activeRoutes[0].routeStatus).toEqual('in-progress')
    expect(swapAndBridgeController.banners).toHaveLength(1)
    expect(swapAndBridgeController.banners[0].actions).toHaveLength(1)
  })
  test('should check for route status', async () => {
    await swapAndBridgeController.checkForNextUserTxForActiveRoutes()
    expect(swapAndBridgeController.activeRoutes[0].routeStatus).toEqual('ready')
    swapAndBridgeController.updateActiveRoute(
      swapAndBridgeController.activeRoutes[0].activeRouteId,
      {
        routeStatus: 'in-progress',
        userTxHash: 'test',
        userTxIndex: 1
      }
    )
    await swapAndBridgeController.checkForNextUserTxForActiveRoutes()
    expect(swapAndBridgeController.activeRoutes[0].routeStatus).toEqual('completed')
  })
  test('should remove an activeRoute', async () => {
    const activeRouteId = swapAndBridgeController.activeRoutes[0].activeRouteId
    swapAndBridgeController.removeActiveRoute(activeRouteId)
    expect(swapAndBridgeController.activeRoutes).toHaveLength(0)
    expect(swapAndBridgeController.banners).toHaveLength(0)
  })
  test('should switch fromAmountFieldMode', () => {
    swapAndBridgeController.updateForm({ fromSelectedToken: PORTFOLIO_TOKENS[0] }) // select USDT for easier calcs
    swapAndBridgeController.updateForm({ fromAmountFieldMode: 'fiat' })
    expect(swapAndBridgeController.fromAmountFieldMode).toEqual('fiat')
    swapAndBridgeController.updateForm({ fromAmount: '0.99785' }) // USDT price in USD
    expect(swapAndBridgeController.fromAmount).toEqual('1.0')
    expect(swapAndBridgeController.validateFromAmount.success).toEqual(true)
  })
  test('should unload screen', () => {
    swapAndBridgeController.unloadScreen('1')
    expect(swapAndBridgeController.formStatus).toEqual('empty')
    expect(swapAndBridgeController.sessionIds.length).toEqual(0)
  })
  test('should toJSON()', () => {
    const json = swapAndBridgeController.toJSON()
    expect(json).toBeDefined()
  })
})
