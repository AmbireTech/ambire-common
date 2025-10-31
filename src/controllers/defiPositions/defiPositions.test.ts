/* eslint-disable @typescript-eslint/no-use-before-define */
import fetch from 'node-fetch'

import { relayerUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { suppressConsole } from '../../../test/helpers/console'
import { mockUiManager } from '../../../test/helpers/ui'
import { waitForFnToBeCalledAndExecuted } from '../../../test/recurringTimeout'
import { networks } from '../../consts/networks'
import { RPCProviders } from '../../interfaces/provider'
import * as defiProviders from '../../libs/defiPositions/providers'
import { DeFiPositionsError } from '../../libs/defiPositions/types'
import { getRpcProvider } from '../../services/provider'
import wait from '../../utils/wait'
import { AccountsController } from '../accounts/accounts'
import { AutoLoginController } from '../autoLogin/autoLogin'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { StorageController } from '../storage/storage'
import { UiController } from '../ui/ui'
import { DefiPositionsController } from './defiPositions'

global.fetch = fetch as any

const ACCOUNT = {
  addr: '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337',
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
    pfp: '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337'
  }
}

const providers: RPCProviders = {}

networks.forEach((network) => {
  providers[network.chainId.toString()] = getRpcProvider(network.rpcUrls, network.chainId)
  providers[network.chainId.toString()].isWorking = true
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
  providersCtrl = new ProvidersController(networksCtrl)
  providersCtrl.providers = providers

  const accountsCtrl = new AccountsController(
    storageCtrl,
    providersCtrl,
    networksCtrl,
    keystoreCtrl,
    () => {},
    () => {},
    () => {}
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
  const controller = new DefiPositionsController({
    fetch: global.fetch as any,
    storage: storageCtrl,
    selectedAccount: selectedAccountCtrl,
    keystore: keystoreCtrl,
    providers: providersCtrl,
    networks: networksCtrl,
    accounts: accountsCtrl,
    ui: uiCtrl
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
    expect(selectedAccountState['137'].updatedAt).toBeDefined()
    expect(selectedAccountState['137'].positionsByProvider.length).toBeGreaterThan(0)
  })

  it('should handle errors in update positions', async () => {
    const consoleSuppressor = suppressConsole()
    jest.spyOn(defiProviders, 'getAAVEPositions').mockImplementation(
      () =>
        new Promise((_, reject) => {
          reject(new Error('AAVE error'))
        })
    )
    jest.spyOn(defiProviders, 'getUniV3Positions').mockImplementation(
      () =>
        new Promise((_, reject) => {
          reject(new Error('Uniswap error'))
        })
    )
    const { controller } = await prepareTest()
    await controller.updatePositions()

    const selectedAccountState = controller.getDefiPositionsState(ACCOUNT.addr)
    expect(selectedAccountState['1'].providerErrors).toEqual([
      { providerName: 'AAVE v3', error: 'AAVE error' },
      { providerName: 'Uniswap V3', error: 'Uniswap error' }
    ])

    consoleSuppressor.restore()
  })

  it('should set asset prices correctly', async () => {
    const { controller } = await prepareTest()
    await controller.updatePositions()

    const selectedAccountState = controller.getDefiPositionsState(ACCOUNT.addr)

    const positions = selectedAccountState['137'].positionsByProvider
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

    expect(networksWithPositions['137']).toContain('AAVE v3')
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

    expect(accountState['1'].providerErrors!.length).toBeGreaterThan(0)
    expect(accountState['137'].providerErrors!.length).toBeGreaterThan(0)

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

    const uniswapV3Positions = selectedAccountState['1'].positionsByProvider.find(
      (p) => p.providerName === 'Uniswap V3'
    )

    expect(uniswapV3Positions).toBeDefined()
    expect(uniswapV3Positions!.positions.length).toEqual(1)
    uniswapV3Positions!.positions.forEach((position) => {
      expect(position.additionalData.positionIndex).toBeDefined()
      expect(position.additionalData.inRange).toBeDefined()
    })
  })

  it('getUniqueMergedPositions: duplicates are removed and custom are preffered', async () => {
    const uniV3 = MOCK_DEBANK_RESPONSE_DATA.find((p) => p.providerName === 'Uniswap V3')!

    const network = networks.find((n) => n.chainId === BigInt(uniV3.chainId))!

    const customUni = {
      ...uniV3,
      source: 'custom' as const
    }

    const merged = DefiPositionsController.getUniqueMergedPositions(
      network,
      MOCK_DEBANK_RESPONSE_DATA as any[],
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
    const aaveV3Positions = selectedAccountState['10'].positionsByProvider.find(
      (p) => DefiPositionsController.getProviderId(p.providerName) === 'aave v3'
    )

    expect(aaveV3Positions).toBeDefined()
    expect(aaveV3Positions!.positions.length).toEqual(1)
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
        networkState.positionsByProvider.some(
          (p) => DefiPositionsController.getProviderId(p.providerName) === 'aave v3'
        )
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
        networkState.positionsByProvider.some(
          (p) => DefiPositionsController.getProviderId(p.providerName) === 'aave v3'
        )
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
    jest.spyOn(global.console, 'error').mockImplementation(() => {})

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
    ;(console.error as jest.Mock).mockRestore()
  })
})

const MOCK_DEBANK_RESPONSE_DATA = [
  {
    providerName: 'LIDO',
    chainId: 1,
    iconUrl:
      'https://static.debank.com/image/project/logo_url/lido/081388ebc44fa042561749bd5338d49e.png',
    siteUrl: 'https://stake.lido.fi',
    type: 'common',
    positions: [
      {
        id: 'f7bf33cb-b134-4bca-97fb-82403101faf3',
        assets: [
          {
            address: 'eth',
            symbol: 'ETH',
            name: 'ETH',
            decimals: 18,
            amount: '728892183657245952',
            priceIn: {
              price: 3893.5,
              baseCurrency: 'usd'
            },
            value: 2837.94171706949,
            type: 1,
            iconUrl:
              'https://static.debank.com/image/coin/logo_url/eth/6443cdccced33e204d90cb723c632917.png'
          }
        ],
        additionalData: {
          positionInUSD: 2837.94171706949,
          collateralInUSD: 2837.94171706949,
          name: 'Staked',
          detailTypes: ['common'],
          updateAt: 1761804296,
          pool: {
            id: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
            chain: 'eth',
            project_id: 'lido',
            adapter_id: 'lido_staked',
            controller: '0xae7ab96520de3a18e5e111b5eaab095312d7fe84',
            index: null,
            time_at: 1608242396
          }
        }
      }
    ],
    positionInUSD: 2837.94171706949
  },
  {
    providerName: 'Aave V3',
    chainId: 10,
    iconUrl:
      'https://static.debank.com/image/project/logo_url/aave3/54df7839ab09493ba7540ab832590255.png',
    siteUrl: 'https://app.aave.com',
    type: 'lending',
    positions: [
      {
        id: 'ae4c7c2f-7d30-44ad-be91-c2a812b7ff1d',
        assets: [
          {
            address: '0x68f180fcce6836688e9084f035309e29bf0a2095',
            symbol: 'WBTC',
            name: 'Wrapped BTC',
            decimals: 8,
            amount: '21258',
            priceIn: {
              price: 109986.47,
              baseCurrency: 'usd'
            },
            value: 23.3809237926,
            type: 1,
            iconUrl:
              'https://static.debank.com/image/op_token/logo_url/0x68f180fcce6836688e9084f035309e29bf0a2095/d3c52e7c7449afa8bd4fad1c93f50d93.png',
            protocolAsset: {
              address: '0x078f358208685046a11c85e8ad32895ded33a249'
            }
          },
          {
            address: '0x4200000000000000000000000000000000000006',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '1893035353',
            priceIn: {
              price: 3893.71,
              baseCurrency: 'usd'
            },
            value: 0.000007370930688223,
            type: 1,
            iconUrl:
              'https://static.debank.com/image/op_token/logo_url/0x4200000000000000000000000000000000000006/61844453e63cf81301f845d7864236f6.png',
            protocolAsset: {
              address: '0xe50fa9b3c56ffb159cb0fca61f5c9d750e8128c8'
            }
          },
          {
            address: '0x4200000000000000000000000000000000000042',
            symbol: 'OP',
            name: 'Optimism',
            decimals: 18,
            amount: '147983993409089863680',
            priceIn: {
              price: 0.4267,
              baseCurrency: 'usd'
            },
            value: 63.1447699876587,
            type: 1,
            iconUrl:
              'https://static.debank.com/image/op_token/logo_url/0x4200000000000000000000000000000000000042/029a56df18f88f4123120fdcb6bea40b.png',
            protocolAsset: {
              address: '0x513c7e3a9c69ca3e22550ef58ac1c0088e918fff'
            }
          }
        ],
        additionalData: {
          healthRate: 1.157920892373162e59,
          positionInUSD: 86.5257011511893,
          collateralInUSD: 86.5257011511893,
          name: 'Lending',
          detailTypes: ['lending'],
          updateAt: 1761771802,
          pool: {
            id: '0x794a61358d6845594f94dc1db02a252b5b4814ad',
            chain: 'op',
            project_id: 'op_aave3',
            adapter_id: 'aave3_proxy_lending',
            controller: '0x794a61358d6845594f94dc1db02a252b5b4814ad',
            index: null,
            time_at: 1647006479
          }
        }
      }
    ],
    positionInUSD: 86.5257011511893
  },
  {
    providerName: 'Curve',
    chainId: 10,
    iconUrl:
      'https://static.debank.com/image/project/logo_url/op_curve/42e8c4eb3a83479f172dd56c67eb7e88.png',
    siteUrl: 'https://www.curve.finance',
    type: 'common',
    positions: [
      {
        id: 'e1fe3d5b-d142-4015-9147-3e0494f74e19',
        assets: [
          {
            address: '0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9',
            symbol: 'sUSD',
            name: 'Synth sUSD',
            decimals: 18,
            amount: '259733753028248128',
            priceIn: {
              price: 0.9997,
              baseCurrency: 'usd'
            },
            value: 0.25965583290234,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/op_token/logo_url/0x8c6f28f2f1a3c87f0f938b96d27520d9751ec8d9/c699f829018dea55b6b49da32bc9a90d.png'
          },
          {
            address: '0xda10009cbd5d07dd0cecc66161fc93d7c9000da1',
            symbol: 'DAI',
            name: 'Dai Stablecoin',
            decimals: 18,
            amount: '21818986095686912',
            priceIn: {
              price: 0.9999,
              baseCurrency: 'usd'
            },
            value: 0.0218168041970773,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/op_token/logo_url/0xda10009cbd5d07dd0cecc66161fc93d7c9000da1/549c4205dbb199f1b8b03af783f35e71.png'
          },
          {
            address: '0x7f5c764cbc14f9669b88837ca1490cca17c31607',
            symbol: 'USDC',
            name: 'USD Coin',
            decimals: 6,
            amount: '13834',
            priceIn: {
              price: 0.9998,
              baseCurrency: 'usd'
            },
            value: 0.0138315353723521,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/avax_token/logo_url/0xa7d7079b0fead91f3e65f86e8915cb59c1a4c664/c1503ade9d53497fe93ca9f2723c56a1.png'
          },
          {
            address: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58',
            symbol: 'USDT',
            name: 'Tether USD',
            decimals: 6,
            amount: '10458',
            priceIn: {
              price: 1.00008,
              baseCurrency: 'usd'
            },
            value: 0.0104598184308759,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xdac17f958d2ee523a2206206994597c13d831ec7/464c0de678334b8fe87327e527bc476d.png'
          }
        ],
        additionalData: {
          positionInUSD: 0.305763990902645,
          collateralInUSD: 0.305763990902645,
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1761742358,
          pool: {
            id: '0x061b87122ed14b9526a813209c8a59a633257bab',
            chain: 'op',
            project_id: 'op_curve',
            adapter_id: 'curve_liquidity',
            controller: '0x061b87122ed14b9526a813209c8a59a633257bab',
            index: null,
            time_at: 1644708825
          }
        }
      }
    ],
    positionInUSD: 0.305763990902645
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
        id: 'a9539958-03e0-43c9-b78b-7270c68ca0d9',
        assets: [
          {
            address: '0x88800092ff476844f74dc2fc427974bbee2794ae',
            symbol: 'WALLET',
            name: 'Ambire Wallet',
            decimals: 18,
            amount: '43243041899205214863360',
            priceIn: {
              price: 0.0220880944993347,
              baseCurrency: 'usd'
            },
            value: 955.156395908336,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x88800092ff476844f74dc2fc427974bbee2794ae/6d920bb617173a2c6d5e4d8d91febeeb.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '74587507562656928',
            priceIn: {
              price: 3893.5,
              baseCurrency: 'usd'
            },
            value: 290.406460695205,
            type: 0,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          },
          {
            address: '0x88800092ff476844f74dc2fc427974bbee2794ae',
            symbol: 'WALLET',
            name: 'Ambire Wallet',
            decimals: 18,
            amount: '1528669825915597619200',
            priceIn: {
              price: 0.0220880944993347,
              baseCurrency: 'usd'
            },
            value: 33.7654035731053,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0x88800092ff476844f74dc2fc427974bbee2794ae/6d920bb617173a2c6d5e4d8d91febeeb.png'
          },
          {
            address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
            symbol: 'WETH',
            name: 'Wrapped Ether',
            decimals: 18,
            amount: '8185867942579183',
            priceIn: {
              price: 3893.5,
              baseCurrency: 'usd'
            },
            value: 31.871676834432,
            type: 3,
            iconUrl:
              'https://static.debank.com/image/eth_token/logo_url/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2/61844453e63cf81301f845d7864236f6.png'
          }
        ],
        additionalData: {
          positionInUSD: 1311.19993701108,
          collateralInUSD: 1311.19993701108,
          positionIndex: '1054309',
          name: 'Liquidity Pool',
          detailTypes: ['common'],
          updateAt: 1761804299,
          position_index: '1054309',
          pool: {
            id: '0x53bbdf4ea397d17a6f904dc882b3fb78a6875a66',
            chain: 'eth',
            project_id: 'uniswap3',
            adapter_id: 'uniswap3_liquidity',
            controller: '0x53bbdf4ea397d17a6f904dc882b3fb78a6875a66',
            index: null,
            time_at: 1673842307
          }
        }
      }
    ],
    positionInUSD: 1311.19993701108
  }
]
