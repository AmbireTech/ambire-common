import { isAddress } from 'ethers'

import { getTornadoCashBundlerUrl, TORNADO_CASH_CHAIN_ID } from '../../consts/tornadoCash'
import { Fetch } from '../../interfaces/fetch'
import {
  TornadoCashOperation,
  TornadoCashPaymasterWithdrawal,
  TornadoCashPlugin
} from '../../interfaces/tornadoCash'
import { pickTornadoCashNotes, TornadoCashNoteCount } from '../../libs/tornadoCash/amounts'
import { getTornadoCashPool } from '../../libs/tornadoCash/deposit'
import { readTornadoCashPaymasterWithdrawal } from '../../libs/tornadoCash/paymasterWithdrawal'
import { tornadoCashErrors } from './errors'

/** How often a broadcast withdrawal's receipt is asked for. */
const RECEIPT_POLL_INTERVAL_MS = 4 * 1000

/** After this long without a receipt, the withdrawal is reported as not confirmed. */
const RECEIPT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Prices in a signed withdrawal go stale. Past this age it is proved again rather than broadcast
 * with a fee the bundler may refuse.
 */
const MAX_READY_AGE_MS = 60 * 1000

export type TornadoCashWithdrawalParams = {
  /** The wallet's address of the asset: the zero address for ETH. */
  assetAddress: string
  amount: bigint
  recipient: string
}

type WithdrawalContext = {
  fetch: Fetch
  getSelectedSeedId: () => string | null
  /** The selected account's notes per pool, or null before its first sync. */
  getOwnedNotes: () => TornadoCashNoteCount[] | null
  withPlugin: <T>(seedId: string, action: (plugin: TornadoCashPlugin) => Promise<T>) => Promise<T>
  /** Whether the account the operation was built for is still the one in use. */
  getGeneration: () => number
  onSent: () => void
  emitUpdate: () => void
}

/**
 * Sends from a Tornado Cash account: proves and signs the withdrawal in the plugin, checks it
 * (`readTornadoCashPaymasterWithdrawal`), then broadcasts it to the bundler, which the paymaster
 * pays from the notes. One at a time; nothing of it is stored, as it would link the account to
 * the recipient.
 */
export class TornadoCashWithdrawal {
  #ctx: WithdrawalContext

  #signed: { withdrawal: TornadoCashPaymasterWithdrawal; signedAt: number } | null = null

  #receiptTimeout: ReturnType<typeof setTimeout> | null = null

  operation: TornadoCashOperation | null = null

  constructor(ctx: WithdrawalContext) {
    this.#ctx = ctx
  }

  get isInFlight() {
    return this.operation?.status === 'pending'
  }

  async prepare({ assetAddress, amount, recipient }: TornadoCashWithdrawalParams) {
    const seedId = this.#ctx.getSelectedSeedId()
    if (!seedId) throw tornadoCashErrors.noAccountSelected()
    if (this.isInFlight && this.operation?.phase !== 'ready')
      throw tornadoCashErrors.withdrawalInProgress()
    if (!isAddress(recipient)) throw tornadoCashErrors.withdrawalInvalidRecipient()

    const ownedNotes = this.#ctx.getOwnedNotes()
    const pickedNotes = ownedNotes && pickTornadoCashNotes(ownedNotes, amount)
    if (!pickedNotes) throw tornadoCashErrors.withdrawalAmountNotSendable()

    const [firstPool] = pickedNotes
    if (!firstPool) throw tornadoCashErrors.withdrawalAmountNotSendable()

    const generation = this.#ctx.getGeneration()
    this.#signed = null
    this.operation = {
      id: Date.now(),
      phase: 'proving',
      status: 'pending',
      assetAddress,
      symbol: firstPool.pool.symbol,
      decimals: firstPool.pool.decimals,
      recipient,
      amount,
      fee: null,
      recipientReceives: null,
      notesCount: pickedNotes.reduce((sum, { count }) => sum + count, 0),
      error: null,
      userOpHash: null
    }
    this.#ctx.emitUpdate()

    try {
      const withdrawals = await this.#ctx.withPlugin(seedId, (plugin) =>
        plugin.prepareUnshield({ assetAddress, amount, recipient })
      )
      if (generation !== this.#ctx.getGeneration()) return

      const [withdrawal, ...extraWithdrawals] = withdrawals
      if (!withdrawal || extraWithdrawals.length)
        throw new Error('tornadoCash: the SDK built more than one withdrawal')

      const summary = readTornadoCashPaymasterWithdrawal({ withdrawal, assetAddress, recipient })
      if (summary.amount !== amount)
        throw new Error('tornadoCash: the withdrawal is of another amount')

      this.#signed = { withdrawal, signedAt: Date.now() }
      this.operation = {
        ...this.operation,
        phase: 'ready',
        fee: summary.fee,
        recipientReceives: summary.recipientReceives
      }
    } catch (error: any) {
      if (generation !== this.#ctx.getGeneration()) return

      this.#fail(tornadoCashErrors.withdrawalNotPrepared().message)
      throw tornadoCashErrors.withdrawalNotPrepared(error)
    } finally {
      this.#ctx.emitUpdate()
    }
  }

  async broadcast(): Promise<void> {
    const operation = this.operation
    const signed = this.#signed
    if (!operation || operation.phase !== 'ready' || !signed)
      throw tornadoCashErrors.withdrawalNotReady()

    if (Date.now() - signed.signedAt > MAX_READY_AGE_MS) {
      await this.prepare(operation)
      return this.broadcast()
    }

    const generation = this.#ctx.getGeneration()
    this.operation = { ...operation, phase: 'broadcasting' }
    this.#ctx.emitUpdate()

    let userOpHash: string
    try {
      userOpHash = await this.#bundlerRequest<string>('eth_sendUserOperation', [
        signed.withdrawal.userOperation,
        signed.withdrawal.entryPointAddress
      ])
    } catch (error: any) {
      if (generation !== this.#ctx.getGeneration()) return

      this.#fail(tornadoCashErrors.withdrawalNotSent().message)
      this.#ctx.emitUpdate()
      throw tornadoCashErrors.withdrawalNotSent(error)
    }

    this.#signed = null
    this.operation = { ...this.operation!, phase: 'finalizing', userOpHash }
    this.#ctx.emitUpdate()
    this.#ctx.onSent()
    this.#waitForReceipt(userOpHash, Date.now(), generation)
  }

  #waitForReceipt(userOpHash: string, sentAt: number, generation: number) {
    this.#clearReceiptTimeout()
    this.#receiptTimeout = setTimeout(async () => {
      this.#receiptTimeout = null
      if (generation !== this.#ctx.getGeneration() || this.operation?.userOpHash !== userOpHash)
        return

      let receipt: { success?: boolean } | null = null
      try {
        receipt = await this.#bundlerRequest('eth_getUserOperationReceipt', [userOpHash])
      } catch {
        // Asked again until the timeout: a bundler hiccup says nothing about the withdrawal
      }
      if (generation !== this.#ctx.getGeneration() || this.operation?.userOpHash !== userOpHash)
        return

      if (receipt) {
        this.operation = {
          ...this.operation,
          status: receipt.success ? 'success' : 'failed',
          error: receipt.success ? null : tornadoCashErrors.withdrawalReverted().message
        }
        this.#ctx.emitUpdate()
        this.#ctx.onSent()
        return
      }

      if (Date.now() - sentAt > RECEIPT_TIMEOUT_MS) {
        this.#fail(tornadoCashErrors.withdrawalNotConfirmed().message)
        this.#ctx.emitUpdate()
        return
      }

      this.#waitForReceipt(userOpHash, sentAt, generation)
    }, RECEIPT_POLL_INTERVAL_MS)
  }

  async #bundlerRequest<T>(method: string, params: unknown[]): Promise<T> {
    const response = await this.#ctx.fetch(getTornadoCashBundlerUrl(TORNADO_CASH_CHAIN_ID), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    })
    const body = await response.json()
    if (body.error) throw new Error(`tornadoCash: bundler ${method} failed: ${body.error.message}`)

    return body.result as T
  }

  #fail(error: string) {
    if (!this.operation) return
    this.#signed = null
    this.operation = { ...this.operation, status: 'failed', error }
  }

  #clearReceiptTimeout() {
    if (!this.#receiptTimeout) return
    clearTimeout(this.#receiptTimeout)
    this.#receiptTimeout = null
  }

  /** Drops a finished or unsent operation. One being sent keeps being followed. */
  dismiss() {
    if (this.operation?.phase === 'broadcasting' || this.operation?.phase === 'finalizing') {
      if (this.operation.status === 'pending') return
    }

    this.#signed = null
    this.operation = null
  }

  /** On lock or another account: forgets everything, including an operation being followed. */
  clear() {
    this.#clearReceiptTimeout()
    this.#signed = null
    this.operation = null
  }
}

/** The notes per pool of a set of notes, for `pickTornadoCashNotes`. */
export const countNotesPerPool = (poolAddresses: string[]): TornadoCashNoteCount[] => {
  const counts = new Map<string, TornadoCashNoteCount>()
  poolAddresses.forEach((poolAddress) => {
    const pool = getTornadoCashPool(poolAddress)
    if (!pool) return

    const count = counts.get(pool.address)
    if (count) count.count += 1
    else counts.set(pool.address, { pool, count: 1 })
  })

  return [...counts.values()]
}
