/* eslint-disable @typescript-eslint/no-use-before-define */
import fetch from 'node-fetch'

import { relayerUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { suppressConsole } from '../../../test/helpers/console'
import { mockUiManager } from '../../../test/helpers/ui'
import { waitForFnToBeCalledAndExecuted } from '../../../test/recurringTimeout'
import { networks } from '../../consts/networks'
import { RPCProviders } from '../../interfaces/provider'
import { getProviderId } from '../../libs/defiPositions/helpers'
import * as defiProviders from '../../libs/defiPositions/providers'
import { DeFiPositionsError } from '../../libs/defiPositions/types'
import { getRpcProvider } from '../../services/provider'
import wait from '../../utils/wait'
import { AccountsController } from '../accounts/accounts'
import { AutoLoginController } from '../autoLogin/autoLogin'
import { FeatureFlagsController } from '../featureFlags/featureFlags'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { StorageController } from '../storage/storage'
import { UiController } from '../ui/ui'
import { DefiPositionsController } from './defiPositions'

global.fetch = fetch as any

// If the account ever has to be replaced:
// 1. Go to https://debank.com/protocols
// 2. Find an Account that has both Aave v3 and Uniswap v3 positions on mainnet
// 3. Replace the address below with that account's address
// 4. Update the static MOCK_DEBANK_RESPONSE_DATA below with a fresh call to cena
const ACCOUNT = {
  addr: '0x741aa7cfb2c7bf2a1e7d4da2e3df6a56ca4131f3',
  initialPrivileges: [],
  associatedKeys: ['0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175'],
  creation: {
    factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
    salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
  },
  preferences: {
    label: 'Test account',
    pfp: '0x96c122e9c968e8246288c724838b1924410807fb'
  }
}

const providers: RPCProviders = {}

networks.forEach((network) => {
  providers[network.chainId.toString()] = getRpcProvider(network.rpcUrls, network.chainId)
  providers[network.chainId.toString()]!.isWorking = true
})

const prepareTest = async () => {
  const storage = produceMemoryStore()
  await storage.set('accounts', [ACCOUNT])
  const storageCtrl = new StorageController(storage)
  let providersCtrl: ProvidersController

  const { uiManager } = mockUiManager()
  const uiCtrl = new UiController({ uiManager })
  const keystoreCtrl = new KeystoreController('default', storageCtrl, {}, uiCtrl)

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
  providersCtrl.providers = providers

  const accountsCtrl = new AccountsController(
    storageCtrl,
    providersCtrl,
    networksCtrl,
    keystoreCtrl,
    () => {},
    () => {},
    () => {},
    relayerUrl,
    fetch
  )
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
  await selectedAccountCtrl.initialLoadPromise
  await networksCtrl.initialLoadPromise
  await providersCtrl.initialLoadPromise

  await selectedAccountCtrl.setAccount(ACCOUNT)
  const featureFlagsCtrl = new FeatureFlagsController({}, storageCtrl)
  const controller = new DefiPositionsController({
    fetch: global.fetch as any,
    storage: storageCtrl,
    selectedAccount: selectedAccountCtrl,
    keystore: keystoreCtrl,
    providers: providersCtrl,
    networks: networksCtrl,
    accounts: accountsCtrl,
    ui: uiCtrl,
    features: featureFlagsCtrl
  })

  // @ts-ignore
  // Done so we don't call the actual Debank API during tests
  jest.spyOn(DefiPositionsController.prototype, 'callDebank').mockImplementation(async () => {
    await wait(500)
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    return MOCK_DEBANK_RESPONSE_DATA
  })

  return {
    controller,
    storage,
    ui: uiCtrl
  }
}

describe('DefiPositionsController', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.clearAllMocks()
  })
  it('should update positions correctly', async () => {
    const { controller } = await prepareTest()

    await controller.updatePositions()
    const selectedAccountState = controller.getDefiPositionsState(ACCOUNT.addr)
    expect(selectedAccountState['1']!.updatedAt).toBeDefined()
    expect(selectedAccountState['1']!.positionsByProvider.length).toBeGreaterThan(0)
  })

  it('should handle errors in update positions', async () => {
    const consoleSuppressor = suppressConsole()
    jest.spyOn(defiProviders, 'getAAVEPositions').mockImplementation(
      () =>
        new Promise((_, reject) => {
          reject(new Error('AAVE error'))
        })
    )
    jest.spyOn(defiProviders, 'getDebankEnhancedUniV3Positions').mockImplementation(
      () =>
        new Promise((_, reject) => {
          reject(new Error('Uniswap error'))
        })
    )
    const { controller } = await prepareTest()
    await controller.updatePositions()

    const selectedAccountState = controller.getDefiPositionsState(ACCOUNT.addr)
    expect(selectedAccountState['1']!.providerErrors).toEqual([
      { providerName: 'AAVE v3', error: 'AAVE error' },
      { providerName: 'Uniswap V3', error: 'Uniswap error' }
    ])

    consoleSuppressor.restore()
  })

  it('should set asset prices correctly', async () => {
    const { controller } = await prepareTest()
    await controller.updatePositions()

    const selectedAccountState = controller.getDefiPositionsState(ACCOUNT.addr)

    const positions = selectedAccountState['1']!.positionsByProvider
    expect(positions.length).toBeGreaterThan(0)
    positions.forEach((provider) => {
      provider.positions.forEach((position) => {
        position.assets.forEach((asset) => {
          expect(asset.value).toBeDefined()
          expect(asset.priceIn).toEqual({ baseCurrency: 'usd', price: expect.any(Number) })
        })
      })
    })
  })

  it('should update networksWithPositionsByAccounts properly', async () => {
    const { controller } = await prepareTest()

    await controller.updatePositions()
    const networksWithPositions = controller.getNetworksWithPositions(ACCOUNT.addr)

    expect(networksWithPositions['1']).toContain('AAVE v3')
  })
  it('should handle provider error and empty state for networksWithPositionsByAccounts', async () => {
    const consoleSuppressor = suppressConsole()

    jest.spyOn(defiProviders, 'getAAVEPositions').mockImplementation(
      () =>
        new Promise((_, reject) => {
          reject(new Error('AAVE error'))
        })
    )
    const { controller } = await prepareTest()

    await controller.updatePositions()
    const accountState = controller.getDefiPositionsState(ACCOUNT.addr)

    expect(accountState['1']!.providerErrors!.length).toBeGreaterThan(0)

    const networksWithPositions = controller.getNetworksWithPositions(ACCOUNT.addr)

    // Undefined because there is a provider has an error, so we
    // can't be certain if the account has positions on that network
    expect(networksWithPositions['137']).toBeUndefined()
    expect(networksWithPositions['1']).toBeUndefined()

    consoleSuppressor.restore()
  })

  it('should add a critical error if the call to debank fails, despite custom positions being fetched properly', async () => {
    const { restore } = suppressConsole()
    const { controller } = await prepareTest()

    jest
      // @ts-ignore
      .spyOn(DefiPositionsController.prototype, 'getDebankPositionsForAccount')
      // @ts-ignore
      .mockRejectedValueOnce(new Error('Debank fetch failed'))

    await controller.updatePositions({ forceDebankCall: true })
    const selectedAccountState = controller.getDefiPositionsState(ACCOUNT.addr)

    expect(Object.keys(selectedAccountState).length).toBeGreaterThan(0)

    Object.values(selectedAccountState).forEach((networkState) => {
      expect(networkState.error).toBeDefined()
      expect(networkState.error).toBe(DeFiPositionsError.CriticalError)
    })

    restore()
  })

  it('uniswap v3 positions are read from debank and enhanced with custom positions', async () => {
    const { controller } = await prepareTest()

    await controller.updatePositions({
      forceDebankCall: true
    })

    const selectedAccountState = controller.getDefiPositionsState(ACCOUNT.addr)

    const uniswapV3Positions = selectedAccountState['1']!.positionsByProvider.find(
      (p) => p.providerName === 'Uniswap V3'
    )

    expect(uniswapV3Positions).toBeDefined()
    expect(uniswapV3Positions!.positions.length).toBeGreaterThan(0)

    uniswapV3Positions!.positions.forEach((position) => {
      expect(position.additionalData.positionIndex).toBeDefined()
    })

    // It's not guaranteed that all positions will have inRange defined, but only in the tests
    // That is because the call to debank returns static data that is defined below. If the position
    // no longer exists, deployless will not return it and there is no way for it to be inRange
    // It's enough for us to check that one is being enhanced with the custom data
    expect(
      uniswapV3Positions?.positions.some((p) => typeof p.additionalData.inRange === 'boolean')
    ).toBe(true)
  })

  it('getUniqueMergedPositions: duplicates are removed and custom are preffered', async () => {
    const uniV3 = MOCK_DEBANK_RESPONSE_DATA.find(
      (p) => p.providerName === 'Uniswap V3' && p.chainId === 1
    )!

    const customUni = {
      ...uniV3,
      source: 'custom' as const
    }

    const merged = DefiPositionsController.getUniqueMergedPositions(
      MOCK_DEBANK_RESPONSE_DATA.filter(({ chainId }) => chainId === 1) as any[],
      [customUni] as any[]
    )

    expect(merged.length).toBe(
      MOCK_DEBANK_RESPONSE_DATA.filter(({ chainId }) => chainId === 1).length
    )
    const mergedUni = merged.find((p) => p.providerName === 'Uniswap V3')!
    expect(mergedUni.source).toBe('custom')
  })

  it('aave v3 is coming from custom positions', async () => {
    const { controller } = await prepareTest()

    await controller.updatePositions({
      forceDebankCall: true
    })

    const selectedAccountState = controller.getDefiPositionsState(ACCOUNT.addr)
    const aaveV3Positions = selectedAccountState['1']!.positionsByProvider.find(
      (p) => getProviderId(p.providerName) === 'aave v3'
    )

    expect(aaveV3Positions).toBeDefined()
    expect(aaveV3Positions!.positions.length).toBeGreaterThan(0)
    expect(aaveV3Positions!.source).toBe('custom')
    aaveV3Positions!.positions.forEach((position) => {
      expect(position.additionalData.healthRate).toBeDefined()
    })
  })

  it('debank critical error is prioritized over price errors', async () => {
    const { restore } = suppressConsole()

    jest
      // @ts-ignore
      .spyOn(DefiPositionsController.prototype, 'updatePositionsByProviderAssetPrices')
      // @ts-ignore
      .mockRejectedValue(new Error('Price fetch failed'))

    const { controller } = await prepareTest()

    await controller.updatePositions({ forceDebankCall: true })

    const selectedAccountState = controller.getDefiPositionsState(ACCOUNT.addr)

    expect(Object.keys(selectedAccountState).length).toBeGreaterThan(0)

    Object.values(selectedAccountState).forEach((networkState) => {
      // There won't be an error if there are no positions on that network
      if (!networkState.positionsByProvider.length) return
      if (!networkState.error) return

      expect(networkState.error).toBeDefined()
      expect(networkState.error).toBe(DeFiPositionsError.AssetPriceError)
    })

    jest
      // @ts-ignore
      .spyOn(DefiPositionsController.prototype, 'callDebank')
      // @ts-ignore
      .mockRejectedValueOnce(new Error('Debank fetch failed'))

    await controller.updatePositions({ forceDebankCall: true, maxDataAgeMs: 0, forceUpdate: true })

    const selectedAccountState2 = controller.getDefiPositionsState(ACCOUNT.addr)

    expect(Object.keys(selectedAccountState2).length).toBeGreaterThan(0)

    Object.values(selectedAccountState2).forEach((networkState) => {
      expect(networkState.error).toBeDefined()
      expect(networkState.error).toBe(DeFiPositionsError.CriticalError)
    })
    restore()
  })

  it('custom positions are persisted after a failure', async () => {
    const { restore } = suppressConsole()
    const spy = jest.spyOn(defiProviders, 'getAAVEPositions')

    const { controller } = await prepareTest()

    // First, do a successful update to have positions stored
    await controller.updatePositions({ forceDebankCall: true })

    const selectedAccountState = controller.getDefiPositionsState(ACCOUNT.addr)
    expect(Object.keys(selectedAccountState).length).toBeGreaterThan(0)

    let aaveV3PositionsCount = 0

    Object.values(selectedAccountState).forEach((networkState) => {
      if (!networkState.positionsByProvider.length) return

      if (
        networkState.positionsByProvider.some((p) => getProviderId(p.providerName) === 'aave v3')
      ) {
        aaveV3PositionsCount++
      }
    })

    // Mock getAAVEPositions to throw
    spy.mockImplementation(
      () =>
        new Promise((_, reject) => {
          reject(new Error('AAVE error'))
        })
    )

    // Now, do an update that will fail on AAVE
    await controller.updatePositions({ forceDebankCall: true, maxDataAgeMs: 0, forceUpdate: true })

    const selectedAccountState2 = controller.getDefiPositionsState(ACCOUNT.addr)

    expect(Object.keys(selectedAccountState2).length).toBeGreaterThan(0)

    let aaveV3PositionsCount2 = 0

    Object.values(selectedAccountState2).forEach((networkState) => {
      if (!networkState.positionsByProvider.length) return

      if (
        networkState.positionsByProvider.some((p) => getProviderId(p.providerName) === 'aave v3')
      ) {
        expect(networkState.providerErrors).toBeDefined()
        expect(networkState.providerErrors?.length).toBeGreaterThan(0)
        aaveV3PositionsCount2++
      }
    })

    expect(aaveV3PositionsCount2).toBe(aaveV3PositionsCount)
    restore()
  })

  it('debank positions are persisted after a debank call failure', async () => {
    const { restore } = suppressConsole()

    const { controller } = await prepareTest()

    await controller.updatePositions({ forceDebankCall: true })

    const selectedAccountState = controller.getDefiPositionsState(ACCOUNT.addr)
    expect(Object.keys(selectedAccountState).length).toBeGreaterThan(0)
    let debankPositionsCount = 0

    Object.values(selectedAccountState).forEach((networkState) => {
      if (!networkState.positionsByProvider.length) return

      if (networkState.positionsByProvider.some((p) => p.source === 'debank')) {
        debankPositionsCount++
      }
    })

    jest
      // @ts-ignore
      .spyOn(DefiPositionsController.prototype, 'callDebank')
      // @ts-ignore
      .mockRejectedValueOnce(new Error('Debank fetch failed'))

    await controller.updatePositions({ forceDebankCall: true, maxDataAgeMs: 0, forceUpdate: true })

    let debankPositionsCount2 = 0

    const selectedAccountState2 = controller.getDefiPositionsState(ACCOUNT.addr)
    expect(Object.keys(selectedAccountState2).length).toBeGreaterThan(0)

    Object.values(selectedAccountState2).forEach((networkState) => {
      if (!networkState.positionsByProvider.length) return

      if (networkState.positionsByProvider.some((p) => p.source === 'debank')) {
        expect(networkState.error).toBeDefined()
        expect(networkState.error).toBe(DeFiPositionsError.CriticalError)
        debankPositionsCount2++
      }
    })

    expect(debankPositionsCount2).toBe(debankPositionsCount)
    restore()
  })

  it('should continuously update the defi positions', async () => {
    jest.useFakeTimers()
    const { restore } = suppressConsole()

    const { controller, ui } = await prepareTest()
    controller.updatePositions = jest.fn().mockResolvedValue(undefined)
    jest.spyOn(controller.positionsContinuousUpdateInterval, 'start')
    jest.spyOn(controller.positionsContinuousUpdateInterval, 'stop')
    jest.spyOn(controller, 'positionsContinuousUpdate')

    expect(controller.positionsContinuousUpdateInterval.start).toHaveBeenCalledTimes(0)
    expect(controller.positionsContinuousUpdateInterval.stop).toHaveBeenCalledTimes(0)
    expect(controller.positionsContinuousUpdate).toHaveBeenCalledTimes(0)
    const FIVE_MINUTES = 1000 * 60 * 5
    await jest.advanceTimersByTimeAsync(FIVE_MINUTES)
    expect(controller.positionsContinuousUpdateInterval.start).toHaveBeenCalledTimes(0)
    expect(controller.positionsContinuousUpdateInterval.stop).toHaveBeenCalledTimes(0)
    expect(controller.positionsContinuousUpdate).toHaveBeenCalledTimes(0)
    ui.addView({ id: '1', type: 'popup', currentRoute: 'dashboard', isReady: true })
    await jest.advanceTimersByTimeAsync(0)
    expect(controller.positionsContinuousUpdateInterval.start).toHaveBeenCalledTimes(1)
    expect(controller.positionsContinuousUpdateInterval.stop).toHaveBeenCalledTimes(0)
    expect(controller.positionsContinuousUpdate).toHaveBeenCalledTimes(0)
    await waitForFnToBeCalledAndExecuted(controller.positionsContinuousUpdateInterval)
    expect(controller.positionsContinuousUpdateInterval.start).toHaveBeenCalledTimes(1)
    expect(controller.positionsContinuousUpdateInterval.stop).toHaveBeenCalledTimes(0)
    expect(controller.positionsContinuousUpdate).toHaveBeenCalledTimes(1)
    await waitForFnToBeCalledAndExecuted(controller.positionsContinuousUpdateInterval)
    expect(controller.positionsContinuousUpdateInterval.start).toHaveBeenCalledTimes(1)
    expect(controller.positionsContinuousUpdateInterval.stop).toHaveBeenCalledTimes(0)
    expect(controller.positionsContinuousUpdate).toHaveBeenCalledTimes(2)
    ui.removeView('1')
    await jest.advanceTimersByTimeAsync(0)
    expect(controller.positionsContinuousUpdateInterval.start).toHaveBeenCalledTimes(1)
    expect(controller.positionsContinuousUpdateInterval.stop).toHaveBeenCalledTimes(1)
    expect(controller.positionsContinuousUpdate).toHaveBeenCalledTimes(2)
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.clearAllMocks()
    restore()
  })
})

const MOCK_DEBANK_RESPONSE_DATA = [
  {
    providerName: 'Aave V3',
    chainId: 1,
    iconUrl:
      'https://static.debank.com/image/project/logo_url/aave3/54df7839ab09493ba7540ab832590255.png',
    siteUrl: 'https://app.aave.com',
    type: 'lending',
    positions: [
      {
        id: '8a895b85-6ed3-4119-8eb0-b2a07e42c365',
        assets: [
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '105037591935843001434112',
            priceIn: { price: 3079.27, baseCurrency: 'usd' },
            value: 323439105.72028327,
            type: 1,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png',
            protocolAsset: { address: '0xfa1fdbbd71b0aa16162d76914d69cd8cb3ef92da' }
          },
          {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            amount: '81899459404899',
            priceIn: { price: 1.001001001001001, baseCurrency: 'usd' },
            value: 81981440.84574476,
            type: 2,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/fffcd27b9efff5a86ab942084c05924d.png',
            protocolAsset: { address: '0xed90de2d824ee766c6fd22e90b12e598f681dc9f' }
          },
          {
            address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
            symbol: 'USDT',
            name: 'Tether USD',
            decimals: 6,
            amount: '7421421566626',
            priceIn: { price: 0.99906, baseCurrency: 'usd' },
            value: 7414445.430353371,
            type: 2,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xdac17f958d2ee523a2206206994597c13d831ec7/1a1d8a5b89114dc183f42b3d33eb3522.png',
            protocolAsset: { address: '0x6df1c1e379bc5a00a7b4c6e67a203333772f45a8' }
          }
        ],
        additionalData: {
          healthRate: 3.0085418970206783,
          positionInUSD: 234043219.44418514,
          deptInUSD: -89395886.27609813,
          collateralInUSD: 323439105.72028327,
          name: 'Lending',
          detailTypes: ['lending'],
          updateAt: 1767969627,
          pool: {
            id: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
            chain: 'eth',
            project_id: 'aave3',
            adapter_id: 'aave3_proxy_lending',
            controller: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2',
            index: null,
            time_at: 1672325495
          }
        }
      },
      {
        id: 'f5d0e0af-08f8-4bd0-8e00-471ba000425d',
        assets: [
          {
            address: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
            symbol: 'stETH',
            name: 'Liquid staked Ether 2.0',
            decimals: 18,
            amount: '845280251327172313088',
            priceIn: { price: 3086.749339788847, baseCurrency: 'usd' },
            value: 2609168.2577207,
            type: 1,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xae7ab96520de3a18e5e111b5eaab095312d7fe84/e4f2c8b4d0b254fe8e04880ff76d872e.png'
          },
          {
            address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
            symbol: 'AAVE',
            name: 'Aave Token',
            decimals: 18,
            amount: '63011016835601799315456',
            priceIn: { price: 165.8, baseCurrency: 'usd' },
            value: 10447226.591342779,
            type: 1,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9/7baf403c819f679dc1c6571d9d978f21.png',
            protocolAsset: { address: '0xa700b4eb416be35b2911fd5dee80678ff64ff6c9' }
          },
          {
            address: '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
            symbol: 'AAVE',
            name: 'Aave Token',
            decimals: 18,
            amount: '13771599803661195264',
            priceIn: { price: 165.8, baseCurrency: 'usd' },
            value: 2283.3312474470263,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9/7baf403c819f679dc1c6571d9d978f21.png',
            protocolAsset: { address: '0xa700b4eb416be35b2911fd5dee80678ff64ff6c9' }
          }
        ],
        additionalData: {
          positionInUSD: 13058678.180310925,
          collateralInUSD: 13058678.180310925,
          name: 'Staked',
          detailTypes: ['common'],
          updateAt: 1767969627,
          pool: {
            id: '0x9eda81c21c273a82be9bbc19b6a6182212068101',
            chain: 'eth',
            project_id: 'aave3',
            adapter_id: 'aave2_staked',
            controller: '0x9eda81c21c273a82be9bbc19b6a6182212068101',
            index: null,
            time_at: 1705585583
          }
        }
      }
    ],
    positionInUSD: 247101897.62449607
  },
  {
    providerName: 'Superfluid',
    chainId: 10,
    iconUrl:
      'https://static.debank.com/image/project/logo_url/xdai_superfluid/25f0091457e85c07056f7da3ba037983.png',
    siteUrl: 'https://app.superfluid.org',
    type: 'common',
    positions: [
      {
        id: '765ad083-5f2b-41f5-aacf-b43bf8ebad6a',
        assets: [
          {
            address: '0x7f5c764cbc14f9669b88837ca1490cca17c31607',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            amount: '51953',
            priceIn: { price: 1.001001001001001, baseCurrency: 'usd' },
            value: 0.05200582526893199,
            type: 1,
            iconUrl:
              'https://static.debank.com/image/avax_token/logo_url/0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664/c1503ade9d53497fe93ca9f2723c56a1.png'
          }
        ],
        additionalData: {
          positionInUSD: 0.05200582526893199,
          collateralInUSD: 0.05200582526893199,
          name: 'Deposit',
          detailTypes: ['common'],
          updateAt: 1767969627,
          pool: {
            id: '0x8430f084b939208e2eded1584889c9a66b90562f',
            chain: 'op',
            project_id: 'op_superfluid',
            adapter_id: 'superfluid_deposit',
            controller: '0x8430f084b939208e2eded1584889c9a66b90562f',
            index: null,
            time_at: 1647450880
          }
        }
      }
    ],
    positionInUSD: 0.05200582526893199
  },
  {
    providerName: 'Uniswap V3',
    chainId: 1,
    iconUrl:
      'https://static.debank.com/image/project/logo_url/uniswap3/87a541b3b83b041c8d12119e5a0d19f0.png',
    siteUrl: 'https://app.uniswap.org',
    type: 'common',
    positions: [
      {
        id: 'a3f30606-08b3-47c5-9a05-810ea31808ae',
        assets: [
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '2504264515820467519488',
            priceIn: { price: 3079.27, baseCurrency: 'usd' },
            value: 7711306.59563049,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
            symbol: 'USDT',
            name: 'Tether USD',
            decimals: 6,
            amount: '834219324340',
            priceIn: { price: 0.99906, baseCurrency: 'usd' },
            value: 833435.1581754835,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xdac17f958d2ee523a2206206994597c13d831ec7/1a1d8a5b89114dc183f42b3d33eb3522.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '794137548930588160',
            priceIn: { price: 3079.27, baseCurrency: 'usd' },
            value: 2445.363930295492,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
            symbol: 'USDT',
            name: 'Tether USD',
            decimals: 6,
            amount: '2291294817',
            priceIn: { price: 0.99906, baseCurrency: 'usd' },
            value: 2289.14099987202,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xdac17f958d2ee523a2206206994597c13d831ec7/1a1d8a5b89114dc183f42b3d33eb3522.png'
          }
        ],
        additionalData: {
          positionInUSD: 8549476.258736141,
          collateralInUSD: 8549476.258736141,
          positionIndex: '180077',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1767969627,
          position_index: '180077',
          pool: {
            id: '0x11b815efb8f581194ae79006d24e0d814b7697f6',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x11b815efb8f581194ae79006d24e0d814b7697f6',
            index: null,
            time_at: 1620251172
          }
        }
      },
      {
        id: '7b9c4aad-a25b-430e-be27-f11dc5fc9304',
        assets: [
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '3562012906293755904000',
            priceIn: { price: 3079.27, baseCurrency: 'usd' },
            value: 10968399.481963173,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
            symbol: 'USDT',
            name: 'Tether USD',
            decimals: 6,
            amount: '1188604711045',
            priceIn: { price: 0.99906, baseCurrency: 'usd' },
            value: 1187487.4226168958,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xdac17f958d2ee523a2206206994597c13d831ec7/1a1d8a5b89114dc183f42b3d33eb3522.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '1544519487568523008',
            priceIn: { price: 3079.27, baseCurrency: 'usd' },
            value: 4755.992522485126,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
            symbol: 'USDT',
            name: 'Tether USD',
            decimals: 6,
            amount: '3307712811',
            priceIn: { price: 0.99906, baseCurrency: 'usd' },
            value: 3304.6035609576597,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xdac17f958d2ee523a2206206994597c13d831ec7/1a1d8a5b89114dc183f42b3d33eb3522.png'
          }
        ],
        additionalData: {
          positionInUSD: 12163947.500663511,
          collateralInUSD: 12163947.500663511,
          positionIndex: '180068',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1767969627,
          position_index: '180068',
          pool: {
            id: '0x4e68ccd3e89f51c3074ca5072bbac773960dfa36',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x4e68ccd3e89f51c3074ca5072bbac773960dfa36',
            index: null,
            time_at: 1620232628
          }
        }
      },
      {
        id: '6d5339aa-cb85-4d63-b786-18e2540ba29a',
        assets: [
          {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            amount: '364929607611',
            priceIn: { price: 1.001001001001001, baseCurrency: 'usd' },
            value: 365294.9025138646,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/fffcd27b9efff5a86ab942084c05924d.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '926798731819757207552',
            priceIn: { price: 3079.27, baseCurrency: 'usd' },
            value: 2853863.530930624,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            amount: '793414866',
            priceIn: { price: 1.001001001001001, baseCurrency: 'usd' },
            value: 794.2090750750751,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/fffcd27b9efff5a86ab942084c05924d.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '276944060702344288',
            priceIn: { price: 3079.27, baseCurrency: 'usd' },
            value: 852.7855377989077,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          }
        ],
        additionalData: {
          positionInUSD: 3220805.4280573623,
          collateralInUSD: 3220805.4280573623,
          positionIndex: '180049',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1767969627,
          position_index: '180049',
          pool: {
            id: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640',
            index: null,
            time_at: 1620250931
          }
        }
      },
      {
        id: '3ee48922-3c29-4690-a614-b3eb415f8181',
        assets: [
          {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            amount: '1348654729965',
            priceIn: { price: 1.001001001001001, baseCurrency: 'usd' },
            value: 1350004.7347004395,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/fffcd27b9efff5a86ab942084c05924d.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '3275860358386362613760',
            priceIn: { price: 3079.27, baseCurrency: 'usd' },
            value: 10087258.525768375,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            amount: '2992480566',
            priceIn: { price: 1.001001001001001, baseCurrency: 'usd' },
            value: 2995.4760420420425,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48/fffcd27b9efff5a86ab942084c05924d.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '1407656197662766080',
            priceIn: { price: 3079.27, baseCurrency: 'usd' },
            value: 4334.5534997770255,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          }
        ],
        additionalData: {
          positionInUSD: 11444593.290010633,
          collateralInUSD: 11444593.290010633,
          positionIndex: '179646',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1767969627,
          position_index: '179646',
          pool: {
            id: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8',
            index: null,
            time_at: 1620169800
          }
        }
      }
    ],
    positionInUSD: 35378822.47746765
  }
]
