import { getAddress } from 'ethers'

import { expect, jest } from '@jest/globals'

import { suppressConsole } from '../../../test/helpers/console'
import { networks } from '../../consts/networks'
// Must match the direct-file import used in domains.ts (not the barrel) — jest.spyOn
// can't intercept calls through a different module instance, and tslib 2's `export *`
// getter-only bindings make the barrel un-spyable anyway.
import * as ensDomainsModule from '../../services/ensDomains/ensDomains'
import { Network } from '../../interfaces/network'
import { NameResolver, NameServiceId } from '../../services/nameResolvers'
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

const GNS_TEST = {
  address: '0xC04689227Fa24785609B1174698DBe481437f1A3',
  name: 'donnoh.gwei'
}

const NO_DOMAINS_ADDRESS = '0x1b9B9813C5805A60184091956F8b36E752272a93'

const makeStorage = (initial: Record<string, any> = {}) => {
  const store: Record<string, any> = { domainsCache: initial }
  return {
    get: jest.fn(async (key: string, def?: any) => (key in store ? store[key] : def)),
    set: jest.fn(async (key: string, value: any) => {
      store[key] = value
    })
  } as any
}
// Only `keepEnsProfilesUpToDate` varies per test; the per-service flags (namoshiDomains,
// gnsDomains) default to enabled
const makeFeatureFlags = (keepEnsProfilesUpToDate: boolean) =>
  ({
    isFeatureEnabled: (flag: string) =>
      flag === 'keepEnsProfilesUpToDate' ? keepEnsProfilesUpToDate : true
  }) as any
const mainnetProvider = () => getRpcProvider(networks.find((n) => n.chainId === 1n)!.rpcUrls, 1n)

const allNetworksEnabled = (chainId: bigint): Network =>
  ({ chainId, name: `chain-${chainId}`, disabled: false }) as Network

describe('Domains', () => {
  // The TTL-based refresh tests below assume the "keep profiles up to date" mode.
  // Privacy mode (the default, no TTL refresh) is covered by its own tests.
  const domainsController = new DomainsController({
    providers,
    featureFlags: makeFeatureFlags(true),
    getNetwork: allNetworksEnabled
  })

  it('should reverse lookup (ENS)', async () => {
    await domainsController.reverseLookup(ENS_OLDEST_RESOLVER.address)

    expect(domainsController.domains[ENS_OLDEST_RESOLVER.address]!.names.ens).toBe(
      ENS_OLDEST_RESOLVER.name
    )
  })
  it('should reverse lookup ENS with the latest resolver', async () => {
    await domainsController.reverseLookup(ENS_LATEST_RESOLVER.address)

    expect(domainsController.domains[ENS_LATEST_RESOLVER.address]!.names.ens).toBe(
      ENS_LATEST_RESOLVER.name
    )
  })
  it('should resolve domain', async () => {
    const { name, address } = ENS2

    await domainsController.resolveDomain({ domain: name })

    expect(domainsController.domainToAddresses[name]?.address).toBe(address)
    expect(domainsController.domainToAddresses[name]?.type).toBe('ens')
  })
  it('should fail Colibri verification for a changed ENS address and succeed for the resolved address', async () => {
    const domain = '0xbobby.eth'
    const resolvedAddress = getAddress('0x4ba5250000000000000000000000000003bc63d4')
    const changedAddress = getAddress('0x0000000000000000000000000000000000000001')
    const provider = {} as any
    const verificationProvider = {} as any
    const getReadyProvider = jest.fn(() => undefined as any)
    const { restore } = suppressConsole()
    const controller = new DomainsController({
      providers: { ['1']: provider },
      verification: { getReadyProvider } as any,
      getNetwork: allNetworksEnabled
    })
    // The ENS resolver runs both the RPC resolve and the Colibri verification through
    // `resolveENSDomain`, so this single spy stands in for both, distinguished by which
    // provider instance it was called with (regular RPC vs. Colibri's verification provider).
    const resolveENSDomainSpy = jest
      .spyOn(ensDomainsModule, 'resolveENSDomain')
      .mockImplementation(
        async ({
          provider: usedProvider
        }: Parameters<typeof ensDomainsModule.resolveENSDomain>[0]) =>
          usedProvider === verificationProvider
            ? { address: resolvedAddress, avatar: null, expiry: null }
            : { address: changedAddress, avatar: null, expiry: null }
      )

    try {
      // No verifier ready yet: resolves via RPC only (changedAddress), nothing to compare against.
      await controller.resolveDomain({ domain })

      expect(controller.domainToAddresses[domain]?.address).toBe(changedAddress)
      expect(controller.verifiedDomainsStatus[domain]).toBeUndefined()

      // A Colibri verifier becomes ready; its resolution (resolvedAddress) now disagrees with RPC.
      getReadyProvider.mockReturnValue(verificationProvider)

      await controller.resolveDomain({ domain })

      expect(controller.resolveDomainsStatus[domain]).toBeUndefined()
      expect(controller.resolveDomainsErrors[domain]).toBe(
        `ENS resolution mismatch for ${domain}: RPC returned ${changedAddress}, Colibri returned ${resolvedAddress}`
      )
      expect(controller.verifiedDomainsStatus[domain]).toBeUndefined()

      resolveENSDomainSpy.mockResolvedValue({
        address: resolvedAddress,
        avatar: null,
        expiry: null
      })

      await controller.resolveDomain({ domain })

      expect(controller.resolveDomainsStatus[domain]).toBeUndefined()
      expect(controller.resolveDomainsErrors[domain]).toBeUndefined()
      expect(controller.verifiedDomainsStatus[domain]).toBe('VERIFIED')

      getReadyProvider.mockReturnValue(undefined as any)

      await controller.resolveDomain({ domain })

      expect(controller.resolveDomainsStatus[domain]).toBeUndefined()
      expect(controller.resolveDomainsErrors[domain]).toBeUndefined()
      expect(controller.verifiedDomainsStatus[domain]).toBeUndefined()
    } finally {
      resolveENSDomainSpy.mockRestore()
      restore()
    }
  })
  it('resolveDomain always re-resolves fresh instead of short-circuiting off a cached domainToAddresses entry', async () => {
    // Regression guard: resolveDomain must never reuse `domainToAddresses[domain]` to skip a fresh
    // resolver call.
    // https://docs.ens.domains/web/design#other-guidelines-and-tips
    const domain = 'reassigned-owner.eth'
    const firstAddress = getAddress('0x1111111111111111111111111111111111111111')
    const secondAddress = getAddress('0x2222222222222222222222222222222222222222')
    const controller = new DomainsController({
      providers: { ['1']: mainnetProvider() },
      getNetwork: allNetworksEnabled
    })
    const resolveENSDomainSpy = jest
      .spyOn(ensDomainsModule, 'resolveENSDomain')
      .mockResolvedValueOnce({ address: firstAddress, avatar: null, expiry: null })
      .mockResolvedValueOnce({ address: secondAddress, avatar: null, expiry: null })

    try {
      await controller.resolveDomain({ domain })
      expect(controller.domainToAddresses[domain]?.address).toBe(firstAddress)

      // The domain now resolves to a different address; a second resolveDomain call must pick it up.
      await controller.resolveDomain({ domain })

      expect(resolveENSDomainSpy).toHaveBeenCalledTimes(2)
      expect(controller.domainToAddresses[domain]?.address).toBe(secondAddress)
    } finally {
      resolveENSDomainSpy.mockRestore()
    }
  })
  it('verifies a GNS (.gwei) name through Colibri, since it resolves on Ethereum mainnet', async () => {
    const { name } = GNS_TEST
    const resolvedAddress = getAddress('0x4ba5250000000000000000000000000003bc63d4')
    // Colibri proves Ethereum mainnet state, so a GNS name (chain 1) gets a ready verifier for free.
    const getReadyProvider = jest.fn((chainId: bigint) => (chainId === 1n ? ({} as any) : null))
    const controller = new DomainsController({
      providers: { ['1']: {} as any },
      verification: { getReadyProvider } as any,
      featureFlags: makeFeatureFlags(true),
      getNetwork: allNetworksEnabled
    })
    const resolveENSDomainSpy = jest
      .spyOn(ensDomainsModule, 'resolveENSDomain')
      .mockResolvedValue({ address: resolvedAddress, avatar: null, expiry: null })

    try {
      await controller.resolveDomain({ domain: name })

      expect(controller.domainToAddresses[name]?.type).toBe('gns')
      expect(controller.domainToAddresses[name]?.address).toBe(resolvedAddress)
      expect(controller.resolveDomainsErrors[name]).toBeUndefined()
      expect(controller.verifiedDomainsStatus[name]).toBe('VERIFIED')
    } finally {
      resolveENSDomainSpy.mockRestore()
    }
  })
  it('resolves a Namoshi (.citrea) name but skips verification (no Colibri verifier on Citrea)', async () => {
    const name = 'nemo.citrea'
    const resolvedAddress = getAddress('0x4f0b5579136f88135572010276c2a4a884729e7b')
    // A verifier is ready for Ethereum but not for Citrea (4114), so Namoshi can't be verified.
    const getReadyProvider = jest.fn((chainId: bigint) => (chainId === 1n ? ({} as any) : null))
    const controller = new DomainsController({
      providers: { ['1']: {} as any, ['4114']: {} as any },
      verification: { getReadyProvider } as any,
      featureFlags: makeFeatureFlags(true),
      getNetwork: allNetworksEnabled
    })
    const resolveENSDomainSpy = jest
      .spyOn(ensDomainsModule, 'resolveENSDomain')
      .mockResolvedValue({ address: resolvedAddress, avatar: null, expiry: null })

    try {
      await controller.resolveDomain({ domain: name })

      expect(controller.domainToAddresses[name]?.type).toBe('namoshi')
      expect(controller.domainToAddresses[name]?.address).toBe(resolvedAddress)
      expect(controller.resolveDomainsErrors[name]).toBeUndefined()
      expect(controller.verifiedDomainsStatus[name]).toBeUndefined()
    } finally {
      resolveENSDomainSpy.mockRestore()
    }
  })
  it(`reverse lookup should expire after ${
    PERSIST_DOMAIN_FOR_IN_MS / 1000 / 60
  } min, if the lookup succeeds (the happy case)`, async () => {
    const start = Date.now()
    const nowSpy = jest.spyOn(Date, 'now')
    nowSpy.mockReturnValue(start)

    const { address, name } = ENS2

    await domainsController.reverseLookup(address)
    expect(domainsController.domains[address]!.names.ens).toBe(name)

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

    // Fail every service call so the address is flagged as a transient failure.
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

    expect(domainsController.domains[NO_DOMAINS_ADDRESS]!.names.ens).toBe(null)
  })
  it('should reverse multiple addresses and work with all resolvers', async () => {
    domainsController.domains = {}

    expect(Object.keys(domainsController.domains).length).toBe(0)

    await domainsController.batchReverseLookup([
      ENS_OLDEST_RESOLVER.address,
      ENS_OLD_RESOLVER.address,
      ENS_LATEST_RESOLVER.address
    ])

    expect(domainsController.domains[getAddress(ENS_OLDEST_RESOLVER.address)]!.names.ens).toBe(
      ENS_OLDEST_RESOLVER.name
    )
    expect(domainsController.domains[getAddress(ENS_OLD_RESOLVER.address)]!.names.ens).toBe(
      ENS_OLD_RESOLVER.name
    )
    expect(domainsController.domains[getAddress(ENS_LATEST_RESOLVER.address)]!.names.ens).toBe(
      ENS_LATEST_RESOLVER.name
    )
  })
  it('batchReverseLookup should use deployless batched reverse lookup', async () => {
    const provider = getRpcProvider(networks.find((n) => n.chainId === 1n)!.rpcUrls, 1n)
    const controller = new DomainsController({
      providers: { ['1']: provider },
      getNetwork: allNetworksEnabled
    })
    const reverseLookupEnsSpy = jest.spyOn(ensDomainsModule, 'reverseLookupEns')
    // ENS and GNS both run on Ethereum, so the batch performs two lookups (ENS then GNS); Namoshi is
    // skipped because there is no Citrea provider.
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
    const controller = new DomainsController({
      providers: { ['1']: provider },
      getNetwork: allNetworksEnabled
    })
    const address = getAddress(ENS_OLDEST_RESOLVER.address)

    let resolveLookup!: (value: ensDomainsModule.ReverseLookupResult) => void
    const deferred = new Promise<ensDomainsModule.ReverseLookupResult>((res) => {
      resolveLookup = res
    })
    const reverseLookupEnsSpy = jest
      .spyOn(ensDomainsModule, 'reverseLookupEns')
      // The ENS call stays pending; the GNS call (same Ethereum provider) resolves immediately.
      .mockReturnValueOnce(deferred)
      .mockResolvedValueOnce({})
    const getEnsAvatarSpy = jest.spyOn(ensDomainsModule, 'getEnsAvatar').mockResolvedValue(null)

    // First call starts the lookup; the second one is fired while the first is
    // still in flight and must await the same promise rather than duplicating it.
    const first = controller.reverseLookup(address)
    const second = controller.reverseLookup(address)

    expect(controller.domains[address]).toBeUndefined()

    resolveLookup({ [address]: { name: ENS_OLDEST_RESOLVER.name, failed: false } })

    await Promise.all([first, second])

    // A single underlying lookup per service (ENS + GNS) despite two reverseLookup calls, and both
    // calls only resolved once the data was written to state.
    expect(reverseLookupEnsSpy).toHaveBeenCalledTimes(2)
    expect(controller.domains[address]!.names.ens).toBe(ENS_OLDEST_RESOLVER.name)

    reverseLookupEnsSpy.mockRestore()
    getEnsAvatarSpy.mockRestore()
  })
  it('batchReverseLookup awaits an address already in flight from reverseLookup', async () => {
    const provider = getRpcProvider(networks.find((n) => n.chainId === 1n)!.rpcUrls, 1n)
    const controller = new DomainsController({
      providers: { ['1']: provider },
      getNetwork: allNetworksEnabled
    })
    const addressInFlight = getAddress(ENS_OLDEST_RESOLVER.address)
    const addressInBatch = getAddress(ENS_LATEST_RESOLVER.address)

    let resolveInFlight!: (value: ensDomainsModule.ReverseLookupResult) => void
    const deferred = new Promise<ensDomainsModule.ReverseLookupResult>((res) => {
      resolveInFlight = res
    })
    const reverseLookupEnsSpy = jest
      .spyOn(ensDomainsModule, 'reverseLookupEns')
      // First lookup (addressInFlight): ENS call pending, its GNS call resolves immediately.
      .mockReturnValueOnce(deferred)
      .mockResolvedValueOnce({})
      // Batch lookup for the remaining address: ENS then GNS.
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

    expect(controller.domains[addressInFlight]!.names.ens).toBe(ENS_OLDEST_RESOLVER.name)
    expect(controller.domains[addressInBatch]!.names.ens).toBe(ENS_LATEST_RESOLVER.name)
    // One ENS + one GNS lookup for the in-flight address, and one pair for the rest of the batch -
    // no duplicate.
    expect(reverseLookupEnsSpy).toHaveBeenCalledTimes(4)

    reverseLookupEnsSpy.mockRestore()
    getEnsAvatarSpy.mockRestore()
  })
  it('marks the address as failed (updateFailedAt) when the lookup returns a failed entry', async () => {
    const { restore } = suppressConsole(true)
    const controller = new DomainsController({
      providers: { ['1']: getRpcProvider(networks.find((n) => n.chainId === 1n)!.rpcUrls, 1n) },
      getNetwork: allNetworksEnabled
    })
    const reverseLookupEnsSpy = jest.spyOn(ensDomainsModule, 'reverseLookupEns')
    const FAILED_ADDRESS = getAddress(ENS2.address)

    // A failed chunk yields a resolved (not rejected) entry with `failed: true`; the controller
    // must treat it as a transient failure (set updateFailedAt) rather than caching "no name".
    reverseLookupEnsSpy.mockResolvedValue({
      [FAILED_ADDRESS]: { name: null, failed: true }
    })

    await controller.reverseLookup(FAILED_ADDRESS)

    expect(typeof controller.domains[FAILED_ADDRESS]!.updateFailedAt).toBe('number')
    expect(controller.domains[FAILED_ADDRESS]!.names.ens).toBeUndefined()

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
    expect(domainsController.domains[TEST.address]!.names.namoshi).toBe(TEST.name)
  })
  it('should resolve .gwei domain (GNS) on ethereum', async () => {
    await domainsController.resolveDomain({ domain: GNS_TEST.name })

    expect(domainsController.domainToAddresses[GNS_TEST.name]?.address).toBe(GNS_TEST.address)
    expect(domainsController.domainToAddresses[GNS_TEST.name]?.type).toBe('gns')
    expect(domainsController.domains[GNS_TEST.address]!.names.gns).toBe(GNS_TEST.name)
  })
  it('should reverse lookup (GNS .gwei)', async () => {
    domainsController.domains = {}

    await domainsController.reverseLookup(GNS_TEST.address)

    expect(domainsController.domains[GNS_TEST.address]!.names.gns).toBe(GNS_TEST.name)
    expect(domainsController.domainToAddresses[GNS_TEST.name]?.address).toBe(GNS_TEST.address)
    expect(domainsController.domainToAddresses[GNS_TEST.name]?.type).toBe('gns')
  })
  it('should not resolve an unregistered .gwei domain', async () => {
    const UNREGISTERED_NAME = 'surely-not-registered-1x2y.gwei'

    await domainsController.resolveDomain({ domain: UNREGISTERED_NAME })

    expect(domainsController.domainToAddresses[UNREGISTERED_NAME]).toBeUndefined()
  })
  it('should set gwei to null if no domain is found', async () => {
    await domainsController.reverseLookup(NO_DOMAINS_ADDRESS)

    expect(domainsController.domains[NO_DOMAINS_ADDRESS]!.names.gns).toBe(null)
  })

  it('does not resolve a service disabled by a feature flag', async () => {
    const { restore } = suppressConsole(true)
    const controller = new DomainsController({
      providers: { ['1']: mainnetProvider() },
      featureFlags: { isFeatureEnabled: (flag: string) => flag !== 'gnsDomains' } as any,
      getNetwork: allNetworksEnabled
    })
    const reverseLookupEnsSpy = jest
      .spyOn(ensDomainsModule, 'reverseLookupEns')
      .mockResolvedValue({})

    // Reverse: with GNS disabled and no Citrea provider, only ENS is fetched.
    await controller.reverseLookup(GNS_TEST.address)
    expect(reverseLookupEnsSpy).toHaveBeenCalledTimes(1)

    reverseLookupEnsSpy.mockRestore()
    restore()
  })

  it('emits a FAILED status (instead of hanging) when no resolver owns the domain', async () => {
    // A resolver set without a fallback is the only way `matchNameResolver` returns nothing; the
    // default set always has ENS as the fallback. The UI resolves the caller's promise off this
    // status, so it must be emitted rather than silently returned.
    const controller = new DomainsController({
      providers: { ['1']: mainnetProvider() },
      resolvers: [],
      getNetwork: allNetworksEnabled
    })

    const domain = 'orphan.eth'
    const emittedStatuses: (string | undefined)[] = []
    const unsubscribe = controller.onUpdate(() => {
      emittedStatuses.push(controller.resolveDomainsStatus[domain])
    })

    await controller.resolveDomain({ domain })

    expect(emittedStatuses).toContain('FAILED')
    // The in-memory status is reset afterwards so a later retry can run.
    expect(controller.resolveDomainsStatus[domain]).toBeUndefined()

    unsubscribe()
  })

  it('privacy mode: a whenStale lookup refreshes once the cached value is older than the TTL', async () => {
    const controller = new DomainsController({
      providers: { ['1']: mainnetProvider() },
      storage: makeStorage(),
      featureFlags: makeFeatureFlags(false),
      getNetwork: allNetworksEnabled
    })

    const address = getAddress(ENS_OLDEST_RESOLVER.address)
    const reverseLookupEnsSpy = jest
      .spyOn(ensDomainsModule, 'reverseLookupEns')
      .mockResolvedValue({ [address]: { name: ENS_OLDEST_RESOLVER.name, failed: false } })
    const getEnsAvatarSpy = jest.spyOn(ensDomainsModule, 'getEnsAvatar').mockResolvedValue(null)

    const start = Date.now()
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(start)

    // Each refresh performs two Ethereum lookups: ENS and GNS.
    await controller.reverseLookup(address)
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
      featureFlags: makeFeatureFlags(true),
      getNetwork: allNetworksEnabled
    })

    const address = getAddress(ENS_OLDEST_RESOLVER.address)
    const reverseLookupEnsSpy = jest
      .spyOn(ensDomainsModule, 'reverseLookupEns')
      .mockResolvedValue({ [address]: { name: ENS_OLDEST_RESOLVER.name, failed: false } })
    const getEnsAvatarSpy = jest.spyOn(ensDomainsModule, 'getEnsAvatar').mockResolvedValue(null)

    const start = Date.now()
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(start)

    // Each refresh performs two Ethereum lookups: ENS and GNS.
    await controller.reverseLookup(address)
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
      featureFlags: makeFeatureFlags(false),
      getNetwork: allNetworksEnabled
    })
    await first.reverseLookup(address)

    expect(storage.set).toHaveBeenCalledWith(
      'domainsCache',
      expect.objectContaining({
        [address]: expect.objectContaining({
          names: expect.objectContaining({ ens: ENS_OLDEST_RESOLVER.name })
        })
      })
    )

    // A fresh controller backed by the same storage hydrates the cache and, in
    // privacy mode, does not look the address up again.
    const second = new DomainsController({
      providers: { ['1']: mainnetProvider() },
      storage,
      featureFlags: makeFeatureFlags(false),
      getNetwork: allNetworksEnabled
    })

    await second.init([
      {
        name: 'test',
        address: ENS_OLDEST_RESOLVER.address,
        isWalletAccount: true
      }
    ])
    expect(second.domains[address]!.names.ens).toBe(ENS_OLDEST_RESOLVER.name)

    const callsBefore = reverseLookupEnsSpy.mock.calls.length
    await second.reverseLookup(address)
    expect(reverseLookupEnsSpy.mock.calls.length).toBe(callsBefore)

    reverseLookupEnsSpy.mockRestore()
    getEnsAvatarSpy.mockRestore()
  })

  it('removes resolved domains from storage that are not in the wallet and the address book', async () => {
    const storage = makeStorage({
      [ENS_OLDEST_RESOLVER.address]: {
        names: { ens: ENS_OLDEST_RESOLVER.name },
        updatedAt: Date.now()
      },
      [ENS_OLD_RESOLVER.address]: {
        names: { ens: ENS_OLD_RESOLVER.name },
        updatedAt: Date.now()
      }
    })

    const controller = new DomainsController({
      providers: { ['1']: mainnetProvider() },
      storage,
      featureFlags: makeFeatureFlags(false),
      getNetwork: allNetworksEnabled
    })

    await controller.init([
      {
        name: 'test',
        address: ENS_OLDEST_RESOLVER.address,
        isWalletAccount: true
      }
    ])

    expect(controller.domains[ENS_OLDEST_RESOLVER.address]!.names.ens).toBe(
      ENS_OLDEST_RESOLVER.name
    )
    expect(controller.domains[ENS_OLD_RESOLVER.address]).toBeUndefined()
  })

  it('removes resolved domains from storage that are past the grace period of the ENS expiry', async () => {
    const storage = makeStorage({
      [ENS_OLDEST_RESOLVER.address]: {
        names: { ens: ENS_OLDEST_RESOLVER.name },
        updatedAt: Date.now(),
        expiry: {
          expiresAt: Date.now() - 1000,
          gracePeriodEndsAt: Date.now() - 1000,
          updatedAt: Date.now()
        }
      }
    })

    const controller = new DomainsController({
      providers: { ['1']: mainnetProvider() },
      storage,
      featureFlags: makeFeatureFlags(false),
      getNetwork: allNetworksEnabled
    })

    await controller.init([
      {
        name: 'test',
        address: ENS_OLDEST_RESOLVER.address,
        isWalletAccount: true
      }
    ])

    expect(controller.domains[ENS_OLDEST_RESOLVER.address]).toEqual({ names: { ens: null } })
  })

  it('controller works without a citrea provider', async () => {
    const controllerWithoutCitrea = new DomainsController({
      providers: {
        ['1']: getRpcProvider(networks.find((n) => n.chainId === 1n)!.rpcUrls, 1n)
      },
      getNetwork: allNetworksEnabled
    })

    const TEST = {
      address: getAddress('0x4f0b5579136f88135572010276c2a4a884729e7b'),
      name: 'nemo.citrea'
    }

    await controllerWithoutCitrea.resolveDomain({ domain: TEST.name })

    expect(controllerWithoutCitrea.domains[TEST.address]).toBeUndefined()
  })

  it('fails a domain resolution with an actionable error when the owning network is disabled', async () => {
    const { restore } = suppressConsole()
    const controller = new DomainsController({
      providers,
      getNetwork: (chainId: bigint) =>
        chainId === citrea.chainId
          ? ({ ...citrea, disabled: true } as unknown as Network)
          : allNetworksEnabled(chainId)
    })

    const domain = 'nemo.citrea'
    await controller.resolveDomain({ domain })

    expect(controller.resolveDomainsErrors[domain]).toBe(
      'Citrea Mainnet is disabled. Enable it to resolve Namoshi domains.'
    )
    // Nothing is cached, so a later resolve retries once the network is enabled.
    expect(controller.domainToAddresses[domain]).toBeUndefined()

    restore()
  })

  it('skips a service whose network is disabled during reverse lookup, without failing the batch', async () => {
    const address = getAddress('0x1234567890123456789012345678901234567890')

    const makeFakeResolver = (
      id: NameServiceId,
      requiredChainId: string,
      reverse: NameResolver['reverse']
    ): NameResolver => ({
      id,
      label: id,
      capabilities: { reverse: true, avatar: false, expiry: false },
      matches: () => false,
      resolve: async () => null,
      reverse,
      getAvatar: async () => null,
      requiredChainId: () => requiredChainId
    })

    const enabledReverse = jest.fn(async () => ({
      [address]: { name: 'alice.eth', failed: false }
    })) as unknown as NameResolver['reverse']
    const disabledReverse = jest.fn(async () => ({
      [address]: { name: null, failed: true }
    })) as unknown as NameResolver['reverse']

    const controller = new DomainsController({
      providers,
      resolvers: [
        makeFakeResolver('ens', '1', enabledReverse),
        makeFakeResolver('namoshi', String(citrea.chainId), disabledReverse)
      ],
      getNetwork: (chainId: bigint) =>
        chainId === citrea.chainId
          ? ({ ...citrea, disabled: true } as unknown as Network)
          : allNetworksEnabled(chainId)
    })

    await controller.reverseLookup(address)

    expect(enabledReverse).toHaveBeenCalledTimes(1)
    // The disabled service is dropped, so its batch never runs and can't mark the address failed.
    expect(disabledReverse).not.toHaveBeenCalled()
    expect(controller.domains[address]!.names.ens).toBe('alice.eth')
  })
})

describe('Domains - ENS expiry', () => {
  const ADDR = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'

  // Far-future expiry, so the name is nowhere near the warn window (no refetch is triggered by it).
  const EXPIRES_AT = new Date('2030-04-20T00:00:00Z').getTime()
  const GRACE_PERIOD_ENDS_AT = EXPIRES_AT + 90 * 24 * 60 * 60 * 1000

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // The expiry is fetched during a reverse lookup (when `updateExpiry` is set) and only for an address
  // that already has an entry. Seed a stale entry (past the name TTL) so the lookup re-runs and the
  // entry exists when the expiry fetch is attempted - mirroring how the selected account is refreshed.
  const seedStaleEntry = (expiry?: ensDomainsModule.NameExpiry) =>
    makeStorage({
      [ADDR]: {
        names: { ens: 'vitalik.eth', namoshi: null },
        updatedAt: Date.now() - PERSIST_DOMAIN_FOR_IN_MS - 1000,
        ...(expiry ? { expiry } : {})
      }
    })

  const makeController = (storage: any) =>
    new DomainsController({
      providers: { ['1']: mainnetProvider() },
      storage,
      featureFlags: makeFeatureFlags(true),
      getNetwork: allNetworksEnabled
    })

  it('fetches and stores the ENS expiry on a reverse lookup with updateExpiry', async () => {
    jest
      .spyOn(ensDomainsModule, 'reverseLookupEns')
      .mockResolvedValue({ [ADDR]: { name: 'vitalik.eth', failed: false } })
    jest.spyOn(ensDomainsModule, 'getEnsAvatar').mockResolvedValue(null)
    const expiry = {
      expiresAt: EXPIRES_AT,
      gracePeriodEndsAt: GRACE_PERIOD_ENDS_AT,
      updatedAt: Date.now()
    }
    jest.spyOn(ensDomainsModule, 'getEnsExpiry').mockResolvedValue(expiry)

    const controller = makeController(seedStaleEntry())
    await controller.reverseLookup(ADDR, true, {
      privacyUpdateMode: 'whenStale',
      updateExpiry: true
    })

    expect(controller.domains[ADDR]!.expiry).toEqual(expiry)
  })

  it('stores the ENS expiry fetched during a forward resolveDomain', async () => {
    const expiry = {
      expiresAt: EXPIRES_AT,
      gracePeriodEndsAt: GRACE_PERIOD_ENDS_AT,
      updatedAt: Date.now()
    }
    jest
      .spyOn(ensDomainsModule, 'resolveENSDomain')
      .mockResolvedValue({ address: ADDR, avatar: null, expiry })

    const controller = makeController(makeStorage({}))
    await controller.resolveDomain({ domain: 'vitalik.eth' })

    expect(controller.domains[ADDR]!.expiry).toEqual(expiry)
  })

  it('does not refetch the expiry when a fresh one is already cached', async () => {
    jest
      .spyOn(ensDomainsModule, 'reverseLookupEns')
      .mockResolvedValue({ [ADDR]: { name: 'vitalik.eth', failed: false } })
    jest.spyOn(ensDomainsModule, 'getEnsAvatar').mockResolvedValue(null)
    const getEnsExpirySpy = jest.spyOn(ensDomainsModule, 'getEnsExpiry')

    // Cached expiry: far from the deadline and freshly fetched, so a refetch must NOT happen.
    const cachedExpiry = {
      expiresAt: EXPIRES_AT,
      gracePeriodEndsAt: GRACE_PERIOD_ENDS_AT,
      updatedAt: Date.now()
    }
    const controller = makeController(seedStaleEntry(cachedExpiry))

    await controller.init([
      {
        name: 'test',
        address: ADDR,
        isWalletAccount: true
      }
    ])

    await controller.reverseLookup(ADDR, true, {
      privacyUpdateMode: 'whenStale',
      updateExpiry: true
    })

    expect(getEnsExpirySpy).not.toHaveBeenCalled()
    expect(controller.domains[ADDR]!.expiry).toEqual(cachedExpiry)
  })

  it('does not fetch the expiry when updateExpiry is not requested', async () => {
    jest
      .spyOn(ensDomainsModule, 'reverseLookupEns')
      .mockResolvedValue({ [ADDR]: { name: 'vitalik.eth', failed: false } })
    jest.spyOn(ensDomainsModule, 'getEnsAvatar').mockResolvedValue(null)
    const getEnsExpirySpy = jest.spyOn(ensDomainsModule, 'getEnsExpiry')

    const controller = makeController(seedStaleEntry())
    await controller.reverseLookup(ADDR, true, { privacyUpdateMode: 'whenStale' })

    expect(getEnsExpirySpy).not.toHaveBeenCalled()
    expect(controller.domains[ADDR]!.expiry).toBeUndefined()
  })
})
