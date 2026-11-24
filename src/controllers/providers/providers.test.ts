import { Interface } from 'ethers'

import { expect, jest } from '@jest/globals'

import { IStorageController } from '../../interfaces/storage'
import { RPCProvider } from '../../interfaces/provider'
import {
  WALLET_STAKING_CHAIN_ID,
  X_WALLET_SHARE_VALUE_RPC_TIMEOUT_MS
} from '../../libs/walletStaking/shareValue'
import { suppressConsoleBeforeEach } from '../../../test/helpers/console'
import { Network } from '../../interfaces/network'
import { Portfolio } from '../../libs/portfolio/portfolio'
import { ProvidersController } from './providers'

const chainId = 10n
const address = '0x4200000000000000000000000000000000000006'
const requestId = 'request-id'
const network = { chainId } as Network
const storage = {
  get: jest.fn(async (_key: string, defaultValue: unknown) => defaultValue)
} as unknown as IStorageController

async function getProvidersController(call: RPCProvider['call'], targetNetwork = network) {
  const sendUiMessage = jest.fn()
  const providersController = new ProvidersController({
    storage,
    getNetworks: () => [targetNetwork],
    sendUiMessage
  })
  await providersController.initialLoadPromise
  providersController.providers[targetNetwork.chainId.toString()] = { call } as RPCProvider

  return { providersController, sendUiMessage }
}

suppressConsoleBeforeEach()

describe('ProvidersController', () => {
  afterEach(() => jest.useRealTimers())

  test('callContractAndSendResToUi sends successful falsy contract results to the UI', async () => {
    const abi = 'function isSupported() view returns(bool)'
    const iface = new Interface([abi])
    const { providersController, sendUiMessage } = await getProvidersController(
      jest.fn(async () => iface.encodeFunctionResult('isSupported', [false]))
    )

    await providersController.callContractAndSendResToUi(
      { chainId, address, abi, method: 'isSupported', args: [] },
      requestId
    )

    expect(sendUiMessage).toHaveBeenCalledWith({ requestId, ok: true, res: false })
  })

  test('callContractAndSendResToUi sends successful truthy contract results to the UI', async () => {
    const abi = 'function name() view returns(string)'
    const iface = new Interface([abi])
    const { providersController, sendUiMessage } = await getProvidersController(
      jest.fn(async () => iface.encodeFunctionResult('name', ['Wrapped Ether']))
    )

    await providersController.callContractAndSendResToUi(
      { chainId, address, abi, method: 'name', args: [] },
      requestId
    )

    expect(sendUiMessage).toHaveBeenCalledWith({ requestId, ok: true, res: 'Wrapped Ether' })
  })

  test('callContractAndSendResToUi sends rejected contract reads to the UI', async () => {
    const { providersController, sendUiMessage } = await getProvidersController(
      jest.fn(async () => {
        throw new Error('execution reverted')
      })
    )

    await providersController.callContractAndSendResToUi(
      {
        chainId,
        address,
        abi: 'function name() view returns(string)',
        method: 'name',
        args: []
      },
      requestId
    )

    expect(sendUiMessage).toHaveBeenCalledWith({
      requestId,
      ok: false,
      error: 'execution reverted'
    })
    expect(providersController.emittedErrors).toMatchObject([
      { message: 'execution reverted', level: 'silent' }
    ])
  })

  test('getXWalletShareValueAndSendResToUi responds when the contract read does not settle', async () => {
    const ethereum = { chainId: WALLET_STAKING_CHAIN_ID } as Network
    const { providersController, sendUiMessage } = await getProvidersController(
      jest.fn<RPCProvider['call']>(() => new Promise(() => {})),
      ethereum
    )
    jest.useFakeTimers()

    const request = providersController.getXWalletShareValueAndSendResToUi(requestId)
    await jest.advanceTimersByTimeAsync(X_WALLET_SHARE_VALUE_RPC_TIMEOUT_MS)
    await request

    expect(sendUiMessage).toHaveBeenCalledWith({
      requestId,
      ok: false,
      error: 'The WALLET staking conversion rate took too long to load.'
    })
  })

  describe('resolveAssetInfoAndSendResToUi', () => {
    const WETH = '0x4200000000000000000000000000000000000006'
    const resolvedToken = { address: WETH, symbol: 'WETH', decimals: 18, priceIn: [] }

    const mockPortfolioLookup = () =>
      jest
        .spyOn(Portfolio.prototype, 'get')
        .mockResolvedValue({ tokens: [resolvedToken], collections: [] } as any)

    test('replies to the request id that dispatchAndWait appends as the last argument', async () => {
      mockPortfolioLookup()
      const { providersController, sendUiMessage } = await getProvidersController(jest.fn() as any)

      await providersController.resolveAssetInfoAndSendResToUi({ address: WETH, network }, requestId)
      await new Promise((resolve) => {
        setTimeout(resolve, 600)
      })

      expect(sendUiMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId,
          ok: true,
          res: expect.objectContaining({ tokenInfo: resolvedToken })
        })
      )
    })

    test('creates the provider of a network that has none yet before looking the token up', async () => {
      mockPortfolioLookup()
      const otherNetwork = { chainId: 1n, name: 'Ethereum' } as Network
      const { providersController, sendUiMessage } = await getProvidersController(jest.fn() as any)
      const setProviderSpy = jest
        .spyOn(providersController, 'setProvider')
        .mockImplementation(async (networkToSet) => {
          providersController.providers[networkToSet.chainId.toString()] = {} as RPCProvider
        })

      await providersController.resolveAssetInfoAndSendResToUi(
        { address: WETH, network: otherNetwork },
        requestId
      )
      await new Promise((resolve) => {
        setTimeout(resolve, 600)
      })

      expect(setProviderSpy).toHaveBeenCalledWith(otherNetwork)
      expect(sendUiMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId, ok: true }))
    })

    test('keeps the existing provider of the network', async () => {
      mockPortfolioLookup()
      const { providersController } = await getProvidersController(jest.fn() as any)
      const setProviderSpy = jest.spyOn(providersController, 'setProvider')

      await providersController.resolveAssetInfoAndSendResToUi({ address: WETH, network }, requestId)
      await new Promise((resolve) => {
        setTimeout(resolve, 600)
      })

      expect(setProviderSpy).not.toHaveBeenCalled()
    })
  })
})
