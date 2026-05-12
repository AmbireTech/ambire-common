import { describe, expect, it, jest } from '@jest/globals'

import wait from '../../utils/wait'
import { TransfersScannerController } from './transfersScanner'

jest.mock('../../utils/wait', () => jest.fn(async () => undefined))

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

const BASE_CHAIN_ID = 8453n
const BASE_ACCOUNT_ADDR = '0xD8293ad21678c6F09Da139b4B62D38e514a03B78'
const BASE_TXN_HASH = '0xffc7344bb7605ff0a287516f299c5f9e0f6996a97f24458d8cc9f7faa4459a20'
const BASE_TXN_BLOCK = 45856809
const BASE_AAVE_TOKEN_ADDR = '0x63706e401c06ac8513145b7687a14804d17f814b'
const BASE_USDC_TOKEN_ADDR = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'

const topicAddress = (address: string) =>
  `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`

const createDeferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })

  return { promise, resolve }
}

const createController = ({
  chainId = BASE_CHAIN_ID,
  provider,
  networks = [{ chainId }]
}: {
  chainId?: bigint
  provider?: any
  networks?: { chainId: bigint }[]
} = {}) => {
  const providerMock =
    provider ||
    ({
      getBlockNumber: jest.fn(async () => 100),
      getLogs: jest.fn(async () => []),
      getTransactionReceipt: jest.fn()
    } as any)

  const activity = {
    addExternalAccountOp: jest.fn(async () => undefined)
  }
  const portfolio = {
    updateSelectedAccount: jest.fn(async () => undefined)
  }

  const controller = new TransfersScannerController({
    activity: activity as any,
    networks: {
      initialLoadPromise: Promise.resolve(),
      networks
    } as any,
    portfolio: portfolio as any,
    providers: {
      initialLoadPromise: Promise.resolve(),
      providers: {
        [chainId.toString()]: providerMock
      }
    } as any
  })

  return {
    activity,
    controller,
    network: networks[0],
    portfolio,
    provider: providerMock
  }
}

describe('TransfersScannerController scanLogs', () => {
  it('returns the same cursor and skips getLogs when fromBlock is ahead of latest', async () => {
    const provider = {
      getBlockNumber: jest.fn(async () => 100),
      getLogs: jest.fn(async () => []),
      getTransactionReceipt: jest.fn()
    }
    const { activity, controller, portfolio } = createController({ provider })

    const result = await controller.scanLogs({
      accAddr: BASE_ACCOUNT_ADDR,
      chainId: BASE_CHAIN_ID,
      fromBlock: 101
    })

    expect(result).toEqual({ nextFromBlock: 101, txnIds: [] })
    expect(provider.getLogs).not.toHaveBeenCalled()
    expect(provider.getTransactionReceipt).not.toHaveBeenCalled()
    expect(activity.addExternalAccountOp).not.toHaveBeenCalled()
    expect(portfolio.updateSelectedAccount).not.toHaveBeenCalled()
  })

  it('uses the latest block as fromBlock when fromBlock is latest', async () => {
    const provider = {
      getBlockNumber: jest.fn(async () => 200),
      getLogs: jest.fn(async () => []),
      getTransactionReceipt: jest.fn()
    }
    const { activity, controller, portfolio } = createController({ provider })

    const result = await controller.scanLogs({
      accAddr: BASE_ACCOUNT_ADDR,
      chainId: BASE_CHAIN_ID
    })

    expect(result).toEqual({ nextFromBlock: 201, txnIds: [] })
    expect(provider.getLogs).toHaveBeenCalledTimes(2)
    expect(provider.getLogs).toHaveBeenNthCalledWith(1, {
      fromBlock: 200,
      toBlock: 200,
      topics: [ERC20_TRANSFER_TOPIC, topicAddress(BASE_ACCOUNT_ADDR)]
    })
    expect(provider.getLogs).toHaveBeenNthCalledWith(2, {
      fromBlock: 200,
      toBlock: 200,
      topics: [ERC20_TRANSFER_TOPIC, null, topicAddress(BASE_ACCOUNT_ADDR)]
    })
    expect(activity.addExternalAccountOp).not.toHaveBeenCalled()
    expect(portfolio.updateSelectedAccount).not.toHaveBeenCalled()
  })

  it('finds the Base AAVE and USDC transfer logs for the known transaction fixture', async () => {
    const aaveTransferOut = {
      address: BASE_AAVE_TOKEN_ADDR,
      transactionHash: BASE_TXN_HASH,
      topics: [
        ERC20_TRANSFER_TOPIC,
        topicAddress(BASE_ACCOUNT_ADDR),
        topicAddress('0x6ff5693b99212da76ad316178a184ab56d299b43')
      ]
    }
    const usdcTransferIn = {
      address: BASE_USDC_TOKEN_ADDR,
      transactionHash: BASE_TXN_HASH,
      topics: [
        ERC20_TRANSFER_TOPIC,
        topicAddress('0x6ff5693b99212da76ad316178a184ab56d299b43'),
        topicAddress(BASE_ACCOUNT_ADDR)
      ]
    }
    const receipt = {
      hash: BASE_TXN_HASH,
      blockNumber: BASE_TXN_BLOCK,
      logs: [aaveTransferOut, usdcTransferIn]
    }
    const returnedLogAddresses: string[] = []
    const provider = {
      getBlockNumber: jest.fn(async () => BASE_TXN_BLOCK),
      getLogs: jest.fn(async ({ topics }: { topics: (string | null)[] }) => {
        const logs =
          topics[1] === topicAddress(BASE_ACCOUNT_ADDR) ? [aaveTransferOut] : [usdcTransferIn]
        returnedLogAddresses.push(...logs.map((log) => log.address))

        return logs
      }),
      getTransactionReceipt: jest.fn(async () => receipt)
    }
    const { activity, controller, network, portfolio } = createController({ provider })

    const result = await controller.scanLogs({
      accAddr: BASE_ACCOUNT_ADDR,
      chainId: BASE_CHAIN_ID,
      fromBlock: BASE_TXN_BLOCK - 1
    })

    expect(result).toEqual({ nextFromBlock: BASE_TXN_BLOCK + 1, txnIds: [BASE_TXN_HASH] })
    expect(provider.getLogs).toHaveBeenCalledTimes(2)
    expect(provider.getLogs).toHaveBeenNthCalledWith(1, {
      fromBlock: BASE_TXN_BLOCK - 1,
      toBlock: BASE_TXN_BLOCK,
      topics: [ERC20_TRANSFER_TOPIC, topicAddress(BASE_ACCOUNT_ADDR)]
    })
    expect(provider.getLogs).toHaveBeenNthCalledWith(2, {
      fromBlock: BASE_TXN_BLOCK - 1,
      toBlock: BASE_TXN_BLOCK,
      topics: [ERC20_TRANSFER_TOPIC, null, topicAddress(BASE_ACCOUNT_ADDR)]
    })
    expect(returnedLogAddresses.sort()).toEqual([BASE_AAVE_TOKEN_ADDR, BASE_USDC_TOKEN_ADDR].sort())
    expect(provider.getTransactionReceipt).toHaveBeenCalledTimes(1)
    expect(provider.getTransactionReceipt).toHaveBeenCalledWith(BASE_TXN_HASH)
    expect(activity.addExternalAccountOp).toHaveBeenCalledTimes(1)
    expect(activity.addExternalAccountOp).toHaveBeenCalledWith({
      accountAddr: BASE_ACCOUNT_ADDR,
      chainId: BASE_CHAIN_ID,
      txnId: BASE_TXN_HASH,
      receipt,
      shouldLearnTokens: true
    })
    expect(portfolio.updateSelectedAccount).toHaveBeenCalledTimes(1)
    expect(portfolio.updateSelectedAccount).toHaveBeenCalledWith(BASE_ACCOUNT_ADDR, [network])
  })

  it('deduplicates transaction hashes found in outgoing and incoming logs', async () => {
    const receipt = { hash: BASE_TXN_HASH }
    const provider = {
      getBlockNumber: jest.fn(async () => 300),
      getLogs: jest.fn(async () => [{ transactionHash: BASE_TXN_HASH }]),
      getTransactionReceipt: jest.fn(async () => receipt)
    }
    const { activity, controller } = createController({ provider })

    const result = await controller.scanLogs({
      accAddr: BASE_ACCOUNT_ADDR,
      chainId: BASE_CHAIN_ID,
      fromBlock: 299
    })

    expect(result).toEqual({ nextFromBlock: 301, txnIds: [BASE_TXN_HASH] })
    expect(provider.getTransactionReceipt).toHaveBeenCalledTimes(1)
    expect(activity.addExternalAccountOp).toHaveBeenCalledTimes(1)
  })

  it('returns null and emits a silent error when log scanning fails', async () => {
    const rpcError = new Error('RPC log scan failed')
    const provider = {
      getBlockNumber: jest.fn(async () => 400),
      getLogs: jest
        .fn()
        .mockImplementationOnce(async () => {
          throw rpcError
        })
        .mockImplementationOnce(async () => []),
      getTransactionReceipt: jest.fn()
    }
    const { activity, controller, portfolio } = createController({ provider })
    const errorHandler = jest.fn()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    controller.onError(errorHandler)

    const result = await controller.scanLogs({
      accAddr: BASE_ACCOUNT_ADDR,
      chainId: BASE_CHAIN_ID,
      fromBlock: 399
    })

    expect(result).toBeNull()
    expect(errorHandler).toHaveBeenCalledWith({
      level: 'silent',
      message: `Failed to scan token transfer logs on network with id ${BASE_CHAIN_ID}.`,
      error: rpcError
    })
    expect(provider.getTransactionReceipt).not.toHaveBeenCalled()
    expect(activity.addExternalAccountOp).not.toHaveBeenCalled()
    expect(portfolio.updateSelectedAccount).not.toHaveBeenCalled()

    consoleLogSpy.mockRestore()
  })

  it('returns null and emits a silent error when getBlockNumber times out', async () => {
    jest.useFakeTimers()
    const provider = {
      getBlockNumber: jest.fn(() => new Promise(() => undefined)),
      getLogs: jest.fn(async () => []),
      getTransactionReceipt: jest.fn()
    }
    const { activity, controller, portfolio } = createController({ provider })
    const errorHandler = jest.fn()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    controller.onError(errorHandler)

    try {
      const resultPromise = controller.scanLogs({
        accAddr: BASE_ACCOUNT_ADDR,
        chainId: BASE_CHAIN_ID,
        fromBlock: 399
      })

      await jest.advanceTimersByTimeAsync(10000)

      await expect(resultPromise).resolves.toBeNull()
      expect(errorHandler).toHaveBeenCalledWith({
        level: 'silent',
        message: `Failed to scan token transfer logs on network with id ${BASE_CHAIN_ID}.`,
        error: new Error('Transfer scanner getBlockNumber RPC timed out after 10000ms')
      })
      expect(provider.getLogs).not.toHaveBeenCalled()
      expect(provider.getTransactionReceipt).not.toHaveBeenCalled()
      expect(activity.addExternalAccountOp).not.toHaveBeenCalled()
      expect(portfolio.updateSelectedAccount).not.toHaveBeenCalled()
    } finally {
      consoleLogSpy.mockRestore()
      jest.useRealTimers()
    }
  })

  it('returns null and emits a silent error when receipt fetching fails', async () => {
    const receiptError = new Error('RPC receipt failed')
    const provider = {
      getBlockNumber: jest.fn(async () => 400),
      getLogs: jest.fn(async () => [{ transactionHash: BASE_TXN_HASH }]),
      getTransactionReceipt: jest.fn(async () => {
        throw receiptError
      })
    }
    const { activity, controller, portfolio } = createController({ provider })
    const errorHandler = jest.fn()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    controller.onError(errorHandler)

    const result = await controller.scanLogs({
      accAddr: BASE_ACCOUNT_ADDR,
      chainId: BASE_CHAIN_ID,
      fromBlock: 399
    })

    expect(result).toBeNull()
    expect(errorHandler).toHaveBeenCalledWith({
      level: 'silent',
      message: `Failed to scan token transfer receipts on network with id ${BASE_CHAIN_ID}.`,
      error: receiptError
    })
    expect(provider.getTransactionReceipt).toHaveBeenCalledWith(BASE_TXN_HASH)
    expect(activity.addExternalAccountOp).not.toHaveBeenCalled()
    expect(portfolio.updateSelectedAccount).not.toHaveBeenCalled()

    consoleLogSpy.mockRestore()
  })

  it('returns null and emits a silent error when a matching log has no receipt yet', async () => {
    const provider = {
      getBlockNumber: jest.fn(async () => 400),
      getLogs: jest.fn(async () => [{ transactionHash: BASE_TXN_HASH }]),
      getTransactionReceipt: jest.fn(async () => null)
    }
    const { activity, controller, portfolio } = createController({ provider })
    const errorHandler = jest.fn()
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    controller.onError(errorHandler)

    const result = await controller.scanLogs({
      accAddr: BASE_ACCOUNT_ADDR,
      chainId: BASE_CHAIN_ID,
      fromBlock: 399
    })

    expect(result).toBeNull()
    expect(errorHandler).toHaveBeenCalledWith({
      level: 'silent',
      message: `Failed to scan token transfer receipts on network with id ${BASE_CHAIN_ID}.`,
      error: new Error(`Transaction receipt ${BASE_TXN_HASH} was not found`)
    })
    expect(activity.addExternalAccountOp).not.toHaveBeenCalled()
    expect(portfolio.updateSelectedAccount).not.toHaveBeenCalled()

    consoleLogSpy.mockRestore()
  })

  it('keeps the earlier pending cursor when restarting a scan loop for the same chain and account', async () => {
    const waitMock = wait as jest.MockedFunction<typeof wait>
    const firstLoopWait = createDeferred()
    waitMock.mockImplementationOnce(() => firstLoopWait.promise)

    const { controller } = createController()
    const scanLogsSpy = jest
      .spyOn(controller, 'scanLogs')
      .mockImplementation(async ({ fromBlock }) => ({
        nextFromBlock: fromBlock === 'latest' ? 101 : Number(fromBlock) + 1,
        txnIds: []
      }))

    const firstLoopPromise = controller.startScanLogsLoop({
      accAddr: BASE_ACCOUNT_ADDR,
      chainId: BASE_CHAIN_ID,
      fromBlock: 100
    })
    await Promise.resolve()

    expect(scanLogsSpy).toHaveBeenNthCalledWith(1, {
      accAddr: BASE_ACCOUNT_ADDR,
      chainId: BASE_CHAIN_ID,
      fromBlock: 100
    })

    const secondLoopPromise = controller.startScanLogsLoop({
      accAddr: BASE_ACCOUNT_ADDR,
      chainId: BASE_CHAIN_ID,
      fromBlock: 200
    })
    await Promise.resolve()

    expect(scanLogsSpy).toHaveBeenNthCalledWith(2, {
      accAddr: BASE_ACCOUNT_ADDR,
      chainId: BASE_CHAIN_ID,
      fromBlock: 101
    })

    firstLoopWait.resolve()
    await Promise.all([firstLoopPromise, secondLoopPromise])
  })
})
