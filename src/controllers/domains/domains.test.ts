import { getAddress } from 'ethers'

import { expect, jest } from '@jest/globals'

import { suppressConsole } from '../../../test/helpers/console'
import { networks } from '../../consts/networks'
import * as ensDomainsModule from '../../services/ensDomains'
import { getRpcProvider } from '../../services/provider'
import {
  DomainsController,
  PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS,
  PERSIST_DOMAIN_FOR_IN_MS
} from './domains'

const citrea = {
  predefinedConfigVersion: 5,
  chainId: 4114n,
  platformId: 'citrea',
  name: 'Citrea Mainnet',
  nativeAssetSymbol: 'wBTC',
  nativeAssetName: 'Wrapped Citrea Bitcoin',
  iconUrls: ['https://cena.ambire.com/public/networks/citrea-logo.png'],
  explorerUrl: 'https://explorer.mainnet.citrea.xyz',
  rpcUrls: ['https://rpc.mainnet.citrea.xyz'],
  selectedRpcUrl: 'https://rpc.mainnet.citrea.xyz',
  rpcNoStateOverride: false,
  isOptimistic: false,
  disableEstimateGas: true,
  feeOptions: {
    is1559: true
  },
  isSAEnabled: true,
  areContractsDeployed: true,
  hasRelayer: false,
  erc4337: {
    enabled: true,
    hasPaymaster: true,
    hasBundlerSupport: true,
    bundlers: ['pimlico'],
    defaultBundler: 'pimlico'
  },
  nativeAssetId: 'bitcoin',
  hasSingleton: true,
  features: [],
  predefined: true,
  wrappedAddr: '0x0000000000000000000000000000000000000000',
  has7702: true
}

const providers = {
  ['1']: getRpcProvider(networks.find((n) => n.chainId === 1n)!.rpcUrls, 1n),
  ['4114']: getRpcProvider(citrea.rpcUrls, citrea.chainId)
}

// 0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41
const ENS_OLDEST_RESOLVER = {
  address: '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337',
  name: 'elmoto.eth'
}

// 0x231b0Ee14048e9dCcD1d247744d114a4EB5E8E63
const ENS_OLD_RESOLVER = {
  address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  name: 'vitalik.eth'
}

// 0xF29100983E058B709F3D539b0c765937B804AC15
const ENS_LATEST_RESOLVER = {
  address: '0x03077e67a87a92471ef93339e153DfD255E59977',
  name: 'karawanken.eth'
}

const ENS2 = {
  address: '0xf9D6794F16CDbdC5b4873AEdeF4dC69d8D5edcaD',
  name: 'josh.eth'
}

const NO_DOMAINS_ADDRESS = '0x1b9B9813C5805A60184091956F8b36E752272a93'

const GNS_TEST = {
  address: '0xC04689227Fa24785609B1174698DBe481437f1A3',
  name: 'donnoh.gwei'
}

const makeStorage = (initial: Record<string, any> = {}) => {
  const store: Record<string, any> = { domainsCache: initial }
  return {
    get: jest.fn(async (key: string, def?: any) => (key in store ? store[key] : def)),
    set: jest.fn(async (key: string, value: any) => {
      store[key] = value
    })
  } as any
}
const makeFeatureFlags = (keepEnsProfilesUpToDate: boolean) =>
  ({
    isFeatureEnabled: (flag: string) =>
      flag === 'keepEnsProfilesUpToDate' ? keepEnsProfilesUpToDate : false
  }) as any
const mainnetProvider = () => getRpcProvider(networks.find((n) => n.chainId === 1n)!.rpcUrls, 1n)

describe('Domains', () => {
  // The TTL-based refresh tests below assume the "keep profiles up to date" mode.
  // Privacy mode (the default, no TTL refresh) is covered by its own tests.
  const domainsController = new DomainsController({
    providers,
    featureFlags: makeFeatureFlags(true)
  })

  it('should reverse lookup (ENS)', async () => {
    await domainsController.reverseLookup(ENS_OLDEST_RESOLVER.address)

    expect(domainsController.domains[ENS_OLDEST_RESOLVER.address]!.ens).toBe(
      ENS_OLDEST_RESOLVER.name
    )
  })
  it('should reverse lookup ENS with the latest resolver', async () => {
    await domainsController.reverseLookup(ENS_LATEST_RESOLVER.address)

    expect(domainsController.domains[ENS_LATEST_RESOLVER.address]!.ens).toBe(
      ENS_LATEST_RESOLVER.name
    )
  })
  it('should resolve domain', async () => {
    const { name, address } = ENS2

    await domainsController.resolveDomain({ domain: name })

    expect(domainsController.domainToAddresses[name]?.address).toBe(address)
    expect(domainsController.domainToAddresses[name]?.type).toBe('ens')
  })
  it(`reverse lookup should expire after ${
    PERSIST_DOMAIN_FOR_IN_MS / 1000 / 60
  } min, if the lookup succeeds (the happy case)`, async () => {
    const start = Date.now()
    const nowSpy = jest.spyOn(Date, 'now')
    nowSpy.mockReturnValue(start)

    const { address, name } = ENS2

    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address]!.ens).toBe(name)

    // 1 min before expiry
    nowSpy.mockReturnValue(start + PERSIST_DOMAIN_FOR_IN_MS - 60000)

    const previousUpdatedAt = domainsController.domains[address]!.updatedAt
    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address]!.updatedAt).toBe(previousUpdatedAt)

    // 1 min after expiry
    nowSpy.mockReturnValue(start + PERSIST_DOMAIN_FOR_IN_MS + 60000)

    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address]!.updatedAt).toBe(
      start + PERSIST_DOMAIN_FOR_IN_MS + 60000
    )

    nowSpy.mockRestore()
  })
  it(`reverse lookup should expire after ${
    PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS / 1000 / 60
  } min, if the last lookup had failed (the unhappy case)`, async () => {
    const { restore } = suppressConsole(true)
    const start = Date.now()
    const nowSpy = jest.spyOn(Date, 'now')
    nowSpy.mockReturnValue(start)

    const reverseLookupEnsSpy = jest
      .spyOn(ensDomainsModule, 'reverseLookupEns')
      .mockRejectedValue(new Error('forced failure'))

    const FAIL_ADDRESS = getAddress(ENS_OLD_RESOLVER.address)

    // Initial failed lookup sets updateFailedAt
    await domainsController.reverseLookup(FAIL_ADDRESS)
    const firstFailedAt = domainsController.domains[FAIL_ADDRESS]!.updateFailedAt
    expect(typeof firstFailedAt).toBe('number')

    // 1 min before failure-expiry -> no retry, timestamp unchanged
    nowSpy.mockReturnValue(start + PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS - 60000)
    await domainsController.reverseLookup(FAIL_ADDRESS)
    expect(domainsController.domains[FAIL_ADDRESS]!.updateFailedAt).toBe(firstFailedAt)

    // 1 min after failure-expiry -> retry, timestamp updated
    nowSpy.mockReturnValue(start + PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS + 60000)
    await domainsController.reverseLookup(FAIL_ADDRESS)
    expect(domainsController.domains[FAIL_ADDRESS]!.updateFailedAt).toBe(
      start + PERSIST_DOMAIN_FOR_FAILED_LOOKUP_IN_MS + 60000
    )

    reverseLookupEnsSpy.mockRestore()
    nowSpy.mockRestore()
    restore()
  })
  it('should NOT reverse lookup if already resolved', async () => {
    const { address } = ENS2

    const lastUpdatedAt = domainsController.domains[address]!.updatedAt
    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address]!.updatedAt).toBe(lastUpdatedAt)

    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address]!.updatedAt).toBe(lastUpdatedAt)
  })
  it('should set ens to null if no domain is found', async () => {
    await domainsController.reverseLookup(NO_DOMAINS_ADDRESS)

    expect(domainsController.domains[NO_DOMAINS_ADDRESS]!.ens).toBe(null)
  })
  it('should reverse multiple addresses and work with all resolvers', async () => {
    domainsController.domains = {}

    expect(Object.keys(domainsController.domains).length).toBe(0)

    await domainsController.batchReverseLookup([
      ENS_OLDEST_RESOLVER.address,
      ENS_OLD_RESOLVER.address,
      ENS_LATEST_RESOLVER.address
    ])

    expect(domainsController.domains[getAddress(ENS_OLDEST_RESOLVER.address)]!.ens).toBe(
      ENS_OLDEST_RESOLVER.name
    )
    expect(domainsController.domains[getAddress(ENS_OLD_RESOLVER.address)]!.ens).toBe(
      ENS_OLD_RESOLVER.name
    )
    expect(domainsController.domains[getAddress(ENS_LATEST_RESOLVER.address)]!.ens).toBe(
      ENS_LATEST_RESOLVER.name
    )
  })
  it('batchReverseLookup should use deployless batched reverse lookup', async () => {
    const provider = getRpcProvider(networks.find((n) => n.chainId === 1n)!.rpcUrls, 1n)
    const controller = new DomainsController({ providers: { ['1']: provider } })
    const reverseLookupEnsSpy = jest.spyOn(ensDomainsModule, 'reverseLookupEns')
    reverseLookupEnsSpy
      .mockResolvedValueOnce({
        [getAddress(ENS_OLDEST_RESOLVER.address)]: {
          name: ENS_OLDEST_RESOLVER.name,
          failed: false
        },
        [getAddress(ENS_OLD_RESOLVER.address)]: {
          name: ENS_OLD_RESOLVER.name,
          failed: false
        },
        [getAddress(ENS_LATEST_RESOLVER.address)]: {
          name: ENS_LATEST_RESOLVER.name,
          failed: false
        }
      })
      .mockResolvedValueOnce({})

    try {
      await controller.batchReverseLookup([
        ENS_OLDEST_RESOLVER.address,
        ENS_OLD_RESOLVER.address,
        ENS_LATEST_RESOLVER.address
      ])

      // One ENS lookup and one GNS lookup for the batch
      expect(reverseLookupEnsSpy).toHaveBeenCalledTimes(2)

      const firstCallArgs = reverseLookupEnsSpy.mock.calls[0]
      expect(firstCallArgs).toBeDefined()
      if (!firstCallArgs) throw new Error('Expected reverse lookup call args')

      expect(firstCallArgs[0]).toEqual([
        ENS_OLDEST_RESOLVER.address,
        ENS_OLD_RESOLVER.address,
        ENS_LATEST_RESOLVER.address
      ])
    } finally {
      reverseLookupEnsSpy.mockRestore()
    }
  })
  it('reverseLookup awaits an in-flight lookup instead of starting a duplicate', async () => {
    const provider = getRpcProvider(networks.find((n) => n.chainId === 1n)!.rpcUrls, 1n)
    const controller = new DomainsController({ providers: { ['1']: provider } })
    const address = getAddress(ENS_OLDEST_RESOLVER.address)

    let resolveLookup!: (value: ensDomainsModule.ReverseLookupResult) => void
    const deferred = new Promise<ensDomainsModule.ReverseLookupResult>((res) => {
      resolveLookup = res
    })
    const reverseLookupEnsSpy = jest
      .spyOn(ensDomainsModule, 'reverseLookupEns')
      .mockReturnValueOnce(deferred)
      // The GNS leg of the same lookup resolves immediately
      .mockResolvedValueOnce({})
    const getEnsAvatarSpy = jest.spyOn(ensDomainsModule, 'getEnsAvatar').mockResolvedValue(null)

    // First call starts the lookup; the second one is fired while the first is
    // still in flight and must await the same promise rather than duplicating it.
    const first = controller.reverseLookup(address)
    const second = controller.reverseLookup(address)

    expect(controller.domains[address]).toBeUndefined()

    resolveLookup({ [address]: { name: ENS_OLDEST_RESOLVER.name, failed: false } })

    await Promise.all([first, second])

    // A single underlying lookup per name service (ENS + GNS) despite two
    // reverseLookup calls, and both calls only resolved once the data was
    // written to state.
    expect(reverseLookupEnsSpy).toHaveBeenCalledTimes(2)
    expect(controller.domains[address]!.ens).toBe(ENS_OLDEST_RESOLVER.name)

    reverseLookupEnsSpy.mockRestore()
    getEnsAvatarSpy.mockRestore()
  })
  it('batchReverseLookup awaits an address already in flight from reverseLookup', async () => {
    const provider = getRpcProvider(networks.find((n) => n.chainId === 1n)!.rpcUrls, 1n)
    const controller = new DomainsController({ providers: { ['1']: provider } })
    const addressInFlight = getAddress(ENS_OLDEST_RESOLVER.address)
    const addressInBatch = getAddress(ENS_LATEST_RESOLVER.address)

    let resolveInFlight!: (value: ensDomainsModule.ReverseLookupResult) => void
    const deferred = new Promise<ensDomainsModule.ReverseLookupResult>((res) => {
      resolveInFlight = res
    })
    const reverseLookupEnsSpy = jest
      .spyOn(ensDomainsModule, 'reverseLookupEns')
      // First lookup (addressInFlight) stays pending until we resolve it
      .mockReturnValueOnce(deferred)
      // ...while its GNS leg resolves immediately
      .mockResolvedValueOnce({})
      // Batch lookup for the remaining address resolves immediately
      .mockResolvedValueOnce({
        [addressInBatch]: { name: ENS_LATEST_RESOLVER.name, failed: false }
      })
      .mockResolvedValueOnce({})
    const getEnsAvatarSpy = jest.spyOn(ensDomainsModule, 'getEnsAvatar').mockResolvedValue(null)

    const inFlight = controller.reverseLookup(addressInFlight)
    // The batch includes the already in-flight address; it must await that
    // existing promise rather than skip it or start a duplicate lookup.
    const batch = controller.batchReverseLookup([addressInFlight, addressInBatch])

    resolveInFlight({ [addressInFlight]: { name: ENS_OLDEST_RESOLVER.name, failed: false } })

    await Promise.all([inFlight, batch])

    expect(controller.domains[addressInFlight]!.ens).toBe(ENS_OLDEST_RESOLVER.name)
    expect(controller.domains[addressInBatch]!.ens).toBe(ENS_LATEST_RESOLVER.name)
    // One ENS + one GNS lookup for the in-flight address, and one pair for the
    // rest of the batch — no duplicate.
    expect(reverseLookupEnsSpy).toHaveBeenCalledTimes(4)

    reverseLookupEnsSpy.mockRestore()
    getEnsAvatarSpy.mockRestore()
  })
  it('marks the address as failed (updateFailedAt) when the lookup returns a failed entry', async () => {
    const { restore } = suppressConsole(true)
    const controller = new DomainsController({
      providers: { ['1']: getRpcProvider(networks.find((n) => n.chainId === 1n)!.rpcUrls, 1n) }
    })
    const reverseLookupEnsSpy = jest.spyOn(ensDomainsModule, 'reverseLookupEns')
    const FAILED_ADDRESS = getAddress(ENS2.address)

    // A failed chunk yields a resolved (not rejected) entry with `failed: true`; the controller
    // must treat it as a transient failure (set updateFailedAt) rather than caching "no name".
    reverseLookupEnsSpy.mockResolvedValueOnce({
      [FAILED_ADDRESS]: { name: null, failed: true }
    })

    await controller.reverseLookup(FAILED_ADDRESS)

    expect(typeof controller.domains[FAILED_ADDRESS]!.updateFailedAt).toBe('number')
    expect(controller.domains[FAILED_ADDRESS]!.ens).toBe(null)

    reverseLookupEnsSpy.mockRestore()
    restore()
  })
  it('should use the universal resolver contract', async () => {
    const UNIVERSAL_RESOLVER_TEST = {
      address: '0x2222222222222222222222222222222222222222',
      name: 'ur.integration-tests.eth'
    }

    await domainsController.resolveDomain({ domain: UNIVERSAL_RESOLVER_TEST.name })

    expect(domainsController.domainToAddresses[UNIVERSAL_RESOLVER_TEST.name]?.address).toBe(
      UNIVERSAL_RESOLVER_TEST.address
    )
    expect(domainsController.domainToAddresses[UNIVERSAL_RESOLVER_TEST.name]?.type).toBe('ens')
  })
  it('should support CCIP Read', async () => {
    const CCIP_READ_TEST = {
      address: '0x779981590E7Ccc0CFAe8040Ce7151324747cDb97',
      name: 'test.offchaindemo.eth'
    }

    await domainsController.resolveDomain({ domain: CCIP_READ_TEST.name })

    expect(domainsController.domainToAddresses[CCIP_READ_TEST.name]?.address).toBe(
      CCIP_READ_TEST.address
    )
  })
  it('should resolve .citrea domain on citrea network', async () => {
    const TEST = {
      address: getAddress('0x4f0b5579136f88135572010276c2a4a884729e7b'),
      name: 'nemo.citrea'
    }

    await domainsController.resolveDomain({ domain: TEST.name })

    expect(domainsController.domainToAddresses[TEST.name]?.address).toBe(TEST.address)
    expect(domainsController.domainToAddresses[TEST.name]?.type).toBe('namoshi')
    expect(domainsController.domains[TEST.address]!.namoshi).toBe(TEST.name)
  })
  it('should resolve .gwei domain (GNS) on ethereum', async () => {
    await domainsController.resolveDomain({ domain: GNS_TEST.name })

    expect(domainsController.domainToAddresses[GNS_TEST.name]?.address).toBe(GNS_TEST.address)
    expect(domainsController.domainToAddresses[GNS_TEST.name]?.type).toBe('gwei')
    expect(domainsController.domains[GNS_TEST.address]!.gwei).toBe(GNS_TEST.name)
  })
  it('should reverse lookup (GNS .gwei)', async () => {
    domainsController.domains = {}

    await domainsController.reverseLookup(GNS_TEST.address)

    expect(domainsController.domains[GNS_TEST.address]!.gwei).toBe(GNS_TEST.name)
    expect(domainsController.domainToAddresses[GNS_TEST.name]?.address).toBe(GNS_TEST.address)
    expect(domainsController.domainToAddresses[GNS_TEST.name]?.type).toBe('gwei')
  })
  it('should not resolve an unregistered .gwei domain', async () => {
    const UNREGISTERED_NAME = 'surely-not-registered-1x2y.gwei'

    await domainsController.resolveDomain({ domain: UNREGISTERED_NAME })

    expect(domainsController.domainToAddresses[UNREGISTERED_NAME]).toBeUndefined()
  })
  it('should set gwei to null if no domain is found', async () => {
    await domainsController.reverseLookup(NO_DOMAINS_ADDRESS)

    expect(domainsController.domains[NO_DOMAINS_ADDRESS]!.gwei).toBe(null)
  })

  it('privacy mode: a whenStale lookup refreshes once the cached value is older than the TTL', async () => {
    const controller = new DomainsController({
      providers: { ['1']: mainnetProvider() },
      storage: makeStorage(),
      featureFlags: makeFeatureFlags(false)
    })

    const address = getAddress(ENS_OLDEST_RESOLVER.address)
    const reverseLookupEnsSpy = jest
      .spyOn(ensDomainsModule, 'reverseLookupEns')
      .mockResolvedValue({ [address]: { name: ENS_OLDEST_RESOLVER.name, failed: false } })
    const getEnsAvatarSpy = jest.spyOn(ensDomainsModule, 'getEnsAvatar').mockResolvedValue(null)

    const start = Date.now()
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(start)

    await controller.reverseLookup(address)
    // Each refresh performs two lookups: ENS and GNS
    expect(reverseLookupEnsSpy).toHaveBeenCalledTimes(2)

    // Before the TTL even a whenStale lookup serves from cache.
    nowSpy.mockReturnValue(start + PERSIST_DOMAIN_FOR_IN_MS - 60000)
    await controller.reverseLookup(address, true, { privacyUpdateMode: 'whenStale' })
    expect(reverseLookupEnsSpy).toHaveBeenCalledTimes(2)

    // After the TTL a whenStale lookup refreshes.
    nowSpy.mockReturnValue(start + PERSIST_DOMAIN_FOR_IN_MS + 60000)
    await controller.reverseLookup(address, true, { privacyUpdateMode: 'whenStale' })
    expect(reverseLookupEnsSpy).toHaveBeenCalledTimes(4)

    nowSpy.mockRestore()
    reverseLookupEnsSpy.mockRestore()
    getEnsAvatarSpy.mockRestore()
  })

  it('opt-out (keepEnsProfilesUpToDate): passively refreshes after the TTL', async () => {
    const controller = new DomainsController({
      providers: { ['1']: mainnetProvider() },
      storage: makeStorage(),
      featureFlags: makeFeatureFlags(true)
    })

    const address = getAddress(ENS_OLDEST_RESOLVER.address)
    const reverseLookupEnsSpy = jest
      .spyOn(ensDomainsModule, 'reverseLookupEns')
      .mockResolvedValue({ [address]: { name: ENS_OLDEST_RESOLVER.name, failed: false } })
    const getEnsAvatarSpy = jest.spyOn(ensDomainsModule, 'getEnsAvatar').mockResolvedValue(null)

    const start = Date.now()
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(start)

    await controller.reverseLookup(address)
    // Each refresh performs two lookups: ENS and GNS
    expect(reverseLookupEnsSpy).toHaveBeenCalledTimes(2)

    // Passive lookup past the TTL refreshes
    nowSpy.mockReturnValue(start + PERSIST_DOMAIN_FOR_IN_MS + 60000)
    await controller.reverseLookup(address)
    expect(reverseLookupEnsSpy).toHaveBeenCalledTimes(4)

    nowSpy.mockRestore()
    reverseLookupEnsSpy.mockRestore()
    getEnsAvatarSpy.mockRestore()
  })

  it('persists resolved domains and hydrates them on load (skipping a re-lookup)', async () => {
    const storage = makeStorage()
    const address = getAddress(ENS_OLDEST_RESOLVER.address)
    const reverseLookupEnsSpy = jest
      .spyOn(ensDomainsModule, 'reverseLookupEns')
      .mockResolvedValue({ [address]: { name: ENS_OLDEST_RESOLVER.name, failed: false } })
    const getEnsAvatarSpy = jest.spyOn(ensDomainsModule, 'getEnsAvatar').mockResolvedValue(null)

    const first = new DomainsController({
      providers: { ['1']: mainnetProvider() },
      storage,
      featureFlags: makeFeatureFlags(false)
    })
    await first.reverseLookup(address)

    expect(storage.set).toHaveBeenCalledWith(
      'domainsCache',
      expect.objectContaining({
        [address]: expect.objectContaining({ ens: ENS_OLDEST_RESOLVER.name })
      })
    )

    // A fresh controller backed by the same storage hydrates the cache and, in
    // privacy mode, does not look the address up again.
    const second = new DomainsController({
      providers: { ['1']: mainnetProvider() },
      storage,
      featureFlags: makeFeatureFlags(false)
    })

    await second.init([
      {
        name: 'test',
        address: ENS_OLDEST_RESOLVER.address,
        isWalletAccount: true
      }
    ])
    expect(second.domains[address]!.ens).toBe(ENS_OLDEST_RESOLVER.name)

    const callsBefore = reverseLookupEnsSpy.mock.calls.length
    await second.reverseLookup(address)
    expect(reverseLookupEnsSpy.mock.calls.length).toBe(callsBefore)

    reverseLookupEnsSpy.mockRestore()
    getEnsAvatarSpy.mockRestore()
  })

  it('removes resolved domains from storage that are not in the wallet and the address book', async () => {
    const storage = makeStorage({
      [ENS_OLDEST_RESOLVER.address]: {
        ens: ENS_OLDEST_RESOLVER.name,
        updatedAt: Date.now()
      },
      [ENS_OLD_RESOLVER.address]: {
        ens: ENS_OLD_RESOLVER.name,
        updatedAt: Date.now()
      }
    })

    const controller = new DomainsController({
      providers: { ['1']: mainnetProvider() },
      storage,
      featureFlags: makeFeatureFlags(false)
    })

    await controller.init([
      {
        name: 'test',
        address: ENS_OLDEST_RESOLVER.address,
        isWalletAccount: true
      }
    ])

    expect(controller.domains[ENS_OLDEST_RESOLVER.address]!.ens).toBe(ENS_OLDEST_RESOLVER.name)
    expect(controller.domains[ENS_OLD_RESOLVER.address]).toBeUndefined()
  })

  it('controller works without a citrea provider', async () => {
    const controllerWithoutCitrea = new DomainsController({
      providers: {
        ['1']: getRpcProvider(networks.find((n) => n.chainId === 1n)!.rpcUrls, 1n)
      }
    })

    const TEST = {
      address: getAddress('0x4f0b5579136f88135572010276c2a4a884729e7b'),
      name: 'nemo.citrea'
    }

    await controllerWithoutCitrea.resolveDomain({ domain: TEST.name })

    expect(controllerWithoutCitrea.domains[TEST.address]).toBeUndefined()
  })
})
