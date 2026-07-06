import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import { relayerUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { makeMainController } from '../../../test/helpers/mainController'
import { networks as predefinedNetworks } from '../../consts/networks'
import { INetworksController, Network } from '../../interfaces/network'
import wait from '../../utils/wait'
import { StorageController } from '../storage/storage'
import { NetworksController } from './networks'

describe('Networks Controller', () => {
  let networksController: INetworksController
  let skipBeforeEach = false

  beforeEach(async () => {
    if (skipBeforeEach) return

    const { mainCtrl } = await makeMainController(undefined)
    networksController = mainCtrl.networks
  })

  test('should initialize with predefined networks if storage is empty', async () => {
    await networksController.initialLoadPromise // Wait for load to complete

    const actualChainIds = networksController.networks.map((n) => n.chainId)
    const expectedChainIds = predefinedNetworks.map((n) => n.chainId)
    const disabledNetworks = networksController.disabledNetworks.map((n) => n.chainId)
    const expectedChainsWithoutDisabled = expectedChainIds.filter(
      (id) => !disabledNetworks.includes(id)
    )

    expect(actualChainIds).toEqual(expect.arrayContaining(expectedChainsWithoutDisabled))
  })

  test('should merge relayer networks correctly, including custom "unichain" network', async () => {
    // Add a custom network "unichain" to the predefined networks
    const customNetwork = {
      chainId: 130n,
      name: 'UniChain',
      nativeAssetSymbol: 'UNI',
      nativeAssetName: 'UniChain Token',
      rpcUrls: ['https://unichain.rpc.url-2'],
      explorerUrl: 'https://unichain.explorer',
      selectedRpcUrl: 'https://unichain.rpc.url-2',
      erc4337: {
        enabled: false,
        hasPaymaster: false
      },
      rpcNoStateOverride: false,
      feeOptions: {
        is1559: false
      },
      isSAEnabled: false,
      areContractsDeployed: false,
      features: [],
      hasRelayer: false,
      hasSingleton: false,
      platformId: 'unichain',
      nativeAssetId: '1234',
      predefined: false,
      has7702: false
    }
    const networksBeforeUpdate = [...predefinedNetworks, customNetwork]

    const finalNetworks = networksBeforeUpdate.reduce(
      (acc: { [key: string]: typeof customNetwork }, network) => {
        acc[network.chainId.toString()] = network as typeof customNetwork
        return acc
      },
      {}
    )

    const { mergedNetworks } = await networksController.mergeRelayerNetworks(finalNetworks)

    // Ensure the merged networks contain "unichain" and other relayer networks
    expect(mergedNetworks).toHaveProperty('130')
    expect(mergedNetworks['130']!.rpcUrls).toContain('https://unichain.rpc.url-2') // Ensure the custom "unichain" network is added to rpcUrls array
    expect(mergedNetworks['130']!.predefined).toBe(false) // Ensure "unichain" details are correct
  })

  test('should update network preferences', async () => {
    const preferences = {
      rpcUrls: ['https://eth-mainnet.alchemyapi.io/v2/123abc123abc123abc123abc123abcde'],
      explorerUrl: 'https://etherscan.io/custom'
    }

    await networksController.updateNetwork(preferences, 1n)

    const modifiedNetwork = networksController.networks.find(({ chainId }) => chainId === 1n)
    expect(modifiedNetwork?.explorerUrl).toEqual('https://etherscan.io/custom')
    expect(modifiedNetwork?.rpcUrls).toEqual([
      'https://eth-mainnet.alchemyapi.io/v2/123abc123abc123abc123abc123abcde'
    ])
  })

  test('should work in testnet mode', async () => {
    skipBeforeEach = true
    const { mainCtrl } = await makeMainController(undefined, {
      overrides: { featureFlags: { testnetMode: true } }
    })

    await mainCtrl.networks.initialLoadPromise
    expect(mainCtrl.networks.networks.find((n) => n.chainId === 1n)).toBe(undefined)
    expect(mainCtrl.networks.networks.find((n) => n.chainId === 11155111n)).not.toBe(undefined)
  })

  // TODO: Refactor Fantom test as well
  // test('should add the fantom network as a custom network', (done) => {
  //   let updateEmits = 0
  //   networksController.onUpdate(() => {
  //     if (updateEmits === 0) {
  //       updateEmits++
  //       return
  //     }

  //     if (updateEmits === 1) {
  //       updateEmits++
  //       const fantomNetwork = networksController.networks.find(({ id }) => id === 'fantom')
  //       expect(fantomNetwork).not.toBe(undefined)
  //       expect(fantomNetwork).not.toBe(null)
  //       expect(fantomNetwork?.chainId).toBe(250n)
  //       expect(fantomNetwork?.name).toBe('Fantom')
  //       expect(fantomNetwork?.nativeAssetSymbol).toBe('FTM')

  //       // fantom does not have the entry point
  //       expect(fantomNetwork?.erc4337?.enabled).toBe(false)
  //       expect(fantomNetwork?.erc4337?.hasPaymaster).toBe(false)

  //       // ...nor does it have the singleton
  //       expect(fantomNetwork?.isSAEnabled).toBe(true)

  //       // so contracts are not deployed
  //       expect(fantomNetwork?.areContractsDeployed).toBe(false)

  //       // it is 1559
  //       expect(fantomNetwork?.feeOptions.is1559).toBe(true)

  //       // it is not optimistic
  //       expect(fantomNetwork?.isOptimistic).toBe(false)

  //       // simulation is somewhat supported
  //       expect(fantomNetwork?.rpcNoStateOverride).toBe(false)

  //       // coingecko
  //       expect(fantomNetwork?.platformId).toBe('fantom')
  //       expect(fantomNetwork?.nativeAssetId).toBe('fantom')

  //       // contracts are not deployed
  //       const saSupport = fantomNetwork?.features.find((feat) => feat.id === 'saSupport')
  //       expect(saSupport).not.toBe(null)
  //       expect(saSupport).not.toBe(undefined)
  //       expect(saSupport!.level).toBe('warning')

  //       // no fee tokens
  //       const noFeeTokens = fantomNetwork?.features.find((feat) => feat.id === 'feeTokens')
  //       expect(noFeeTokens).not.toBe(null)
  //       expect(noFeeTokens).not.toBe(undefined)
  //       expect(noFeeTokens!.level).toBe('warning')

  //       // somewhat simulation
  //       const simulation = fantomNetwork?.features.find((feat) => feat.id === 'simulation')
  //       expect(simulation).not.toBe(null)
  //       expect(simulation).not.toBe(undefined)
  //       expect(simulation!.level).toBe('warning')
  //     }

  //     done()
  //   })

  //   networksController.addNetwork({
  //     name: 'Fantom',
  //     chainId: 250n,
  //     explorerUrl: 'https://ftmscan.com/',
  //     nativeAssetSymbol: 'FTM',
  //     rpcUrls: ['https://fantom-pokt.nodies.app']
  //   })
  // })
})

describe('Networks Controller - background relayer refresh', () => {
  let controller: NetworksController
  // Spy on the relayer merge so the background refresh is deterministic and never
  // hits the network. Its return value drives whether a network "changed".
  let mergeRelayerNetworks: jest.SpiedFunction<NetworksController['mergeRelayerNetworks']>
  // Stands in for MainController's real callback (setProvider + reloadSelectedAccount).
  let onAddOrUpdateNetworks: jest.Mock<(networks: Network[]) => Promise<void>>

  const noChange = (current: { [key: string]: Network }) => ({
    mergedNetworks: current,
    updatedNetworkChainIds: [] as bigint[]
  })

  // Polls until the (not-awaited) background sync kicked off from `#load` settles,
  // so each test starts from a clean `areNetworksFetchingFromRelayer === false`.
  const settleBackgroundSync = async () => {
    for (let i = 0; i < 100 && controller.areNetworksFetchingFromRelayer; i++) {
      await wait(0)
    }
  }

  // The relayer-merge implementation is applied synchronously right after `new`,
  // so the background `synchronizeNetworks` kicked off from `#load` already uses
  // it (its first await yields before reaching `synchronizeNetworks`). This avoids
  // a race where the construction-time refresh would run with a stale mock.
  const buildController = (
    defaultNetworksMode: 'mainnet' | 'testnet' = 'mainnet',
    mergeImpl: NetworksController['mergeRelayerNetworks'] = async (current) => noChange(current)
  ) => {
    onAddOrUpdateNetworks = jest.fn<(networks: Network[]) => Promise<void>>(async () => {})
    const ctrl = new NetworksController({
      defaultNetworksMode,
      storage: new StorageController(produceMemoryStore()),
      // Never invoked: `mergeRelayerNetworks` (the only relayer caller) is spied.
      fetch: jest.fn() as any,
      relayerUrl,
      // No-op: it never calls back, so no RPC/network-info work runs on load.
      useTempProvider: async () => {},
      onAddOrUpdateNetworks,
      onReady: async () => {}
    })
    mergeRelayerNetworks = jest.spyOn(ctrl, 'mergeRelayerNetworks').mockImplementation(mergeImpl)
    return ctrl
  }

  beforeEach(() => {
    jest.restoreAllMocks()
    controller = buildController()
  })

  test('resolves initialLoadPromise with stored networks without awaiting the relayer refresh', async () => {
    // Build with a relayer merge that stays pending, so the background refresh is
    // already in flight (with this impl) by the time the initial load resolves.
    let releaseMerge: () => void = () => {}
    controller = buildController(
      'mainnet',
      (current) =>
        new Promise((resolve) => {
          releaseMerge = () => resolve(noChange(current))
        })
    )

    await controller.initialLoadPromise

    // Networks are available immediately (seeded from predefined on a fresh install)
    // even though the relayer merge is still pending in the background.
    expect(controller.isInitialized).toBe(true)
    expect(controller.networks.length).toBeGreaterThan(0)
    expect(mergeRelayerNetworks).toHaveBeenCalledTimes(1)
    expect(controller.areNetworksFetchingFromRelayer).toBe(true)

    releaseMerge()
    await settleBackgroundSync()
    expect(controller.areNetworksFetchingFromRelayer).toBe(false)
  })

  test('flags areNetworksFetchingFromRelayer while a refresh is in flight and clears it after', async () => {
    await controller.initialLoadPromise
    await settleBackgroundSync()
    expect(controller.areNetworksFetchingFromRelayer).toBe(false)

    const syncPromise = controller.synchronizeNetworks()
    // Set synchronously before the first await inside synchronizeNetworks.
    expect(controller.areNetworksFetchingFromRelayer).toBe(true)

    await syncPromise
    expect(controller.areNetworksFetchingFromRelayer).toBe(false)
  })

  test('keeps the flag true until the portfolio reload finishes when an RPC changed (flash gate)', async () => {
    await controller.initialLoadPromise
    await settleBackgroundSync()

    mergeRelayerNetworks.mockImplementation(async (current) => ({
      mergedNetworks: current,
      updatedNetworkChainIds: [1n]
    }))

    let flagWhenReloadStarted: boolean | undefined
    let flagWhenReloadEnded: boolean | undefined
    onAddOrUpdateNetworks.mockImplementation(async () => {
      flagWhenReloadStarted = controller.areNetworksFetchingFromRelayer
      // Simulate the portfolio reload taking a tick to re-enter its loading state.
      await wait(0)
      flagWhenReloadEnded = controller.areNetworksFetchingFromRelayer
    })

    await controller.synchronizeNetworks()

    // The reload ran, and the flag stayed true for its full duration — so the UI
    // never flips out of the skeleton before the fresh (new-RPC) portfolio lands.
    expect(onAddOrUpdateNetworks).toHaveBeenCalledTimes(1)
    expect(flagWhenReloadStarted).toBe(true)
    expect(flagWhenReloadEnded).toBe(true)
    // Cleared only after the reload completed.
    expect(controller.areNetworksFetchingFromRelayer).toBe(false)
  })

  test('does not trigger a portfolio reload when nothing changed, but still clears the flag', async () => {
    await controller.initialLoadPromise
    await settleBackgroundSync()

    onAddOrUpdateNetworks.mockClear()
    mergeRelayerNetworks.mockImplementation(async (current) => noChange(current))

    await controller.synchronizeNetworks()

    expect(onAddOrUpdateNetworks).not.toHaveBeenCalled()
    expect(controller.areNetworksFetchingFromRelayer).toBe(false)
  })

  test('does not refresh from the relayer in testnet mode and keeps the flag false', async () => {
    controller = buildController('testnet')

    await controller.initialLoadPromise
    expect(controller.areNetworksFetchingFromRelayer).toBe(false)
    // `#load` skips the background refresh in testnet mode.
    expect(mergeRelayerNetworks).not.toHaveBeenCalled()

    // An explicit call early-returns before touching the relayer.
    await controller.synchronizeNetworks()
    expect(mergeRelayerNetworks).not.toHaveBeenCalled()
    expect(controller.areNetworksFetchingFromRelayer).toBe(false)
  })
})
