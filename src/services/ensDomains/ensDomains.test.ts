import { labelhash, namehash } from 'viem'
import * as viemEnsModule from 'viem/ens'
import { normalize } from 'viem/ens'

import { expect, jest } from '@jest/globals'

import { suppressConsole } from '../../../test/helpers/console'
import { networks } from '../../consts/networks'
import { RPCProvider } from '../../interfaces/provider'
import * as deploylessModule from '../../libs/deployless/deployless'
import * as providerModule from '../provider'
import { getEnsExpiry, resolveENSDomain, reverseLookupEns } from './ensDomains'

const STUB_PROVIDER = {} as RPCProvider

const ethereumProvider = providerModule.getRpcProvider(
  networks.find((n) => n.chainId === 1n)!.rpcUrls,
  1n
)

const makeAddress = (index: number) => `0x${(index + 1).toString(16).padStart(40, '0')}`

describe('reverseLookupEns (batched + CCIP fallback)', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('chunks the addresses into batched eth_calls of at most 50', async () => {
    const callMock = jest
      .fn<(method: string, args: any[]) => Promise<any>>()
      .mockImplementation(async (_method, args) => {
        const addressChunk = args[1] as string[]
        return addressChunk.map(() => ({
          resolvedName: '',
          hasName: false,
          needsOffchainLookup: false
        }))
      })
    jest
      .spyOn(deploylessModule, 'fromDescriptor')
      .mockReturnValue({ call: callMock } as unknown as deploylessModule.Deployless)

    const addresses = Array.from({ length: 150 }, (_, i) => makeAddress(i))
    const result = await reverseLookupEns(addresses, STUB_PROVIDER)

    expect(callMock).toHaveBeenCalledTimes(3)
    expect((callMock.mock.calls[0]![1][1] as string[]).length).toBe(50)
    expect((callMock.mock.calls[1]![1][1] as string[]).length).toBe(50)
    expect(Object.keys(result).length).toBe(150)
    expect(result[addresses[0]!]).toEqual({ name: null, failed: false })
  })

  it('isolates a failed chunk: only its addresses are marked failed', async () => {
    const { restore } = suppressConsole(true)
    const callMock = jest
      .fn<(method: string, args: any[]) => Promise<any>>()
      .mockImplementationOnce(async (_method, args) =>
        (args[1] as string[]).map(() => ({
          resolvedName: '',
          hasName: false,
          needsOffchainLookup: false
        }))
      )
      .mockRejectedValueOnce(new Error('rpc timeout'))
    jest
      .spyOn(deploylessModule, 'fromDescriptor')
      .mockReturnValue({ call: callMock } as unknown as deploylessModule.Deployless)

    const addresses = Array.from({ length: 150 }, (_, i) => makeAddress(i))
    const result = await reverseLookupEns(addresses, STUB_PROVIDER)

    // First chunk (50) succeeded, second chunk (50) failed.
    expect(result[addresses[0]!]).toEqual({ name: null, failed: false })
    expect(result[addresses[50]!]).toEqual({ name: null, failed: true })
    restore()
  })

  it('falls back to viem getEnsName for addresses flagged needsOffchainLookup (CCIP)', async () => {
    const offchainAddress = makeAddress(0)
    const onchainAddress = makeAddress(1)

    const callMock = jest.fn<(method: string, args: any[]) => Promise<any>>().mockResolvedValue([
      { resolvedName: '', hasName: false, needsOffchainLookup: true },
      { resolvedName: 'onchain.eth', hasName: true, needsOffchainLookup: false }
    ])
    jest
      .spyOn(deploylessModule, 'fromDescriptor')
      .mockReturnValue({ call: callMock } as unknown as deploylessModule.Deployless)

    // The code calls the standalone `getEnsName(client, { address, ... })` from viem/ens, so the
    // options object (with the address) is the SECOND argument; the client is the first.
    const getEnsNameMock = jest
      .fn<(client: any, args: any) => Promise<string | null>>()
      .mockResolvedValue('offchain.eth')
    jest.spyOn(viemEnsModule, 'getEnsName').mockImplementation(getEnsNameMock as any)

    const result = await reverseLookupEns([offchainAddress, onchainAddress], STUB_PROVIDER)

    expect(getEnsNameMock).toHaveBeenCalledTimes(1)
    expect((getEnsNameMock.mock.calls[0]![1] as any).address).toBe(offchainAddress)
    expect(result[offchainAddress]).toEqual({ name: 'offchain.eth', failed: false })
    expect(result[onchainAddress]).toEqual({ name: 'onchain.eth', failed: false })
  })

  it('marks an address failed if the CCIP fallback itself fails', async () => {
    const { restore } = suppressConsole(true)
    const offchainAddress = makeAddress(0)

    const callMock = jest
      .fn<(method: string, args: any[]) => Promise<any>>()
      .mockResolvedValue([{ resolvedName: '', hasName: false, needsOffchainLookup: true }])
    jest
      .spyOn(deploylessModule, 'fromDescriptor')
      .mockReturnValue({ call: callMock } as unknown as deploylessModule.Deployless)

    const getEnsNameMock = jest
      .fn<(client: any, args: any) => Promise<string | null>>()
      .mockRejectedValue(new Error('gateway unreachable'))
    jest.spyOn(viemEnsModule, 'getEnsName').mockImplementation(getEnsNameMock as any)

    const result = await reverseLookupEns([offchainAddress], STUB_PROVIDER)

    expect(result[offchainAddress]).toEqual({ name: null, failed: true })
    restore()
  })
})

describe('getEnsExpiry', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  const GRACE_PERIOD_SECONDS = 90n * 24n * 60n * 60n
  const BLOCK_TIMESTAMP = BigInt(Math.floor(new Date('2026-06-24T00:00:00Z').getTime() / 1000))

  type ExpiryTuple = { expiry: bigint; gracePeriod: bigint; blockTimestamp: bigint }

  const expectFreshTimestamp = (updatedAt: number) => {
    expect(updatedAt).toBeGreaterThan(Date.now() - 10 * 60 * 1000)
    expect(updatedAt).toBeLessThanOrEqual(Date.now() + 60 * 1000)
  }

  it('returns the exact registrar expiry + 90-day grace for .eth name', async () => {
    const result = await getEnsExpiry(ethereumProvider, { name: 'offchaindemo.eth' })

    expect(result).not.toBeNull()
    // May 16, 2027 07:18:59 GMT+3
    expect(result!.expiresAt).toBe(new Date('2027-05-16T07:18:59+03:00').getTime())
    // Aug 14, 2027 07:18:59 GMT+3 (registration expiry + the 90-day registrar grace period)
    expect(result!.gracePeriodEndsAt).toBe(new Date('2027-08-14T07:18:59+03:00').getTime())
    expectFreshTimestamp(result!.updatedAt)
  })

  it('returns the exact registrar expiry + 90-day grace for .eth name', async () => {
    const result = await getEnsExpiry(ethereumProvider, { name: 'vitalik.eth' })

    expect(result).not.toBeNull()
    // Jan 27, 2048 00:56:52 GMT+2
    expect(result!.expiresAt).toBeGreaterThan(new Date('2048-01-27T00:56:52+02:00').getTime())
    // Apr 26, 2048 01:56:52 GMT+3 (registration expiry + the 90-day registrar grace period)
    expect(result!.gracePeriodEndsAt).toBeGreaterThan(
      new Date('2048-04-26T01:56:52+03:00').getTime()
    )
    expectFreshTimestamp(result!.updatedAt)
  })

  it('returns null for a subname that is not wrapped', async () => {
    // No expiry
    expect(await getEnsExpiry(ethereumProvider, { name: 'test.offchaindemo.eth' })).toBeNull()
  })

  it('returns null for non-.eth subname that is not wrapped', async () => {
    // No expiry
    expect(await getEnsExpiry(ethereumProvider, { name: 'ses.fkey.id' })).toBeNull()
  })

  const mockGetExpiry = (makeResult: (args: any[]) => ExpiryTuple | (() => never)) => {
    const callMock = jest
      .fn<(method: string, args: any[]) => Promise<any>>()
      .mockImplementation(async (_method, args) => {
        const result = makeResult(args)
        if (typeof result === 'function') return result()
        return result
      })
    jest
      .spyOn(deploylessModule, 'fromDescriptor')
      .mockReturnValue({ call: callMock } as unknown as deploylessModule.Deployless)
    return callMock
  }

  const argsOf = (callMock: ReturnType<typeof mockGetExpiry>) => {
    const [useRegistrar, baseRegistrar, nameWrapper, id] = callMock.mock.calls[0]![1]
    return { useRegistrar, baseRegistrar, nameWrapper, id }
  }

  it('returns expiry (ms) and grace-period end for a registered .eth 2LD via the registrar', async () => {
    const expiresSeconds = BigInt(Math.floor(new Date('2033-05-18T00:00:00Z').getTime() / 1000))
    const callMock = mockGetExpiry(() => ({
      expiry: expiresSeconds,
      gracePeriod: GRACE_PERIOD_SECONDS,
      blockTimestamp: BLOCK_TIMESTAMP
    }))

    const result = await getEnsExpiry(STUB_PROVIDER, { name: 'alice.eth' })

    const gracePeriodMs = Number(GRACE_PERIOD_SECONDS) * 1000
    expect(result).toEqual({
      expiresAt: Number(expiresSeconds) * 1000,
      gracePeriodEndsAt: Number(expiresSeconds) * 1000 + gracePeriodMs,
      // updatedAt comes from the on-chain block timestamp, not Date.now()
      updatedAt: Number(BLOCK_TIMESTAMP) * 1000
    })
    // useRegistrar === true and the id is the labelhash of the FIRST label (never the namehash).
    const { useRegistrar, id } = argsOf(callMock)
    expect(useRegistrar).toBe(true)
    expect(id).toBe(BigInt(labelhash('alice')))
  })

  it('honours the `contract` override: forces the NameWrapper for a .eth 2LD', async () => {
    const wrapperExpirySeconds = BigInt(
      Math.floor(new Date('2034-09-01T00:00:00Z').getTime() / 1000)
    )
    const callMock = mockGetExpiry(() => ({
      expiry: wrapperExpirySeconds,
      gracePeriod: 0n,
      blockTimestamp: BLOCK_TIMESTAMP
    }))

    const result = await getEnsExpiry(STUB_PROVIDER, { name: 'alice.eth', contract: 'nameWrapper' })

    expect(result).toEqual({
      expiresAt: Number(wrapperExpirySeconds) * 1000,
      gracePeriodEndsAt: Number(wrapperExpirySeconds) * 1000,
      updatedAt: Number(BLOCK_TIMESTAMP) * 1000
    })
    const { useRegistrar, id } = argsOf(callMock)
    expect(useRegistrar).toBe(false)
    // Wrapper path uses the namehash of the full name.
    expect(id).toBe(BigInt(namehash(normalize('alice.eth'))))
  })

  it('honours the `contract` override: forces the registrar for a subname', async () => {
    const expiresSeconds = BigInt(Math.floor(new Date('2033-05-18T00:00:00Z').getTime() / 1000))
    const callMock = mockGetExpiry(() => ({
      expiry: expiresSeconds,
      gracePeriod: GRACE_PERIOD_SECONDS,
      blockTimestamp: BLOCK_TIMESTAMP
    }))

    await getEnsExpiry(STUB_PROVIDER, { name: 'sub.alice.eth', contract: 'registrar' })

    const { useRegistrar, id } = argsOf(callMock)
    expect(useRegistrar).toBe(true)
    // Registrar path hashes only the FIRST label.
    expect(id).toBe(BigInt(labelhash('sub')))
  })

  it('routes a subname to the NameWrapper with the namehash of the full name', async () => {
    const wrapperExpirySeconds = BigInt(
      Math.floor(new Date('2034-09-01T00:00:00Z').getTime() / 1000)
    )
    const callMock = mockGetExpiry(() => ({
      expiry: wrapperExpirySeconds,
      gracePeriod: 0n,
      blockTimestamp: BLOCK_TIMESTAMP
    }))

    const result = await getEnsExpiry(STUB_PROVIDER, { name: 'sub.alice.eth' })

    // Wrapper expiry has no separate grace period, so gracePeriodEndsAt === expiresAt.
    expect(result).toEqual({
      expiresAt: Number(wrapperExpirySeconds) * 1000,
      gracePeriodEndsAt: Number(wrapperExpirySeconds) * 1000,
      updatedAt: Number(BLOCK_TIMESTAMP) * 1000
    })
    const { useRegistrar, id } = argsOf(callMock)
    expect(useRegistrar).toBe(false)
    expect(id).toBe(BigInt(namehash(normalize('sub.alice.eth'))))
  })

  it('routes a non-.eth name to the NameWrapper', async () => {
    const wrapperExpirySeconds = BigInt(
      Math.floor(new Date('2030-01-01T00:00:00Z').getTime() / 1000)
    )
    const callMock = mockGetExpiry(() => ({
      expiry: wrapperExpirySeconds,
      gracePeriod: 0n,
      blockTimestamp: BLOCK_TIMESTAMP
    }))

    const result = await getEnsExpiry(STUB_PROVIDER, { name: 'alice.com' })

    expect(result).toEqual({
      expiresAt: Number(wrapperExpirySeconds) * 1000,
      gracePeriodEndsAt: Number(wrapperExpirySeconds) * 1000,
      updatedAt: Number(BLOCK_TIMESTAMP) * 1000
    })
    const { useRegistrar, id } = argsOf(callMock)
    expect(useRegistrar).toBe(false)
    expect(id).toBe(BigInt(namehash(normalize('alice.com'))))
  })

  it('returns null when the name is unregistered', async () => {
    mockGetExpiry(() => ({
      expiry: 0n,
      gracePeriod: GRACE_PERIOD_SECONDS,
      blockTimestamp: BLOCK_TIMESTAMP
    }))
    expect(await getEnsExpiry(STUB_PROVIDER, { name: 'unregistered.eth' })).toBeNull()
  })

  it('returns null when the NameWrapper reports the name is not wrapped', async () => {
    mockGetExpiry(() => ({ expiry: 0n, gracePeriod: 0n, blockTimestamp: BLOCK_TIMESTAMP }))
    expect(await getEnsExpiry(STUB_PROVIDER, { name: 'unwrapped.alice.eth' })).toBeNull()
  })

  // ENS v2 has no grace period: GRACE_PERIOD() returns 0. The name still has a real expiry, so a 0
  // grace must NOT discard it - it just means the grace window is empty (gracePeriodEndsAt === expiresAt).
  // Sadly, I couldn't find such a name to test, so we are mocking it
  it('returns a valid expiry with no grace window when GRACE_PERIOD() is 0 (ENS v2)', async () => {
    const expiresSeconds = BigInt(Math.floor(new Date('2033-05-18T00:00:00Z').getTime() / 1000))
    mockGetExpiry(() => ({
      expiry: expiresSeconds,
      gracePeriod: 0n,
      blockTimestamp: BLOCK_TIMESTAMP
    }))

    const result = await getEnsExpiry(STUB_PROVIDER, { name: 'alice.eth' })

    expect(result).toEqual({
      expiresAt: Number(expiresSeconds) * 1000,
      gracePeriodEndsAt: Number(expiresSeconds) * 1000,
      updatedAt: Number(BLOCK_TIMESTAMP) * 1000
    })
  })
})

describe('resolveENSDomain', () => {
  it('live mainnet: resolves the address, avatar and the exact ENS expiry for vitalik.eth', async () => {
    const result = await resolveENSDomain({ provider: ethereumProvider, domain: 'vitalik.eth' })

    expect(result.address).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
    expect(result.expiry).not.toBeNull()
    expect(result.expiry!.expiresAt).toBeGreaterThan(
      new Date('2048-01-27T00:56:52+02:00').getTime()
    )
    expect(result.expiry!.gracePeriodEndsAt).toBeGreaterThan(
      new Date('2048-04-26T01:56:52+03:00').getTime()
    )
  })
})
