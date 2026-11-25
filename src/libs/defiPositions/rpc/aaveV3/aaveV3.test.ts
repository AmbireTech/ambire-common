import { Contract } from 'ethers'

import { afterEach, describe, expect, jest, test } from '@jest/globals'

import { networks } from '../../../../consts/networks'
import { getRpcProvider } from '../../../../services/provider'
import { Deployless } from '../../../deployless/deployless'
import {
  AAVE_RESERVES_COUNT_MAX_AGE_MS,
  AAVE_STATIC_CALL_TIMEOUT_MS,
  getAAVEPositions
} from './aaveV3'

// If this test ever fails because the account removes its positions, find another
// account with AAVE v3 positions on Ethereum (e.g. on https://debank.com/protocols/aave3/holders)
const userAddrAave = '0xe40d278afd00e6187db21ff8c96d572359ef03bf'

const ethereum = networks.find((n) => n.chainId === 1n)
if (!ethereum) throw new Error('unable to find ethereum network in consts')

const providerEthereum = getRpcProvider(['https://invictus.ambire.com/ethereum'], 1n)

/** Whether a deployless call sent the contract's code as a state override (a 3rd `eth_call` param) */
const hasUsedStateOverride = (sendSpy: { mock: { calls: unknown[][] } }) =>
  sendSpy.mock.calls.some(
    ([method, params]) => method === 'eth_call' && Array.isArray(params) && params.length === 3
  )

describe('AAVE v3 positions read from the chain', () => {
  test('Get AAVE positions on Ethereum', async () => {
    const aavePositions = await getAAVEPositions(userAddrAave, providerEthereum, ethereum)

    expect(aavePositions).not.toBeNull()
    if (aavePositions !== null) {
      const pos1 = aavePositions.positions[0]!
      expect(pos1.additionalData.healthRate).toBeGreaterThan(1)
    }
  })
  test('AAVE returns prices, health rate, additional date and asset value', async () => {
    const aavePositions = await getAAVEPositions(userAddrAave, providerEthereum, ethereum)
    // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
    const pos = aavePositions?.positions[0]!
    if (!pos) throw new Error('no positions found')

    expect(aavePositions?.positionInUSD).toBeGreaterThan(0)
    expect(pos.additionalData.positionInUSD).toBeGreaterThan(0)
    expect(pos.additionalData.healthRate).toBeGreaterThan(0)
    expect(pos.additionalData.collateralInUSD).toBeGreaterThan(0)
  })
  // The contract deploys its helper contracts in its constructor, which doesn't run with a state
  // override, so the positions would fail to load
  test.each([
    ['an RPC that supports state override', false],
    ['an RPC without state override', true]
  ])(
    'sends the contract with the call, never as a state override, on %s',
    async (_, rpcNoStateOverride) => {
      const sendSpy = jest.spyOn(providerEthereum, 'send')

      try {
        const aavePositions = await getAAVEPositions(userAddrAave, providerEthereum, {
          ...ethereum,
          rpcNoStateOverride
        })

        expect(aavePositions).not.toBeNull()
        expect(hasUsedStateOverride(sendSpy)).toBe(false)
      } finally {
        sendSpy.mockRestore()
      }
    }
  )
  test('AAVE getReservesCount times out instead of hanging forever', async () => {
    jest.useFakeTimers()
    const getFunctionSpy = jest.spyOn(Contract.prototype, 'getFunction').mockReturnValue({
      staticCall: () => new Promise(() => {})
    } as ReturnType<Contract['getFunction']>)

    try {
      // A new provider, as the number of reserves read by the tests above is cached per provider
      const provider = getRpcProvider(['https://invictus.ambire.com/ethereum'], 1n)
      const promise = getAAVEPositions(userAddrAave, provider, ethereum)
      const expectation = expect(promise).rejects.toThrow(/took too long/i)
      await jest.advanceTimersByTimeAsync(AAVE_STATIC_CALL_TIMEOUT_MS + 50)
      await expectation
    } finally {
      getFunctionSpy.mockRestore()
      jest.useRealTimers()
    }
  })
})

describe('AAVE v3 number of reserves', () => {
  const PAGE_SIZE = 15
  // A reserve the account has nothing in, so it's left out of the positions
  const emptyReserve = {
    addr: '0x0000000000000000000000000000000000000001',
    symbol: 'TKN',
    name: 'Token',
    balance: 0n,
    borrowAssetBalance: 0n,
    stableBorrowAssetBalance: 0n,
    decimals: 18n,
    price: 0n
  }

  /**
   * Mocks a pool with `getReservesCount()` reserves. The calls that read the reserves skip
   * those past the last one, like the contract does
   */
  const mockPool = (getReservesCount: () => number) => {
    const countSpy = jest.fn(async () => BigInt(getReservesCount()))
    jest
      .spyOn(Contract.prototype, 'getFunction')
      .mockReturnValue({ staticCall: countSpy } as unknown as ReturnType<Contract['getFunction']>)
    const pageSpy = jest
      .spyOn(Deployless.prototype, 'call')
      .mockImplementation(async (_methodName: string, args: any[]) => {
        const [, , from, to] = args as [string, string, number, number]
        const readCount = Math.max(Math.min(to, getReservesCount()) - from, 0)

        return {
          userBalance: Array.from({ length: readCount }, () => emptyReserve),
          accountData: { healthFactor: 0n, availableBorrowsBase: 0n }
        }
      })
    const getPagesFrom = () => pageSpy.mock.calls.map(([, args]) => (args as number[])[2])

    return { countSpy, pageSpy, getPagesFrom }
  }

  // No request is sent, as the pool is mocked
  const createProvider = () => getRpcProvider(['https://invictus.ambire.com/ethereum'], 1n)

  afterEach(() => {
    jest.restoreAllMocks()
  })

  test('requests the number of reserves once and reads them all on every read', async () => {
    const { countSpy, pageSpy, getPagesFrom } = mockPool(() => 40)
    const provider = createProvider()

    await getAAVEPositions(userAddrAave, provider, ethereum)
    await getAAVEPositions(userAddrAave, provider, ethereum)

    expect(countSpy).toHaveBeenCalledTimes(1)
    expect(pageSpy).toHaveBeenCalledTimes(6)
    expect(getPagesFrom()).toEqual([0, PAGE_SIZE, 2 * PAGE_SIZE, 0, PAGE_SIZE, 2 * PAGE_SIZE])
  })

  test('reads a reserve listed after the number was cached without requesting it again', async () => {
    let reservesCount = 40
    const { countSpy, pageSpy } = mockPool(() => reservesCount)
    const provider = createProvider()

    await getAAVEPositions(userAddrAave, provider, ethereum)
    reservesCount = 44
    pageSpy.mockClear()
    await getAAVEPositions(userAddrAave, provider, ethereum)

    expect(countSpy).toHaveBeenCalledTimes(1)
    // The last page reads up to the 45th reserve, so the 44th is read too
    expect(await pageSpy.mock.results.at(-1)?.value).toMatchObject({
      userBalance: Array.from({ length: 14 }, () => emptyReserve)
    })
  })

  test('requests the number of reserves again and reads the rest when the last page is full', async () => {
    let reservesCount = 40
    const { countSpy, getPagesFrom } = mockPool(() => reservesCount)
    const provider = createProvider()

    await getAAVEPositions(userAddrAave, provider, ethereum)
    reservesCount = 50
    await getAAVEPositions(userAddrAave, provider, ethereum)

    expect(countSpy).toHaveBeenCalledTimes(2)
    expect(getPagesFrom().slice(3)).toEqual([0, PAGE_SIZE, 2 * PAGE_SIZE, 3 * PAGE_SIZE])
  })

  test('requests the number of reserves again once the cached one is too old', async () => {
    const { countSpy } = mockPool(() => 40)
    const provider = createProvider()
    const startedAt = Date.now()
    const dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(startedAt)

    await getAAVEPositions(userAddrAave, provider, ethereum)
    dateNowSpy.mockReturnValue(startedAt + AAVE_RESERVES_COUNT_MAX_AGE_MS)
    await getAAVEPositions(userAddrAave, provider, ethereum)

    expect(countSpy).toHaveBeenCalledTimes(2)
  })

  test('requests the number of reserves again with another RPC provider', async () => {
    const { countSpy } = mockPool(() => 40)

    await getAAVEPositions(userAddrAave, createProvider(), ethereum)
    await getAAVEPositions(userAddrAave, createProvider(), ethereum)

    expect(countSpy).toHaveBeenCalledTimes(2)
  })

  test('reads the pool when it has a number of reserves divisible by the page size', async () => {
    const { countSpy, getPagesFrom } = mockPool(() => 2 * PAGE_SIZE)
    const provider = createProvider()

    await getAAVEPositions(userAddrAave, provider, ethereum)
    await getAAVEPositions(userAddrAave, provider, ethereum)

    // The last page is empty, so it's never taken for one with new reserves
    expect(countSpy).toHaveBeenCalledTimes(1)
    expect(getPagesFrom()).toEqual([0, PAGE_SIZE, 2 * PAGE_SIZE, 0, PAGE_SIZE, 2 * PAGE_SIZE])
  })
})
