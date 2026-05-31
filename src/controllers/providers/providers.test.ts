import { Interface } from 'ethers'

import { expect, jest } from '@jest/globals'

import { IStorageController } from '../../interfaces/storage'
import { RPCProvider } from '../../interfaces/provider'
import { suppressConsoleBeforeEach } from '../../../test/helpers/console'
import { Network } from '../../interfaces/network'
import { ProvidersController } from './providers'

const chainId = 10n
const address = '0x4200000000000000000000000000000000000006'
const requestId = 'request-id'
const network = { chainId } as Network
const storage = {
  get: jest.fn(async (_key: string, defaultValue: unknown) => defaultValue)
} as unknown as IStorageController

async function getProvidersController(call: RPCProvider['call']) {
  const sendUiMessage = jest.fn()
  const providersController = new ProvidersController({
    storage,
    getNetworks: () => [network],
    sendUiMessage
  })
  await providersController.initialLoadPromise
  providersController.providers[chainId.toString()] = { call } as RPCProvider

  return { providersController, sendUiMessage }
}

suppressConsoleBeforeEach()

describe('ProvidersController', () => {
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
})
