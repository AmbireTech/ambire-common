import { expect, jest } from '@jest/globals'

import { WALLET_STAKING_ADDR } from '../../consts/addresses'
import { RPCProvider } from '../../interfaces/provider'
import {
  XWalletShareValueCache,
  XWalletShareValueResult
} from '../../libs/walletStaking/shareValue'
import { WalletTokenController } from './walletToken'

const ETHEREUM_CHAIN_ID = 1n
const OTHER_CHAIN_ID = 137n
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
  const controller = new WalletTokenController({ get } as Pick<XWalletShareValueCache, 'get'>)

  return { controller, get }
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
})
