import { Interface, parseUnits } from 'ethers'

import { expect, jest } from '@jest/globals'

import { WALLET_STAKING_ADDR } from '../../consts/addresses'
import { RPCProvider } from '../../interfaces/provider'
import {
  getWalletAmountFromXWallet,
  getWalletStakingShareValue,
  getXWalletConversionText,
  WalletStakingShareValueError,
  X_WALLET_SHARE_VALUE_RPC_TIMEOUT_MS,
  X_WALLET_SHARE_VALUE_CACHE_TTL,
  XWalletLockedSharesGetter,
  XWalletShareValueCache,
  XWalletShareValueResult
} from './shareValue'

const shareValueInterface = new Interface(['function shareValue() view returns (uint256)'])

const getProvider = (call: RPCProvider['call']) => ({ call }) as RPCProvider

describe('XWalletShareValueCache', () => {
  let now = 1_000_000

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  test('reuses a successful value for one hour and refreshes it after expiry', async () => {
    const call = jest
      .fn<RPCProvider['call']>()
      .mockResolvedValueOnce(shareValueInterface.encodeFunctionResult('shareValue', [2n]))
      .mockResolvedValueOnce(shareValueInterface.encodeFunctionResult('shareValue', [3n]))
    const cache = new XWalletShareValueCache()
    const provider = getProvider(call)

    await expect(cache.get(provider)).resolves.toMatchObject({ shareValue: 2n, updatedAt: now })
    await expect(cache.get(provider)).resolves.toMatchObject({ shareValue: 2n, updatedAt: now })
    expect(call).toHaveBeenCalledTimes(1)

    now += X_WALLET_SHARE_VALUE_CACHE_TTL
    await expect(cache.get(provider)).resolves.toMatchObject({ shareValue: 3n, updatedAt: now })
    expect(call).toHaveBeenCalledTimes(2)
  })

  test('deduplicates concurrent refreshes', async () => {
    let resolveCall: ((value: string) => void) | undefined
    const call = jest.fn<RPCProvider['call']>().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCall = resolve
        })
    )
    const cache = new XWalletShareValueCache()
    const provider = getProvider(call)
    const firstRequest = cache.get(provider)
    const secondRequest = cache.get(provider)

    for (let attempt = 0; attempt < 10 && !resolveCall; attempt += 1) {
      await Promise.resolve()
    }
    expect(call).toHaveBeenCalledTimes(1)
    resolveCall?.(shareValueInterface.encodeFunctionResult('shareValue', [2n]))

    await expect(firstRequest).resolves.toMatchObject({ shareValue: 2n })
    await expect(secondRequest).resolves.toMatchObject({ shareValue: 2n })
  })

  test('serves stale data for one hour when a refresh fails', async () => {
    const call = jest
      .fn<RPCProvider['call']>()
      .mockResolvedValueOnce(shareValueInterface.encodeFunctionResult('shareValue', [2n]))
      .mockRejectedValueOnce(new Error('provider unavailable'))
    const cache = new XWalletShareValueCache()
    const provider = getProvider(call)

    await cache.get(provider)
    now += X_WALLET_SHARE_VALUE_CACHE_TTL

    await expect(cache.get(provider)).resolves.toMatchObject({
      shareValue: 2n,
      refreshError: new Error('provider unavailable')
    })
    await expect(cache.get(provider)).resolves.toMatchObject({ shareValue: 2n })
    expect(call).toHaveBeenCalledTimes(2)
  })

  test('caches an unavailable result for one hour when no stale value exists', async () => {
    const call = jest.fn<RPCProvider['call']>().mockRejectedValue(new Error('provider unavailable'))
    const cache = new XWalletShareValueCache()
    const provider = getProvider(call)

    await expect(cache.get(provider)).rejects.toThrow('provider unavailable')
    await expect(cache.get(provider)).rejects.toThrow('provider unavailable')
    expect(call).toHaveBeenCalledTimes(1)
  })

  test('rejects a zero share value instead of displaying a misleading conversion', async () => {
    const call = jest
      .fn<RPCProvider['call']>()
      .mockResolvedValue(shareValueInterface.encodeFunctionResult('shareValue', [0n]))
    const cache = new XWalletShareValueCache()

    await expect(cache.get(getProvider(call))).rejects.toThrow(
      'The WALLET staking conversion rate is unavailable.'
    )
  })

  test('rejects when the share value RPC call does not settle', async () => {
    jest.useFakeTimers()
    const call = jest.fn<RPCProvider['call']>(() => new Promise(() => {}))
    const cache = new XWalletShareValueCache()
    const request = cache.get(getProvider(call))
    const expectation = expect(request).rejects.toThrow(
      'The WALLET staking conversion rate took too long to load.'
    )

    await jest.advanceTimersByTimeAsync(X_WALLET_SHARE_VALUE_RPC_TIMEOUT_MS)

    await expectation
  })
})

describe('xWALLET conversion', () => {
  test('calculates with integer precision and formats the shared explanation', () => {
    const xWalletAmount = parseUnits('0.00047', 18)
    const shareValue = parseUnits('21.28', 18)
    const walletAmount = getWalletAmountFromXWallet(xWalletAmount, shareValue)

    expect(walletAmount).toBe(10_001_600_000_000_000n)
    expect(getXWalletConversionText(xWalletAmount, walletAmount)).toBe(
      '0.00047 xWALLET = 0.01 WALLET'
    )
  })
})

const ETHEREUM_CHAIN_ID = 1n
const OTHER_CHAIN_ID = 137n
const ACCOUNT_ADDR = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
const provider = {} as RPCProvider
const shareValueResult: XWalletShareValueResult = { shareValue: 2n, updatedAt: 1 }
const getToken = ({
  address = WALLET_STAKING_ADDR,
  amount = 0n,
  amountPostSimulation = 0n
}: {
  address?: string
  amount?: bigint
  amountPostSimulation?: bigint
} = {}) => ({ address, amount, amountPostSimulation })

const getShareValueLookup = () => {
  const get = jest.fn<(provider: RPCProvider) => Promise<XWalletShareValueResult>>()
  const getLockedShares = jest.fn<XWalletLockedSharesGetter>()
  const onError = jest.fn<(error: WalletStakingShareValueError) => void>()
  const lookup = (params: Omit<Parameters<typeof getWalletStakingShareValue>[0], 'onError'>) =>
    getWalletStakingShareValue({
      ...params,
      onError,
      shareValueCache: { get } as Pick<XWalletShareValueCache, 'get'>,
      lockedSharesGetter: getLockedShares
    })

  return { lookup, get, getLockedShares, onError }
}

describe('getWalletStakingShareValue', () => {
  afterEach(() => jest.restoreAllMocks())

  test('loads the xWALLET share value for current and simulated balances', async () => {
    const { lookup, get } = getShareValueLookup()
    get.mockResolvedValue(shareValueResult)

    await expect(
      lookup({
        chainId: ETHEREUM_CHAIN_ID,
        tokens: [getToken({ amount: 1n })],
        provider
      })
    ).resolves.toEqual(shareValueResult)
    await expect(
      lookup({
        chainId: ETHEREUM_CHAIN_ID,
        tokens: [getToken({ amountPostSimulation: 1n })],
        provider
      })
    ).resolves.toEqual(shareValueResult)

    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenNthCalledWith(1, provider)
  })

  test('skips the lookup outside Ethereum or without an xWALLET balance', async () => {
    const { lookup, get } = getShareValueLookup()

    await expect(
      lookup({
        chainId: OTHER_CHAIN_ID,
        tokens: [getToken({ amount: 1n })],
        provider
      })
    ).resolves.toBeNull()
    await expect(
      lookup({
        chainId: ETHEREUM_CHAIN_ID,
        tokens: [getToken({ address: '0x0000000000000000000000000000000000000001', amount: 1n })],
        provider
      })
    ).resolves.toBeNull()
    await expect(
      lookup({
        chainId: ETHEREUM_CHAIN_ID,
        tokens: [getToken()],
        provider
      })
    ).resolves.toBeNull()

    expect(get).not.toHaveBeenCalled()
  })

  test('returns stale data and reports its refresh failure', async () => {
    const { lookup, get, onError } = getShareValueLookup()
    const refreshError = new Error('provider unavailable')
    get.mockResolvedValue({ ...shareValueResult, refreshError })

    await expect(
      lookup({
        chainId: ETHEREUM_CHAIN_ID,
        tokens: [getToken({ amount: 1n })],
        provider
      })
    ).resolves.toEqual(shareValueResult)
    expect(onError).toHaveBeenCalledWith({
      level: 'silent',
      message: 'Unable to refresh the WALLET staking conversion rate.',
      error: refreshError
    })
  })

  test('normalizes a failed lookup, reports it and returns no result', async () => {
    const { lookup, get, onError } = getShareValueLookup()
    get.mockRejectedValue('provider unavailable')

    await expect(
      lookup({
        chainId: ETHEREUM_CHAIN_ID,
        tokens: [getToken({ amount: 1n })],
        provider
      })
    ).resolves.toBeNull()
    expect(onError).toHaveBeenCalledWith({
      level: 'silent',
      message: 'Unable to load the WALLET staking conversion rate.',
      error: new Error('Unable to load the WALLET staking conversion rate.')
    })
  })

  test('loads the locked shares for the account alongside the share value', async () => {
    const { lookup, get, getLockedShares } = getShareValueLookup()
    get.mockResolvedValue(shareValueResult)
    getLockedShares.mockResolvedValue(5n)

    await expect(
      lookup({
        chainId: ETHEREUM_CHAIN_ID,
        tokens: [getToken({ amount: 10n })],
        provider,
        accountAddr: ACCOUNT_ADDR
      })
    ).resolves.toEqual({ ...shareValueResult, lockedShares: 5n })
    expect(getLockedShares).toHaveBeenCalledWith(provider, ACCOUNT_ADDR)
  })

  test('skips the locked shares lookup without an account', async () => {
    const { lookup, get, getLockedShares } = getShareValueLookup()
    get.mockResolvedValue(shareValueResult)

    await expect(
      lookup({
        chainId: ETHEREUM_CHAIN_ID,
        tokens: [getToken({ amount: 10n })],
        provider
      })
    ).resolves.toEqual(shareValueResult)
    expect(getLockedShares).not.toHaveBeenCalled()
  })

  test('keeps the share value and reports a failed locked shares lookup', async () => {
    const { lookup, get, getLockedShares, onError } = getShareValueLookup()
    const lockedSharesError = new Error('provider unavailable')
    get.mockResolvedValue(shareValueResult)
    getLockedShares.mockRejectedValue(lockedSharesError)

    await expect(
      lookup({
        chainId: ETHEREUM_CHAIN_ID,
        tokens: [getToken({ amount: 10n })],
        provider,
        accountAddr: ACCOUNT_ADDR
      })
    ).resolves.toEqual({ ...shareValueResult, lockedShares: undefined })
    expect(onError).toHaveBeenCalledWith({
      level: 'silent',
      message: 'Unable to load the locked xWALLET shares.',
      error: lockedSharesError
    })
  })
})
