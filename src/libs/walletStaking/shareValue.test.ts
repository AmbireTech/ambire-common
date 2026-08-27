import { Interface, parseUnits } from 'ethers'

import { expect, jest } from '@jest/globals'

import { RPCProvider } from '../../interfaces/provider'
import {
  getWalletAmountFromXWallet,
  getXWalletConversionText,
  X_WALLET_SHARE_VALUE_CACHE_TTL,
  XWalletShareValueCache
} from './shareValue'

const shareValueInterface = new Interface(['function shareValue() view returns (uint256)'])

const getProvider = (call: RPCProvider['call']) => ({ call }) as RPCProvider

describe('XWalletShareValueCache', () => {
  let now = 1_000_000

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
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
