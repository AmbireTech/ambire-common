import { expect, jest } from '@jest/globals'

import { WALLET_STAKING_ADDR } from '../../consts/addresses'
import { RPCProvider } from '../../interfaces/provider'
import {
  XWalletShareValueCache,
  XWalletShareValueResult
} from '../../libs/walletStaking/shareValue'
import { WalletTokenController, XWalletLockedSharesGetter } from './walletToken'

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

const getController = () => {
  const get = jest.fn<(provider: RPCProvider) => Promise<XWalletShareValueResult>>()
  const getLockedShares = jest.fn<XWalletLockedSharesGetter>()
  const controller = new WalletTokenController(
    { get } as Pick<XWalletShareValueCache, 'get'>,
    getLockedShares
  )

  return { controller, get, getLockedShares }
}

describe('WalletTokenController', () => {
  afterEach(() => jest.restoreAllMocks())

  test('loads the xWALLET share value for current and simulated balances', async () => {
    const { controller, get } = getController()
    get.mockResolvedValue(shareValueResult)

    await expect(
      controller.getWalletStakingShareValue({
        chainId: ETHEREUM_CHAIN_ID,
        tokens: [getToken({ amount: 1n })],
        provider
      })
    ).resolves.toEqual(shareValueResult)
    await expect(
      controller.getWalletStakingShareValue({
        chainId: ETHEREUM_CHAIN_ID,
        tokens: [getToken({ amountPostSimulation: 1n })],
        provider
      })
    ).resolves.toEqual(shareValueResult)

    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenNthCalledWith(1, provider)
  })

  test('skips the lookup outside Ethereum or without an xWALLET balance', async () => {
    const { controller, get } = getController()

    await expect(
      controller.getWalletStakingShareValue({
        chainId: OTHER_CHAIN_ID,
        tokens: [getToken({ amount: 1n })],
        provider
      })
    ).resolves.toBeNull()
    await expect(
      controller.getWalletStakingShareValue({
        chainId: ETHEREUM_CHAIN_ID,
        tokens: [getToken({ address: '0x0000000000000000000000000000000000000001', amount: 1n })],
        provider
      })
    ).resolves.toBeNull()
    await expect(
      controller.getWalletStakingShareValue({
        chainId: ETHEREUM_CHAIN_ID,
        tokens: [getToken()],
        provider
      })
    ).resolves.toBeNull()

    expect(get).not.toHaveBeenCalled()
  })

  test('returns stale data and reports its refresh failure', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    const { controller, get } = getController()
    const refreshError = new Error('provider unavailable')
    const onError = jest.fn()
    controller.onError(onError)
    get.mockResolvedValue({ ...shareValueResult, refreshError })

    await expect(
      controller.getWalletStakingShareValue({
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
    jest.spyOn(console, 'log').mockImplementation(() => {})
    const { controller, get } = getController()
    const onError = jest.fn()
    controller.onError(onError)
    get.mockRejectedValue('provider unavailable')

    await expect(
      controller.getWalletStakingShareValue({
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
    const { controller, get, getLockedShares } = getController()
    get.mockResolvedValue(shareValueResult)
    getLockedShares.mockResolvedValue(5n)

    await expect(
      controller.getWalletStakingShareValue({
        chainId: ETHEREUM_CHAIN_ID,
        tokens: [getToken({ amount: 10n })],
        provider,
        accountAddr: ACCOUNT_ADDR
      })
    ).resolves.toEqual({ ...shareValueResult, lockedShares: 5n })
    expect(getLockedShares).toHaveBeenCalledWith(provider, ACCOUNT_ADDR)
  })

  test('skips the locked shares lookup without an account', async () => {
    const { controller, get, getLockedShares } = getController()
    get.mockResolvedValue(shareValueResult)

    await expect(
      controller.getWalletStakingShareValue({
        chainId: ETHEREUM_CHAIN_ID,
        tokens: [getToken({ amount: 10n })],
        provider
      })
    ).resolves.toEqual(shareValueResult)
    expect(getLockedShares).not.toHaveBeenCalled()
  })

  test('keeps the share value and reports a failed locked shares lookup', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
    const { controller, get, getLockedShares } = getController()
    const lockedSharesError = new Error('provider unavailable')
    const onError = jest.fn()
    controller.onError(onError)
    get.mockResolvedValue(shareValueResult)
    getLockedShares.mockRejectedValue(lockedSharesError)

    await expect(
      controller.getWalletStakingShareValue({
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
