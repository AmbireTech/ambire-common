import { beforeEach, describe, expect, jest, test } from '@jest/globals'

import { relayerUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { suppressConsole, suppressConsoleBeforeEach } from '../../../test/helpers/console'
import { makeMainController } from '../../../test/helpers/mainController'
import { mockBundlerRequests } from '../../../test/mocks/bundler'
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
  getLoadingNetworkInfo,
  getSmartAccountsFeature,
  isNetworkInfoPending
} from '../../libs/networks/networks'
import wait from '../../utils/wait'
import { FeatureFlagsController } from '../featureFlags/featureFlags'
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
  fetch = jest.fn() as unknown as Fetch,
  featureFlags
}: {
  defaultNetworksMode?: 'mainnet' | 'testnet'
  mergeImpl?: NetworksController['mergeRelayerNetworks']
  useTempProvider?: (
    props: { rpcUrl: string; chainId: bigint },
    callback: (provider: RPCProvider) => Promise<void>
  ) => Promise<void>
  fetch?: Fetch
  featureFlags?: FeatureFlagsController
} = {}) => {
  const onAddOrUpdateNetworks = jest.fn<(networks: Network[]) => Promise<void>>(async () => {})
  const storage = new StorageController(produceMemoryStore())
  const controller = new NetworksController({
    defaultNetworksMode,
    storage,
    fetch,
    relayerUrl,
    useTempProvider,
    onAddOrUpdateNetworks,
    onReady: async () => {},
    featureFlags
  })
  const mergeRelayerNetworks = jest
    .spyOn(controller, 'mergeRelayerNetworks')
    .mockImplementation(mergeImpl)

  return { controller, mergeRelayerNetworks, onAddOrUpdateNetworks, storage }
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
    // Loading the testnets checks whether the bundler supports them, which isn't under test
    const { restore: restoreBundlerRequests } = mockBundlerRequests()
    try {
      const { mainCtrl } = await makeMainController(undefined, {
        overrides: { featureFlags: { testnetMode: true } }
      })

      await mainCtrl.networks.initialLoadPromise
      expect(mainCtrl.networks.networks.find((n) => n.chainId === 1n)).toBe(undefined)
      expect(mainCtrl.networks.networks.find((n) => n.chainId === 11155111n)).not.toBe(undefined)
    } finally {
      restoreBundlerRequests()
    }
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
    const useTempProvider = jest.fn(harness.useTempProvider)
    const { controller } = buildNetworksController({ useTempProvider, fetch: createFetchStub() })

    await controller.initialLoadPromise
    await settleBackgroundSync(controller)

    return { controller, harness, useTempProvider }
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

    const emissions: { level: NetworkFeature['level']; isPending: boolean }[] = []
    const unsubscribe = controller.onUpdate(() => {
      const info = controller.networkToAddOrUpdate?.info
      emissions.push({
        level: getSmartAccountsFeature(info).level,
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
    expect(emissions.filter(({ level }) => level === 'initial')).toEqual([])

    // The info fills in progressively, so it's emitted more than once.
    expect(emissions.length).toBeGreaterThan(2)
    expect(emissions[0]!.level).toBe('loading')

    // The gate the button reads is the part that must not oscillate: pending until the
    // final emission, then finished, and never back.
    expect(emissions.map(({ isPending }) => isPending)).toEqual([
      ...emissions.slice(0, -1).map(() => true),
      false
    ])
    expect(emissions[emissions.length - 1]!.level).not.toBe('loading')
  })

  test('an RPC change does not take the network info fetched for another network', async () => {
    const { controller, harness } = await buildForNetworkInfo()
    const infoRun = controller.setNetworkToAddOrUpdate({ chainId: CHAIN_ID_A, rpcUrl: RPC_URL_A })
    harness.release(RPC_URL_A)
    await infoRun
    expect(controller.networkToAddOrUpdate?.info?.nativeAssetId).toBe(NATIVE_ASSET_ID_A)

    // RPC_URL_B is never released, so the fresh info for this network stays pending
    await controller.updateNetwork({ selectedRpcUrl: RPC_URL_B }, 1n)

    // The info carries its own chainId, so taking it would also overwrite this network's chainId
    const updatedNetwork = controller.allNetworks.find((n) => n.chainId === 1n)
    expect(updatedNetwork).toBeDefined()
    expect(updatedNetwork?.nativeAssetId).not.toBe(NATIVE_ASSET_ID_A)
    expect(controller.allNetworks.some((n) => n.chainId === CHAIN_ID_A)).toBe(false)
  })

  test('an RPC change takes the network info fetched for the same network', async () => {
    const { controller, harness, useTempProvider } = await buildForNetworkInfo()
    const infoRun = controller.setNetworkToAddOrUpdate({ chainId: 1n, rpcUrl: RPC_URL_A })
    harness.release(RPC_URL_A)
    await infoRun
    const tempProviderCallsBefore = useTempProvider.mock.calls.length

    await controller.updateNetwork({ selectedRpcUrl: RPC_URL_A }, 1n)

    // Taking the fetched info means no new fetch is started for the selected RPC
    expect(useTempProvider).toHaveBeenCalledTimes(tempProviderCallsBefore)
    // Any chain other than A gets the B ids from the fetch stub
    expect(controller.allNetworks.find((n) => n.chainId === 1n)?.nativeAssetId).toBe(
      NATIVE_ASSET_ID_B
    )
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
      const { restore } = suppressConsole()
      const { controller } = await buildForNetworkInfo()
      const { statuses, unsubscribe } = recordAddNetworkStatuses(controller)

      await controller.addNetwork(addNetworkParams(CHAIN_ID_A, RPC_URL_A))
      unsubscribe()

      expect(statuses).toContain('ERROR')
      expect(statuses).not.toContain('SUCCESS')
      expect(controller.allNetworks.some((n) => n.chainId === CHAIN_ID_A)).toBe(false)
      restore()
    })

    test('ends in ERROR and adds nothing while the network info is still loading', async () => {
      const { restore } = suppressConsole()
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
      restore()
    })
  })
})

describe('Networks Controller - merge networks from another device', () => {
  const CUSTOM_NETWORK: Network = {
    ...predefinedNetworks[0]!,
    chainId: 123456789n,
    name: 'Custom network',
    rpcUrls: ['https://custom.example'],
    selectedRpcUrl: 'https://custom.example',
    predefined: false
  }

  beforeEach(() => {
    jest.restoreAllMocks()
  })

  test('overrides the networks it receives and leaves the others untouched', async () => {
    const { controller, onAddOrUpdateNetworks } = buildNetworksController()
    await controller.initialLoadPromise
    await settleBackgroundSync(controller)

    const [ethereum, untouched] = controller.allNetworks
    const syncedEthereum = {
      ...ethereum!,
      rpcUrls: [...ethereum!.rpcUrls, 'https://synced.example'],
      selectedRpcUrl: 'https://synced.example',
      disabled: true
    }

    await controller.mergeNetworks([syncedEthereum, CUSTOM_NETWORK])

    const byChainId = (chainId: bigint) => controller.allNetworks.find((n) => n.chainId === chainId)
    expect(byChainId(ethereum!.chainId)).toMatchObject({
      selectedRpcUrl: 'https://synced.example',
      disabled: true
    })
    expect(byChainId(CUSTOM_NETWORK.chainId)?.name).toBe('Custom network')
    expect(byChainId(untouched!.chainId)).toEqual(untouched)
    // The RPC providers of the merged networks get replaced
    expect(onAddOrUpdateNetworks).toHaveBeenCalledWith([
      expect.objectContaining({ chainId: ethereum!.chainId }),
      expect.objectContaining({ chainId: CUSTOM_NETWORK.chainId })
    ])
    // Persisted, so a restart keeps them
    expect(Object.keys(await controller.getNetworksInStorage())).toContain(
      CUSTOM_NETWORK.chainId.toString()
    )
  })

  test('does nothing when there are no networks to merge', async () => {
    const { controller, onAddOrUpdateNetworks } = buildNetworksController()
    await controller.initialLoadPromise
    await settleBackgroundSync(controller)
    const networksBefore = controller.allNetworks

    await controller.mergeNetworks([])

    expect(controller.allNetworks).toEqual(networksBefore)
    expect(onAddOrUpdateNetworks).not.toHaveBeenCalled()
  })
})

describe('Networks Controller - token prices opt-out', () => {
  const PRICE_API_PLATFORM_PATH = 'cena.ambire.com/api/v3/platform/'
  const CUSTOM_PLATFORM_ID = 'custom-platform'
  const CUSTOM_NATIVE_ASSET_ID = 'custom-native-asset'
  const CUSTOM_NETWORK_WITHOUT_PRICE_IDS: Network = {
    ...predefinedNetworks[0]!,
    chainId: 987654321n,
    name: 'Custom network',
    rpcUrls: ['https://custom.example'],
    selectedRpcUrl: 'https://custom.example',
    predefined: false,
    platformId: '',
    nativeAssetId: ''
  }
  const DISABLED_CUSTOM_NETWORK_WITHOUT_PRICE_IDS: Network = {
    ...CUSTOM_NETWORK_WITHOUT_PRICE_IDS,
    chainId: 987654322n,
    name: 'Disabled custom network',
    disabled: true
  }

  const createFeatureFlags = (tokenPrices: boolean) =>
    new FeatureFlagsController({ tokenPrices }, new StorageController(produceMemoryStore()))

  const createPriceApiFetchStub = (gate?: Promise<void>) =>
    jest.fn(async () => {
      if (gate) await gate

      return {
        status: 200,
        json: async () => ({
          platformId: CUSTOM_PLATFORM_ID,
          nativeAssetId: CUSTOM_NATIVE_ASSET_ID
        })
      }
    }) as unknown as Fetch

  const getPriceApiUrls = (fetch: Fetch) =>
    (fetch as unknown as jest.Mock).mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes(PRICE_API_PLATFORM_PATH))

  const byChainId = (controller: NetworksController, chainId: bigint) =>
    controller.allNetworks.find((n) => n.chainId === chainId)

  /** Builds an opted-out controller that already has custom networks without price ids. */
  const buildOptedOutWithCustomNetworks = async (fetch: Fetch) => {
    const featureFlags = createFeatureFlags(false)
    await featureFlags.initialLoadPromise
    const built = buildNetworksController({ fetch, featureFlags })
    await built.controller.initialLoadPromise
    await settleBackgroundSync(built.controller)
    await built.controller.mergeNetworks([
      CUSTOM_NETWORK_WITHOUT_PRICE_IDS,
      DISABLED_CUSTOM_NETWORK_WITHOUT_PRICE_IDS
    ])
    built.onAddOrUpdateNetworks.mockClear()

    return { ...built, featureFlags }
  }

  const waitUntil = async (condition: () => boolean) => {
    for (let i = 0; i < 100 && !condition(); i++) await wait(0)
  }

  beforeEach(() => {
    jest.restoreAllMocks()
  })

  test('adding a network while opted out does not call the price API', async () => {
    const featureFlags = createFeatureFlags(false)
    await featureFlags.initialLoadPromise
    const fetch = createPriceApiFetchStub()
    const { controller } = buildNetworksController({
      fetch,
      featureFlags,
      useTempProvider: async (_, callback) => {
        await callback({
          getCode: async () => '0x1234',
          getBlock: async () => ({ baseFeePerGas: 1n }),
          send: async () => '0x',
          call: async () => '0x'
        } as unknown as RPCProvider)
      }
    })
    await controller.initialLoadPromise
    await settleBackgroundSync(controller)

    await controller.setNetworkToAddOrUpdate({
      chainId: CUSTOM_NETWORK_WITHOUT_PRICE_IDS.chainId,
      rpcUrl: CUSTOM_NETWORK_WITHOUT_PRICE_IDS.selectedRpcUrl
    })

    expect(getPriceApiUrls(fetch)).toEqual([])
    expect(isNetworkInfoPending(controller.networkToAddOrUpdate?.info)).toBe(false)
    expect(controller.networkToAddOrUpdate?.info?.platformId).toBe('')
    expect(controller.networkToAddOrUpdate?.info?.nativeAssetId).toBe('')
  })

  test('opting back in fetches the missing price ids of custom networks only', async () => {
    const fetch = createPriceApiFetchStub()
    const { controller, featureFlags, onAddOrUpdateNetworks } =
      await buildOptedOutWithCustomNetworks(fetch)
    expect(getPriceApiUrls(fetch)).toEqual([])

    await featureFlags.setFeatureFlag('tokenPrices', true)
    await waitUntil(() => onAddOrUpdateNetworks.mock.calls.length > 0)

    // Predefined networks get their ids from the network config, so they are not looked up
    expect(getPriceApiUrls(fetch).sort()).toEqual(
      [
        `https://${PRICE_API_PLATFORM_PATH}${CUSTOM_NETWORK_WITHOUT_PRICE_IDS.chainId}`,
        `https://${PRICE_API_PLATFORM_PATH}${DISABLED_CUSTOM_NETWORK_WITHOUT_PRICE_IDS.chainId}`
      ].sort()
    )
    ;[CUSTOM_NETWORK_WITHOUT_PRICE_IDS, DISABLED_CUSTOM_NETWORK_WITHOUT_PRICE_IDS].forEach(
      ({ chainId }) => {
        expect(byChainId(controller, chainId)).toMatchObject({
          platformId: CUSTOM_PLATFORM_ID,
          nativeAssetId: CUSTOM_NATIVE_ASSET_ID
        })
      }
    )
    // Only the enabled network's portfolio is reloaded, as for a disabled one the callback
    // removes its data instead
    expect(onAddOrUpdateNetworks).toHaveBeenCalledTimes(1)
    expect(onAddOrUpdateNetworks).toHaveBeenCalledWith([
      expect.objectContaining({ chainId: CUSTOM_NETWORK_WITHOUT_PRICE_IDS.chainId })
    ])
    // Persisted, so a restart keeps them
    const networksInStorage = await controller.getNetworksInStorage()
    expect(networksInStorage[CUSTOM_NETWORK_WITHOUT_PRICE_IDS.chainId.toString()]?.platformId).toBe(
      CUSTOM_PLATFORM_ID
    )
  })

  test('does not apply the fetched price ids if the user opts out again meanwhile', async () => {
    let releasePriceApi: () => void = () => {}
    const priceApiGate = new Promise<void>((resolve) => {
      releasePriceApi = resolve
    })
    const fetch = createPriceApiFetchStub(priceApiGate)
    const { controller, featureFlags, onAddOrUpdateNetworks } =
      await buildOptedOutWithCustomNetworks(fetch)

    await featureFlags.setFeatureFlag('tokenPrices', true)
    await waitUntil(() => getPriceApiUrls(fetch).length > 0)
    await featureFlags.setFeatureFlag('tokenPrices', false)
    releasePriceApi()
    // Gives the refetch plenty of turns to (wrongly) apply its results
    for (let i = 0; i < 25; i++) await wait(0)

    expect(byChainId(controller, CUSTOM_NETWORK_WITHOUT_PRICE_IDS.chainId)?.platformId).toBe('')
    expect(onAddOrUpdateNetworks).not.toHaveBeenCalled()
  })

  test('leaves the networks untouched when the price API does not support them', async () => {
    const fetch = jest.fn(async () => ({
      status: 200,
      json: async () => ({ error: 'not found' })
    })) as unknown as Fetch
    const { controller, featureFlags, onAddOrUpdateNetworks } =
      await buildOptedOutWithCustomNetworks(fetch)

    await featureFlags.setFeatureFlag('tokenPrices', true)
    await waitUntil(() => getPriceApiUrls(fetch).length === 2)
    for (let i = 0; i < 25; i++) await wait(0)

    expect(byChainId(controller, CUSTOM_NETWORK_WITHOUT_PRICE_IDS.chainId)?.platformId).toBe('')
    expect(onAddOrUpdateNetworks).not.toHaveBeenCalled()
  })

  test('stops reacting to the opt-out once destroyed', async () => {
    const fetch = createPriceApiFetchStub()
    const { controller, featureFlags } = await buildOptedOutWithCustomNetworks(fetch)

    controller.destroy()
    await featureFlags.setFeatureFlag('tokenPrices', true)
    for (let i = 0; i < 25; i++) await wait(0)

    expect(getPriceApiUrls(fetch)).toEqual([])
  })
})

describe('Networks Controller - ERC-4337 opt-out', () => {
  const BUNDLER_HEALTH_PATH = 'api.pimlico.io/health'
  const UNCHECKED_CUSTOM_NETWORK: Network = {
    ...predefinedNetworks[0]!,
    chainId: 987654331n,
    name: 'Custom network added while opted out',
    rpcUrls: ['https://custom.example'],
    selectedRpcUrl: 'https://custom.example',
    predefined: false,
    erc4337: { enabled: false, hasPaymaster: false }
  }
  const DISABLED_UNCHECKED_CUSTOM_NETWORK: Network = {
    ...UNCHECKED_CUSTOM_NETWORK,
    chainId: 987654332n,
    name: 'Disabled custom network added while opted out',
    disabled: true
  }
  const CHECKED_CUSTOM_NETWORK: Network = {
    ...UNCHECKED_CUSTOM_NETWORK,
    chainId: 987654333n,
    name: 'Custom network the bundler does not support',
    erc4337: { enabled: false, hasPaymaster: false, hasBundlerSupport: false }
  }
  const RELAYER_NETWORK_WITHOUT_BUNDLER_INFO: Network = {
    ...UNCHECKED_CUSTOM_NETWORK,
    chainId: 987654334n,
    name: 'Relayer network',
    predefinedConfigVersion: 1
  }
  const stubProvider = async (
    _: { rpcUrl: string; chainId: bigint },
    callback: (provider: RPCProvider) => Promise<void>
  ) => {
    await callback({
      getCode: async () => '0x1234',
      getBlock: async () => ({ baseFeePerGas: 1n }),
      send: async () => '0x',
      call: async () => '0x'
    } as unknown as RPCProvider)
  }

  const createFeatureFlags = (erc4337: boolean) =>
    new FeatureFlagsController({ erc4337 }, new StorageController(produceMemoryStore()))

  const createBundlerFetchStub = ({
    gate,
    status = 200
  }: { gate?: Promise<void>; status?: number } = {}) =>
    jest.fn(async () => {
      if (gate) await gate

      return { status, json: async () => ({}) }
    }) as unknown as Fetch

  const getBundlerChainIds = (fetch: Fetch) =>
    (fetch as unknown as jest.Mock).mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.includes(BUNDLER_HEALTH_PATH))
      .map((url) => url.split('chain-id=')[1])

  const byChainId = (controller: NetworksController, chainId: bigint) =>
    controller.allNetworks.find((n) => n.chainId === chainId)

  /** Builds an opted-out controller that already has custom networks. */
  const buildOptedOutWithCustomNetworks = async (fetch: Fetch) => {
    const featureFlags = createFeatureFlags(false)
    await featureFlags.initialLoadPromise
    const built = buildNetworksController({ fetch, featureFlags })
    await built.controller.initialLoadPromise
    await settleBackgroundSync(built.controller)
    await built.controller.mergeNetworks([
      UNCHECKED_CUSTOM_NETWORK,
      DISABLED_UNCHECKED_CUSTOM_NETWORK,
      CHECKED_CUSTOM_NETWORK,
      RELAYER_NETWORK_WITHOUT_BUNDLER_INFO
    ])
    built.onAddOrUpdateNetworks.mockClear()

    return { ...built, featureFlags }
  }

  const waitUntil = async (condition: () => boolean) => {
    for (let i = 0; i < 100 && !condition(); i++) await wait(0)
  }

  beforeEach(() => {
    jest.restoreAllMocks()
  })

  test('adding a network while opted out does not call the bundler', async () => {
    const featureFlags = createFeatureFlags(false)
    await featureFlags.initialLoadPromise
    const fetch = createBundlerFetchStub()
    const { controller } = buildNetworksController({
      fetch,
      featureFlags,
      useTempProvider: stubProvider
    })
    await controller.initialLoadPromise
    await settleBackgroundSync(controller)

    await controller.setNetworkToAddOrUpdate({
      chainId: UNCHECKED_CUSTOM_NETWORK.chainId,
      rpcUrl: UNCHECKED_CUSTOM_NETWORK.selectedRpcUrl
    })

    expect(getBundlerChainIds(fetch)).toEqual([])
    expect(isNetworkInfoPending(controller.networkToAddOrUpdate?.info)).toBe(false)
    expect(controller.networkToAddOrUpdate?.info?.erc4337).toEqual({
      enabled: false,
      hasPaymaster: false
    })
  })

  test('opting back in checks the network that is being added again, with the bundler', async () => {
    const featureFlags = createFeatureFlags(false)
    await featureFlags.initialLoadPromise
    const fetch = createBundlerFetchStub()
    const { controller } = buildNetworksController({
      fetch,
      featureFlags,
      useTempProvider: stubProvider
    })
    await controller.initialLoadPromise
    await settleBackgroundSync(controller)
    await controller.setNetworkToAddOrUpdate({
      chainId: UNCHECKED_CUSTOM_NETWORK.chainId,
      rpcUrl: UNCHECKED_CUSTOM_NETWORK.selectedRpcUrl
    })
    expect(getBundlerChainIds(fetch)).toEqual([])

    await featureFlags.setFeatureFlag('erc4337', true)
    await waitUntil(
      () =>
        getBundlerChainIds(fetch).length > 0 &&
        !isNetworkInfoPending(controller.networkToAddOrUpdate?.info)
    )

    expect(getBundlerChainIds(fetch)).toEqual([UNCHECKED_CUSTOM_NETWORK.chainId.toString()])
    expect(controller.networkToAddOrUpdate).toMatchObject({
      chainId: UNCHECKED_CUSTOM_NETWORK.chainId,
      rpcUrl: UNCHECKED_CUSTOM_NETWORK.selectedRpcUrl
    })
    expect(controller.networkToAddOrUpdate?.info?.erc4337).toEqual({
      enabled: true,
      hasPaymaster: false,
      hasBundlerSupport: true
    })
  })

  test('opting back in checks only the custom networks that were never checked', async () => {
    const fetch = createBundlerFetchStub()
    const { controller, featureFlags, onAddOrUpdateNetworks } =
      await buildOptedOutWithCustomNetworks(fetch)
    expect(getBundlerChainIds(fetch)).toEqual([])

    await featureFlags.setFeatureFlag('erc4337', true)
    await waitUntil(
      () => byChainId(controller, UNCHECKED_CUSTOM_NETWORK.chainId)?.erc4337.enabled === true
    )

    // Predefined and Relayer networks get their settings from the network config, and the
    // checked network keeps its answer until the usual refresh of the network info
    expect(getBundlerChainIds(fetch).sort()).toEqual(
      [
        UNCHECKED_CUSTOM_NETWORK.chainId.toString(),
        DISABLED_UNCHECKED_CUSTOM_NETWORK.chainId.toString()
      ].sort()
    )
    ;[UNCHECKED_CUSTOM_NETWORK, DISABLED_UNCHECKED_CUSTOM_NETWORK].forEach(({ chainId }) => {
      expect(byChainId(controller, chainId)?.erc4337).toEqual({
        enabled: true,
        hasPaymaster: false,
        hasBundlerSupport: true
      })
    })
    expect(byChainId(controller, CHECKED_CUSTOM_NETWORK.chainId)?.erc4337).toEqual(
      CHECKED_CUSTOM_NETWORK.erc4337
    )
    expect(byChainId(controller, RELAYER_NETWORK_WITHOUT_BUNDLER_INFO.chainId)?.erc4337).toEqual(
      RELAYER_NETWORK_WITHOUT_BUNDLER_INFO.erc4337
    )
    // Nothing else changed, so the portfolio isn't reloaded
    expect(onAddOrUpdateNetworks).not.toHaveBeenCalled()
    // Persisted, so a restart doesn't check them again
    const networksInStorage = await controller.getNetworksInStorage()
    expect(
      networksInStorage[UNCHECKED_CUSTOM_NETWORK.chainId.toString()]?.erc4337.hasBundlerSupport
    ).toBe(true)
  })

  test('records that the bundler does not support a network', async () => {
    const fetch = createBundlerFetchStub({ status: 404 })
    const { controller, featureFlags } = await buildOptedOutWithCustomNetworks(fetch)

    await featureFlags.setFeatureFlag('erc4337', true)
    await waitUntil(
      () =>
        byChainId(controller, UNCHECKED_CUSTOM_NETWORK.chainId)?.erc4337.hasBundlerSupport ===
        false
    )

    expect(byChainId(controller, UNCHECKED_CUSTOM_NETWORK.chainId)?.erc4337).toEqual({
      enabled: false,
      hasPaymaster: false,
      hasBundlerSupport: false
    })
  })

  test('leaves a network unchecked when the bundler request fails, to retry it later', async () => {
    const fetch = jest.fn(async () => {
      throw new Error('Network error')
    }) as unknown as Fetch
    const { controller, featureFlags } = await buildOptedOutWithCustomNetworks(fetch)
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    await featureFlags.setFeatureFlag('erc4337', true)
    await waitUntil(() => getBundlerChainIds(fetch).length === 2)
    for (let i = 0; i < 25; i++) await wait(0)

    expect(byChainId(controller, UNCHECKED_CUSTOM_NETWORK.chainId)?.erc4337).toEqual(
      UNCHECKED_CUSTOM_NETWORK.erc4337
    )
    // Logged, not swallowed
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  test('does not apply the bundler answers if the user opts out again meanwhile', async () => {
    let releaseBundler: () => void = () => {}
    const bundlerGate = new Promise<void>((resolve) => {
      releaseBundler = resolve
    })
    const fetch = createBundlerFetchStub({ gate: bundlerGate })
    const { controller, featureFlags } = await buildOptedOutWithCustomNetworks(fetch)

    await featureFlags.setFeatureFlag('erc4337', true)
    await waitUntil(() => getBundlerChainIds(fetch).length > 0)
    await featureFlags.setFeatureFlag('erc4337', false)
    releaseBundler()
    // Gives the check plenty of turns to (wrongly) apply its results
    for (let i = 0; i < 25; i++) await wait(0)

    expect(byChainId(controller, UNCHECKED_CUSTOM_NETWORK.chainId)?.erc4337).toEqual(
      UNCHECKED_CUSTOM_NETWORK.erc4337
    )
  })

  test('stops reacting to the opt-out once destroyed', async () => {
    const fetch = createBundlerFetchStub()
    const { controller, featureFlags } = await buildOptedOutWithCustomNetworks(fetch)

    controller.destroy()
    await featureFlags.setFeatureFlag('erc4337', true)
    for (let i = 0; i < 25; i++) await wait(0)

    expect(getBundlerChainIds(fetch)).toEqual([])
  })
})

describe('Networks Controller - update a network that does not exist', () => {
  const UNKNOWN_CHAIN_ID = 987654321987n

  // The unknown network errors are logged; restored after each test even if it fails
  suppressConsoleBeforeEach()

  const buildLoadedController = async () => {
    const built = buildNetworksController()
    await built.controller.initialLoadPromise
    await settleBackgroundSync(built.controller)
    return built
  }

  // `statuses.updateNetwork` is reset to INITIAL by `withStatus` once it returns, so the
  // transitions have to be recorded as they are emitted.
  const recordUpdateNetworkStatuses = (controller: NetworksController) => {
    const statuses: string[] = []
    const unsubscribe = controller.onUpdate(() => {
      const current = controller.statuses.updateNetwork
      if (statuses[statuses.length - 1] !== current) statuses.push(current)
    })

    return { statuses, unsubscribe }
  }

  test('ends in ERROR and neither keeps nor saves the unknown network', async () => {
    const { controller, onAddOrUpdateNetworks, storage } = await buildLoadedController()
    const chainIdsBefore = controller.allNetworks.map((n) => n.chainId)
    const { statuses, unsubscribe } = recordUpdateNetworkStatuses(controller)

    await controller.updateNetwork({ disabled: false }, UNKNOWN_CHAIN_ID)
    unsubscribe()

    expect(statuses).toContain('ERROR')
    expect(statuses).not.toContain('SUCCESS')
    expect(controller.allNetworks.map((n) => n.chainId)).toEqual(chainIdsBefore)
    expect(onAddOrUpdateNetworks).not.toHaveBeenCalled()
    // Read the raw value, as `getNetworksInStorage` already filters out broken networks
    const stored: { [key: string]: Network } = await storage.get('networks', {})
    expect(stored).not.toHaveProperty(UNKNOWN_CHAIN_ID.toString())
  })

  test('keeps the controller able to emit updates and to update existing networks', async () => {
    const { controller } = await buildLoadedController()

    await controller.updateNetwork({ disabled: false }, UNKNOWN_CHAIN_ID)

    expect(() => controller.toJSON()).not.toThrow()
    await controller.updateNetwork({ explorerUrl: 'https://etherscan.io/custom' }, 1n)
    expect(controller.allNetworks.find((n) => n.chainId === 1n)?.explorerUrl).toBe(
      'https://etherscan.io/custom'
    )
  })

  test('updates none of the networks when one of several chainIds is unknown', async () => {
    const { controller, onAddOrUpdateNetworks, storage } = await buildLoadedController()
    const explorerUrlBefore = controller.allNetworks.find((n) => n.chainId === 1n)?.explorerUrl
    const { statuses, unsubscribe } = recordUpdateNetworkStatuses(controller)

    await controller.updateNetworks({ explorerUrl: 'https://etherscan.io/custom' }, [
      1n,
      UNKNOWN_CHAIN_ID
    ])
    unsubscribe()

    expect(statuses).toContain('ERROR')
    expect(statuses).not.toContain('SUCCESS')
    expect(controller.allNetworks.find((n) => n.chainId === 1n)?.explorerUrl).toBe(
      explorerUrlBefore
    )
    expect(controller.allNetworks.some((n) => n.chainId === UNKNOWN_CHAIN_ID)).toBe(false)
    expect(onAddOrUpdateNetworks).not.toHaveBeenCalled()
    const stored: { [key: string]: Network } = await storage.get('networks', {})
    expect(stored['1']?.explorerUrl).toBe(explorerUrlBefore)
    expect(stored).not.toHaveProperty(UNKNOWN_CHAIN_ID.toString())
  })

  test('clears the network info fetched for the rejected update', async () => {
    const { controller } = await buildLoadedController()

    await controller.setNetworkToAddOrUpdate({ chainId: 1n, rpcUrl: 'https://rpc.test' })
    expect(controller.networkToAddOrUpdate).not.toBe(null)
    await controller.updateNetwork({ selectedRpcUrl: 'https://rpc.test' }, UNKNOWN_CHAIN_ID)
    expect(controller.networkToAddOrUpdate).toBe(null)

    await controller.setNetworkToAddOrUpdate({ chainId: 1n, rpcUrl: 'https://rpc.test' })
    expect(controller.networkToAddOrUpdate).not.toBe(null)
    await controller.updateNetworks({ disabled: false }, [1n, UNKNOWN_CHAIN_ID])
    expect(controller.networkToAddOrUpdate).toBe(null)
  })

  test('still updates several networks when all chainIds are known', async () => {
    const { controller, onAddOrUpdateNetworks } = await buildLoadedController()

    await controller.updateNetworks({ explorerUrl: 'https://explorer.example' }, [1n, 10n])

    expect(controller.allNetworks.find((n) => n.chainId === 1n)?.explorerUrl).toBe(
      'https://explorer.example'
    )
    expect(controller.allNetworks.find((n) => n.chainId === 10n)?.explorerUrl).toBe(
      'https://explorer.example'
    )
    expect(onAddOrUpdateNetworks).toHaveBeenCalledTimes(1)
  })
})
