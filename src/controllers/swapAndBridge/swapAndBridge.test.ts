import fetch from 'node-fetch'

import { expect } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { networks } from '../../consts/networks'
import { Storage } from '../../interfaces/storage'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { SocketAPIMock } from './socketApiMock'
import { SwapAndBridgeController } from './swapAndBridge'

let swapAndBridgeController: SwapAndBridgeController

const providers = Object.fromEntries(
  networks.map((network) => [network.id, getRpcProvider(network.rpcUrls, network.chainId)])
)

const storage: Storage = produceMemoryStore()
let providersCtrl: ProvidersController
const networksCtrl = new NetworksController(
  produceMemoryStore(),
  fetch,
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
  storage,
  providersCtrl,
  networksCtrl,
  () => {},
  () => {}
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

describe('SwapAndBridge Controller', () => {
  test('should initialize', async () => {
    await storage.set('accounts', accounts)
    accountsCtrl.selectedAccount = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
    swapAndBridgeController = new SwapAndBridgeController({
      accounts: accountsCtrl,
      networks: networksCtrl,
      storage,
      socketAPI: socketAPIMock as any
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
      if (emitCounter === 7) {
        expect(swapAndBridgeController.toTokenList).toHaveLength(2)
        expect(swapAndBridgeController.toSelectedToken).not.toBeNull()
        unsubscribe()
        done()
      }
    })

    expect(swapAndBridgeController.fromChainId).toEqual(1)
    expect(swapAndBridgeController.fromSelectedToken).toEqual(null)
    swapAndBridgeController.updatePortfolioTokenList([
      {
        address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
        amount: 2110000n,
        decimals: 6,
        flags: { onGasTank: false, rewardsType: null, isFeeToken: true, canTopUpGasTank: true },
        networkId: 'optimism',
        priceIn: [{ baseCurrency: 'usd', price: 0.99785 }],
        symbol: 'USDT'
      }
    ])
    expect(swapAndBridgeController.fromSelectedToken).not.toBeNull()
    expect(swapAndBridgeController.fromSelectedToken?.address).toEqual(
      '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58'
    )
    expect(swapAndBridgeController.fromChainId).toEqual(10)
  })
  test('should update fromAmount', (done) => {
    let emitCounter = 0
    const unsubscribe = swapAndBridgeController.onUpdate(async () => {
      emitCounter++
      if (emitCounter === 5) {
        expect(swapAndBridgeController.formStatus).toEqual('ready-to-submit')
        expect(swapAndBridgeController.quote).not.toBeNull()
        unsubscribe()
        done()
      }
      if (emitCounter === 1) {
        expect(swapAndBridgeController.formStatus).toEqual('fetching-routes')
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
      route: swapAndBridgeController.quote!.route
    })
    await swapAndBridgeController.addActiveRoute({
      activeRouteId: userTx.activeRouteId,
      userTxIndex: userTx.userTxIndex
    })
    expect(swapAndBridgeController.activeRoutes).toHaveLength(1)
    expect(swapAndBridgeController.formStatus).toEqual('empty')
    expect(swapAndBridgeController.quote).toBeNull()
    expect(swapAndBridgeController.banners).toHaveLength(1)
  })
  test('should update an activeRoute', async () => {
    const activeRouteId = swapAndBridgeController.activeRoutes[0].activeRouteId
    await swapAndBridgeController.updateActiveRoute(activeRouteId, {
      routeStatus: 'in-progress'
    })
    expect(swapAndBridgeController.activeRoutes).toHaveLength(1)
    expect(swapAndBridgeController.activeRoutes[0].routeStatus).toEqual('in-progress')
    expect(swapAndBridgeController.banners).toHaveLength(1)
    expect(swapAndBridgeController.banners[0].actions).toHaveLength(1)
  })
  test('should remove an activeRoute', async () => {
    const activeRouteId = swapAndBridgeController.activeRoutes[0].activeRouteId
    swapAndBridgeController.removeActiveRoute(activeRouteId)
    expect(swapAndBridgeController.activeRoutes).toHaveLength(0)
    expect(swapAndBridgeController.banners).toHaveLength(0)
  })
})
