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
const SCAN_LOGS_DELAY = 12000

type LogsBlockTag = number | 'latest'

type ScanLogsParams = {
  accAddr: string
  chainId: Network['chainId']
  fromBlock: number
  toBlock?: LogsBlockTag
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
    fromBlock,
    toBlock = 'latest'
  }: ScanLogsParams): Promise<ScanLogsResult | null> {
    await this.#networks.initialLoadPromise
    await this.#providers.initialLoadPromise

    const chainIdString = chainId.toString()
    const provider = this.#providers.providers[chainIdString]
    const network = this.#networks.networks.find((n) => n.chainId === chainId)
    if (!provider || !network) return null

    const toBlockNumber = toBlock === 'latest' ? await provider.getBlockNumber() : Number(toBlock)
    const nextFromBlock = toBlockNumber + 1
    const [logsOut, logsIn] = await Promise.all([
      provider.getLogs({
        fromBlock,
        toBlock: toBlockNumber,
        topics: [
          ERC20_TRANSFER_TOPIC,
          topicAddress(accAddr) // indexed from
        ]
      }),
      provider.getLogs({
        fromBlock,
        toBlock: toBlockNumber,
        topics: [
          ERC20_TRANSFER_TOPIC,
          null,
          topicAddress(accAddr) // indexed to
        ]
      })
    ])

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

  startScanLogsLoop({ accAddr, chainId, fromBlock }: Omit<ScanLogsParams, 'toBlock'>) {
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
          fromBlock: nextFromBlock,
          toBlock: 'latest'
        })
        if (result) nextFromBlock = result.nextFromBlock
      } catch (error) {
        this.emitError({
          level: 'silent',
          message: `Failed to scan token transfer logs on network with id ${chainIdString}.`,
          error: error instanceof Error ? error : new Error(String(error))
        })
      }

      if (i < SCAN_LOGS_ATTEMPTS - 1) await wait(SCAN_LOGS_DELAY)
    }

    if (this.#activeScanLoopIdsByChain[chainIdString] === scanLoopId) {
      this.#activeScanLoopIdsByChain[chainIdString] = undefined
    }
  }
}
