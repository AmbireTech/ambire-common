import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import { relayerUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { makeMainController } from '../../../test/helpers/mainController'
import { SINGLETON } from '../../consts/deploy'
import { networks as predefinedNetworks } from '../../consts/networks'
import { Fetch } from '../../interfaces/fetch'
import {
  AddNetworkRequestParams,
  INetworksController,
  Network,
  NetworkFeature
} from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import {
  getFeaturesByNetworkProperties,
  getLoadingNetworkInfo,
  isNetworkInfoPending
} from '../../libs/networks/networks'
import wait from '../../utils/wait'
import { StorageController } from '../storage/storage'
import { NetworksController } from './networks'

const noRelayerChange = (current: { [key: string]: Network }) => ({
  mergedNetworks: current,
  updatedNetworkChainIds: [] as bigint[]
})

/**
 * Builds a NetworksController with the relayer merge spied out, so tests never hit the
 * network. Returns the controller together with the injected doubles.
 *
 * The relayer-merge implementation is applied synchronously right after `new`, so the
 * background `synchronizeNetworks` kicked off from `#load` already uses it (its first
 * await yields before reaching `synchronizeNetworks`). This avoids a race where the
 * construction-time refresh would run with a stale mock.
 */
const buildNetworksController = ({
  defaultNetworksMode = 'mainnet',
  mergeImpl = async (current) => noRelayerChange(current),
  // No-op by default: it never calls back, so no RPC/network-info work runs on load.
  useTempProvider = async () => {},
  // Never invoked by default: `mergeRelayerNetworks` (the only relayer caller) is spied.
  fetch = jest.fn() as unknown as Fetch
}: {
  defaultNetworksMode?: 'mainnet' | 'testnet'
  mergeImpl?: NetworksController['mergeRelayerNetworks']
  useTempProvider?: (
    props: { rpcUrl: string; chainId: bigint },
    callback: (provider: RPCProvider) => Promise<void>
  ) => Promise<void>
  fetch?: Fetch
} = {}) => {
  const onAddOrUpdateNetworks = jest.fn<(networks: Network[]) => Promise<void>>(async () => {})
  const controller = new NetworksController({
    defaultNetworksMode,
    storage: new StorageController(produceMemoryStore()),
    fetch,
    relayerUrl,
    useTempProvider,
    onAddOrUpdateNetworks,
    onReady: async () => {}
  })
  const mergeRelayerNetworks = jest
    .spyOn(controller, 'mergeRelayerNetworks')
    .mockImplementation(mergeImpl)

  return { controller, mergeRelayerNetworks, onAddOrUpdateNetworks }
}

/**
 * Polls until the (not-awaited) background sync kicked off from `#load` settles, so each
 * test starts from a clean `areNetworksFetchingFromRelayer === false`.
 */
const settleBackgroundSync = async (controller: NetworksController) => {
  for (let i = 0; i < 100 && controller.areNetworksFetchingFromRelayer; i++) {
    await wait(0)
  }
}

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

  const buildController = (
    defaultNetworksMode: 'mainnet' | 'testnet' = 'mainnet',
    mergeImpl: NetworksController['mergeRelayerNetworks'] = async (current) =>
      noRelayerChange(current)
  ) => {
    const built = buildNetworksController({ defaultNetworksMode, mergeImpl })
    mergeRelayerNetworks = built.mergeRelayerNetworks
    onAddOrUpdateNetworks = built.onAddOrUpdateNetworks
    return built.controller
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
          releaseMerge = () => resolve(noRelayerChange(current))
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
    await settleBackgroundSync(controller)
    expect(controller.areNetworksFetchingFromRelayer).toBe(false)
  })

  test('flags areNetworksFetchingFromRelayer while a refresh is in flight and clears it after', async () => {
    await controller.initialLoadPromise
    await settleBackgroundSync(controller)
    expect(controller.areNetworksFetchingFromRelayer).toBe(false)

    const syncPromise = controller.synchronizeNetworks()
    // Set synchronously before the first await inside synchronizeNetworks.
    expect(controller.areNetworksFetchingFromRelayer).toBe(true)

    await syncPromise
    expect(controller.areNetworksFetchingFromRelayer).toBe(false)
  })

  test('keeps the flag true until the portfolio reload finishes when an RPC changed (flash gate)', async () => {
    await controller.initialLoadPromise
    await settleBackgroundSync(controller)

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
    await settleBackgroundSync(controller)

    onAddOrUpdateNetworks.mockClear()
    mergeRelayerNetworks.mockImplementation(async (current) => noRelayerChange(current))

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

describe('Networks Controller - add or update network info', () => {
  const RPC_URL_A = 'https://rpc-a.test'
  const RPC_URL_B = 'https://rpc-b.test'
  const CHAIN_ID_A = 4242421n
  const CHAIN_ID_B = 4242422n
  const NATIVE_ASSET_ID_A = 'native-asset-a'
  const NATIVE_ASSET_ID_B = 'native-asset-b'
  const PLATFORM_ID_A = 'platform-a'
  const PLATFORM_ID_B = 'platform-b'
  const DEPLOYED_CONTRACT_CODE = '0x1234'
  const COINGECKO_PLATFORM_PATH_A = `/platform/${Number(CHAIN_ID_A)}`

  const addNetworkParams = (chainId: bigint, rpcUrl: string): AddNetworkRequestParams => ({
    name: `Test network ${chainId}`,
    rpcUrls: [rpcUrl],
    selectedRpcUrl: rpcUrl,
    chainId,
    nativeAssetSymbol: 'TST',
    nativeAssetName: 'Test token',
    explorerUrl: 'https://explorer.test',
    iconUrls: []
  })

  // Answers both the coingecko platform lookup and the bundler health check. The asset ids
  // differ per chain, which is how a test tells whose network info actually landed.
  const createFetchStub = () =>
    jest.fn(async (url: string) => {
      const isChainA = url.includes(COINGECKO_PLATFORM_PATH_A)

      return {
        status: 200,
        json: async () => ({
          platformId: isChainA ? PLATFORM_ID_A : PLATFORM_ID_B,
          nativeAssetId: isChainA ? NATIVE_ASSET_ID_A : NATIVE_ASSET_ID_B
        })
      }
    }) as unknown as Fetch

  /**
   * Hands out one provider per RPC URL whose probes are held back until that URL is
   * released, so two concurrent runs can be resolved in whatever order a test needs.
   */
  const createTempProviderHarness = () => {
    const gates = new Map<string, { promise: Promise<void>; release: () => void }>()
    const unreachableRpcUrls = new Set<string>()

    const gateFor = (rpcUrl: string) => {
      const existingGate = gates.get(rpcUrl)
      if (existingGate) return existingGate

      let release: () => void = () => {}
      const promise = new Promise<void>((resolve) => {
        release = resolve
      })
      const gate = { promise, release }
      gates.set(rpcUrl, gate)

      return gate
    }

    const useTempProvider = async (
      { rpcUrl }: { rpcUrl: string; chainId: bigint },
      callback: (provider: RPCProvider) => Promise<void>
    ) => {
      const provider = {
        getCode: async (address: string) => {
          await gateFor(rpcUrl).promise
          // On an unreachable RPC only the singleton probe fails, so `retryRequest` raises
          // 'flagged' while the remaining probes still resolve - the shape a broken RPC
          // produces, and the one that used to flip the button back to disabled.
          if (unreachableRpcUrls.has(rpcUrl) && address === SINGLETON)
            throw new Error(`${rpcUrl} did not respond`)

          return DEPLOYED_CONTRACT_CODE
        },
        getBlock: async () => {
          await gateFor(rpcUrl).promise
          return { baseFeePerGas: 1n }
        },
        send: async () => {
          await gateFor(rpcUrl).promise
          return '0x'
        },
        call: async () => '0x',
        destroy: () => {}
      } as unknown as RPCProvider

      await callback(provider)
    }

    return {
      useTempProvider,
      release: (rpcUrl: string) => gateFor(rpcUrl).release(),
      markUnreachable: (rpcUrl: string) => unreachableRpcUrls.add(rpcUrl)
    }
  }

  const buildForNetworkInfo = async () => {
    const harness = createTempProviderHarness()
    const { controller } = buildNetworksController({
      useTempProvider: harness.useTempProvider,
      fetch: createFetchStub()
    })

    await controller.initialLoadPromise
    await settleBackgroundSync(controller)

    return { controller, harness }
  }

  test('seeds info with the all-loading shape before its first await', async () => {
    const { controller, harness } = await buildForNetworkInfo()

    const pendingRun = controller.setNetworkToAddOrUpdate({
      chainId: CHAIN_ID_A,
      rpcUrl: RPC_URL_A
    })

    // Set synchronously, before the first await inside setNetworkToAddOrUpdate. Until it
    // is set the UI reads the request as "nothing requested yet" and keeps the add/save
    // button clickable.
    expect(controller.networkToAddOrUpdate).toEqual({
      chainId: CHAIN_ID_A,
      rpcUrl: RPC_URL_A,
      info: getLoadingNetworkInfo(CHAIN_ID_A)
    })

    harness.release(RPC_URL_A)
    await pendingRun

    expect(controller.networkToAddOrUpdate?.info?.nativeAssetId).toBe(NATIVE_ASSET_ID_A)
  })

  test('discards a stale run instead of letting it overwrite the newest one', async () => {
    const { controller, harness } = await buildForNetworkInfo()
    harness.markUnreachable(RPC_URL_A)

    const staleRun = controller.setNetworkToAddOrUpdate({
      chainId: CHAIN_ID_A,
      rpcUrl: RPC_URL_A
    })
    const latestRun = controller.setNetworkToAddOrUpdate({
      chainId: CHAIN_ID_B,
      rpcUrl: RPC_URL_B
    })

    harness.release(RPC_URL_B)
    await latestRun

    expect(controller.networkToAddOrUpdate?.rpcUrl).toBe(RPC_URL_B)
    expect(controller.networkToAddOrUpdate?.info?.nativeAssetId).toBe(NATIVE_ASSET_ID_B)
    expect(controller.networkToAddOrUpdate?.info?.flagged).toBe(false)

    // The stale run resolves last and is flagged. Neither its flag nor its asset ids may
    // be attributed to the RPC URL that is actually selected now.
    harness.release(RPC_URL_A)
    await staleRun

    expect(controller.networkToAddOrUpdate?.rpcUrl).toBe(RPC_URL_B)
    expect(controller.networkToAddOrUpdate?.chainId).toBe(CHAIN_ID_B)
    expect(controller.networkToAddOrUpdate?.info?.platformId).toBe(PLATFORM_ID_B)
    expect(controller.networkToAddOrUpdate?.info?.nativeAssetId).toBe(NATIVE_ASSET_ID_B)
    expect(controller.networkToAddOrUpdate?.info?.flagged).toBe(false)
  })

  test('a reset invalidates a pending run, so its late result cannot resurrect it', async () => {
    const { controller, harness } = await buildForNetworkInfo()

    const pendingRun = controller.setNetworkToAddOrUpdate({
      chainId: CHAIN_ID_A,
      rpcUrl: RPC_URL_A
    })
    await controller.setNetworkToAddOrUpdate(null)
    expect(controller.networkToAddOrUpdate).toBe(null)

    harness.release(RPC_URL_A)
    await pendingRun

    expect(controller.networkToAddOrUpdate).toBe(null)
  })

  test('streams a single request without ever reporting it as finished early', async () => {
    const { controller, harness } = await buildForNetworkInfo()

    const emissions: { levels: NetworkFeature['level'][]; isPending: boolean }[] = []
    const unsubscribe = controller.onUpdate(() => {
      const info = controller.networkToAddOrUpdate?.info
      emissions.push({
        levels: getFeaturesByNetworkProperties(info, undefined).map((feature) => feature.level),
        isPending: isNetworkInfoPending(info)
      })
    })

    const pendingRun = controller.setNetworkToAddOrUpdate({
      chainId: CHAIN_ID_A,
      rpcUrl: RPC_URL_A
    })
    harness.release(RPC_URL_A)
    await pendingRun
    unsubscribe()

    // `initial` means "nothing requested yet" and leaves the add/save button clickable, so
    // it must never appear while a request is in flight.
    expect(emissions.filter(({ levels }) => levels.includes('initial'))).toEqual([])

    // The rows fill in progressively, so the feature levels do change more than once.
    expect(emissions.length).toBeGreaterThan(2)
    expect(emissions[0]!.levels).toEqual(['loading', 'loading', 'loading'])

    // The gate the button reads is the part that must not oscillate: pending until the
    // final emission, then finished, and never back.
    expect(emissions.map(({ isPending }) => isPending)).toEqual([
      ...emissions.slice(0, -1).map(() => true),
      false
    ])
    expect(emissions[emissions.length - 1]!.levels).not.toContain('loading')
  })

  describe('addNetwork before the network info resolved', () => {
    // `statuses.addNetwork` is reset to INITIAL by `withStatus` once it returns, so the
    // transitions have to be recorded as they are emitted.
    const recordAddNetworkStatuses = (controller: NetworksController) => {
      const statuses: string[] = []
      const unsubscribe = controller.onUpdate(() => {
        const current = controller.statuses.addNetwork
        if (statuses[statuses.length - 1] !== current) statuses.push(current)
      })

      return { statuses, unsubscribe }
    }

    test('ends in ERROR and adds nothing when there is no network info at all', async () => {
      const { controller } = await buildForNetworkInfo()
      const { statuses, unsubscribe } = recordAddNetworkStatuses(controller)

      await controller.addNetwork(addNetworkParams(CHAIN_ID_A, RPC_URL_A))
      unsubscribe()

      expect(statuses).toContain('ERROR')
      expect(statuses).not.toContain('SUCCESS')
      expect(controller.allNetworks.some((n) => n.chainId === CHAIN_ID_A)).toBe(false)
    })

    test('ends in ERROR and adds nothing while the network info is still loading', async () => {
      const { controller, harness } = await buildForNetworkInfo()

      const pendingRun = controller.setNetworkToAddOrUpdate({
        chainId: CHAIN_ID_A,
        rpcUrl: RPC_URL_A
      })
      expect(
        Object.values(controller.networkToAddOrUpdate!.info!).some((prop) => prop === 'LOADING')
      ).toBe(true)

      const { statuses, unsubscribe } = recordAddNetworkStatuses(controller)
      await controller.addNetwork(addNetworkParams(CHAIN_ID_A, RPC_URL_A))
      unsubscribe()

      expect(statuses).toContain('ERROR')
      expect(statuses).not.toContain('SUCCESS')
      expect(controller.allNetworks.some((n) => n.chainId === CHAIN_ID_A)).toBe(false)

      harness.release(RPC_URL_A)
      await pendingRun
    })
  })
})
