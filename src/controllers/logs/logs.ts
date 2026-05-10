/* eslint-disable no-await-in-loop */
import { TransactionReceipt } from 'ethers'

import { IActivityController } from '../../interfaces/activity'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { INetworksController, Network } from '../../interfaces/network'
import { IPortfolioController } from '../../interfaces/portfolio'
import { IProvidersController } from '../../interfaces/provider'
import wait from '../../utils/wait'
import EventEmitter from '../eventEmitter/eventEmitter'

const ERC20_TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const SCAN_LOGS_ATTEMPTS = 15

const getScanLogsDelay = (attemptIndex: number) => {
  if (attemptIndex < 10) return 6000
  if (attemptIndex < 13) return 12000
  return 18000
}

type ScanLogsParams = {
  accAddr: string
  chainId: Network['chainId']
  fromBlock?: number | 'latest'
}

type ScanLogsResult = {
  nextFromBlock: number
  txnIds: string[]
}

function topicAddress(address: string) {
  return `0x${address.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`
}

export class LogsController extends EventEmitter {
  #activity: IActivityController

  #networks: INetworksController

  #portfolio: IPortfolioController

  #providers: IProvidersController

  #scanLoopId = 0

  #activeScanLoopIdsByChain: { [chainId: string]: number | undefined } = {}

  constructor({
    activity,
    networks,
    portfolio,
    providers,
    eventEmitterRegistry
  }: {
    activity: IActivityController
    networks: INetworksController
    portfolio: IPortfolioController
    providers: IProvidersController
    eventEmitterRegistry?: IEventEmitterRegistryController
  }) {
    super(eventEmitterRegistry)
    this.#activity = activity
    this.#networks = networks
    this.#portfolio = portfolio
    this.#providers = providers
  }

  async scanLogs({
    accAddr,
    chainId,
    fromBlock = 'latest'
  }: ScanLogsParams): Promise<ScanLogsResult | null> {
    await this.#networks.initialLoadPromise
    await this.#providers.initialLoadPromise

    const chainIdString = chainId.toString()
    const provider = this.#providers.providers[chainIdString]
    const network = this.#networks.networks.find((n) => n.chainId === chainId)
    if (!provider || !network) return null

    const toBlockNumber = await provider.getBlockNumber()
    const normalizedFromBlock = fromBlock === 'latest' ? toBlockNumber : fromBlock

    // The next scan starts one block after the last scanned block. If the next
    // poll sees the same latest block, or a laggier RPC, the cursor can be ahead
    // of latest. In that case, skip getLogs and retry the same cursor later.
    if (normalizedFromBlock > toBlockNumber) {
      return { nextFromBlock: normalizedFromBlock, txnIds: [] }
    }

    const nextFromBlock = toBlockNumber + 1

    const [logsOut, logsIn] = await Promise.all([
      provider
        .getLogs({
          fromBlock: normalizedFromBlock,
          toBlock: toBlockNumber,
          topics: [
            ERC20_TRANSFER_TOPIC,
            topicAddress(accAddr) // indexed from
          ]
        })
        .catch((e) => e),
      provider
        .getLogs({
          fromBlock: normalizedFromBlock,
          toBlock: toBlockNumber,
          topics: [
            ERC20_TRANSFER_TOPIC,
            null,
            topicAddress(accAddr) // indexed to
          ]
        })
        .catch((e) => e)
    ])

    // if an error is encountered, retry from the same fromBlock
    // read @nextBlock+1
    if (logsOut instanceof Error || logsIn instanceof Error) {
      const error = logsOut instanceof Error ? logsOut : logsIn
      this.emitError({
        level: 'silent',
        message: `Failed to scan token transfer logs on network with id ${chainIdString}.`,
        error
      })
      return null
    }

    const txnIds = Array.from(
      new Set(
        [...logsOut, ...logsIn]
          .map((log) => log.transactionHash)
          .filter((txnId): txnId is string => !!txnId)
      )
    )

    if (!txnIds.length) return { nextFromBlock, txnIds }

    const receipts = (
      await Promise.all(
        txnIds.map((txnId) => provider.getTransactionReceipt(txnId).catch(() => null))
      )
    ).filter((receipt): receipt is TransactionReceipt => !!receipt)

    if (!receipts.length) return { nextFromBlock, txnIds }

    await Promise.all(
      receipts.map((receipt) =>
        this.#activity.addExternalAccountOp({
          accountAddr: accAddr,
          chainId,
          txnId: receipt.hash,
          receipt,
          shouldLearnTokens: true
        })
      )
    )

    await this.#portfolio.updateSelectedAccount(accAddr, [network])

    return { nextFromBlock, txnIds }
  }

  startScanLogsLoop({ accAddr, chainId, fromBlock = 'latest' }: Omit<ScanLogsParams, 'toBlock'>) {
    const chainIdString = chainId.toString()
    this.#scanLoopId += 1
    const scanLoopId = this.#scanLoopId
    this.#activeScanLoopIdsByChain[chainIdString] = scanLoopId

    return this.#runScanLogsLoop({ accAddr, chainId, fromBlock, scanLoopId })
  }

  async #runScanLogsLoop({
    accAddr,
    chainId,
    fromBlock,
    scanLoopId
  }: Omit<ScanLogsParams, 'toBlock'> & { scanLoopId: number }) {
    const chainIdString = chainId.toString()
    let nextFromBlock = fromBlock

    for (let i = 0; i < SCAN_LOGS_ATTEMPTS; i++) {
      if (this.#activeScanLoopIdsByChain[chainIdString] !== scanLoopId) return

      try {
        const result = await this.scanLogs({
          accAddr,
          chainId,
          fromBlock: nextFromBlock
        })
        if (result) nextFromBlock = result.nextFromBlock
      } catch (error) {
        this.emitError({
          level: 'silent',
          message: `Failed to scan token transfer logs on network with id ${chainIdString}.`,
          error: error instanceof Error ? error : new Error(String(error))
        })
      }

      if (i < SCAN_LOGS_ATTEMPTS - 1) await wait(getScanLogsDelay(i))
    }

    if (this.#activeScanLoopIdsByChain[chainIdString] === scanLoopId) {
      this.#activeScanLoopIdsByChain[chainIdString] = undefined
    }
  }
}
