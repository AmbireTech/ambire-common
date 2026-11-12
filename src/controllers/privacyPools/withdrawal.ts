import { isAddress } from 'ethers'

import { createPPv1Broadcaster, PrivacyPoolsV1Protocol } from '@kohaku-eth/privacy-pools'

import EmittableError from '../../classes/EmittableError'
import {
  getPrivacyPoolsAsset,
  getPrivacyPoolsChainConfig,
  getPrivacyPoolsTokenId,
  isPrivacyPoolsNativeAsset,
  PRIVACY_POOLS_DEPOSIT_CHIPS,
  toPrivacyPoolsAssetAddress
} from '../../consts/privacyPools'
import { Hex } from '../../interfaces/hex'
import {
  PrivacyPoolsNote,
  PrivacyPoolsOperation,
  PrivacyPoolsPaymasterConfig,
  PrivacyPoolsWithdrawalPrivacy,
  PrivacyPoolsWithdrawalPrivacyCheck,
  PrivacyPoolsWithdrawalPrivacyParams
} from '../../interfaces/privacyPools'
import { RPCProvider } from '../../interfaces/provider'
import { humanizePrivacyPoolsWithdrawal } from '../../libs/humanizer/modules/PrivacyPools/privacyPoolsModule'
import { readEntrypointAssetConfig } from '../../libs/privacyPools/entrypointAssetConfig'
import {
  estimatePaymasterWithdrawalFee,
  PrivacyPoolsSerializedUserOperation,
  PrivacyPoolsWithdrawalFeeEstimate,
  PrivacyPoolsWithdrawalWouldFailError
} from '../../libs/privacyPools/estimateWithdrawal'
import { getPrivacyPoolsWithdrawalPrivacy } from '../../libs/privacyPools/leaks/leaks'
import {
  findSendablePrivacyPoolsNote,
  getSdkPickedPrivacyPoolsNote
} from '../../libs/privacyPools/notes'
import { readPaymasterWithdrawal } from '../../libs/privacyPools/paymasterWithdrawal'
import { toPrivacyPoolsSdkError } from '../../libs/privacyPools/sdkError'
import { getRpcProvider } from '../../services/provider'
import { generateUuid } from '../../utils/uuid'
import { withTimeout } from '../../utils/with-timeout'
import {
  AssetRef,
  getChainConfig,
  getChainProvider,
  PhraseScopedModule,
  PrivacyPoolsContext
} from './context'
import { privacyPoolsErrors } from './errors'
import { PrivacyPoolsPoolStatsReader } from './poolStats'
import { PrivacyPoolsProtocolRegistry } from './protocolRegistry'
import { PrivacyPoolsSync, readPrivacyPoolsNotes } from './sync'

/** After this, a proved withdrawal is shown with only its fee cap. */
const WITHDRAWAL_ESTIMATION_TIMEOUT_MS = 8 * 1000

/**
 * A proved withdrawal older than this is run again before it is sent: its gas price and the roots
 * it was proved against are fixed in it, while the chain moves on. Like the regular Send's
 * re-estimation interval.
 */
const WITHDRAWAL_RECHECK_AFTER_MS = 30 * 1000

/** Shown in the confirmation sheet when a proved withdrawal can no longer be sent as it is. */
const STALE_WITHDRAWAL_MESSAGE = 'This transfer has expired. Go back to prepare it again.'

/**
 * The SDK's error when the paymaster fee exceeds the withdrawn amount. Matched by wording: it has
 * no code, and arrives as a plain object (see `toPrivacyPoolsSdkError`).
 */
const FEE_ABOVE_AMOUNT_SDK_MESSAGE = 'Withdrawal amount too small to cover the sponsored gas fee'

/** Makes the fee-above-amount SDK error readable; passes anything else through as an `Error`. */
const toReadableWithdrawalError = (error: unknown) => {
  const sdkError = toPrivacyPoolsSdkError(error, 'privacyPools: withdrawal failed')
  if (!sdkError.message.includes(FEE_ABOVE_AMOUNT_SDK_MESSAGE)) return sdkError

  return privacyPoolsErrors.withdrawalFeeAboveAmount(sdkError)
}

const WITHDRAWAL_CANCELLED_MESSAGE = 'privacyPools: the withdrawal was cancelled'

const throwIfWithdrawalCancelled = (signal: AbortSignal) => {
  if (signal.aborted) throw new Error(WITHDRAWAL_CANCELLED_MESSAGE)
}

/** Waits for `promise`, but fails as soon as `signal` aborts. `promise` itself runs on. */
const untilWithdrawalCancelled = <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error(WITHDRAWAL_CANCELLED_MESSAGE))
    if (signal.aborted) {
      onAbort()
      return
    }

    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })

/** A withdrawal from the selected Privacy Pools account to any address. */
export type PrivacyPoolsWithdrawalParams = AssetRef & {
  chainId: string
  /** The deposit to send from. A send spends exactly one. */
  noteLabel: bigint
  amount: bigint
  recipient: string
}

/**
 * A withdrawal handed to the bundler. `isSent` when it went through while still the current
 * operation - not after a lock or a newer one replaced it. `blockNumber` is the block it landed
 * in, or null when it failed or the block is unknown.
 */
export type PrivacyPoolsBroadcastAttempt = {
  operation: PrivacyPoolsOperation
  isSent: boolean
  blockNumber: number | null
}

type WithdrawalSimulationParams = AssetRef & {
  chainId: string
  userOperation: PrivacyPoolsSerializedUserOperation
  paymaster: PrivacyPoolsPaymasterConfig
  recipient: string
  /** The fee locked into the proof. */
  fee: bigint
}

/**
 * A paymaster-sponsored withdrawal: an ERC-4337 userOp signed by its single-use sender. Narrowed
 * from the `prepareUnshield` union, as the SDK does not export the variant.
 */
type PreparedPaymasterWithdrawal = Extract<
  Awaited<ReturnType<PrivacyPoolsV1Protocol['prepareUnshield']>>,
  { mode: 'paymaster' }
>

/**
 * A proved-but-unsent withdrawal, with what was read from its payload and when it was last known to
 * go through: when proved, or when run again since.
 */
type PendingWithdrawal = {
  privateOp: PreparedPaymasterWithdrawal
  paymasterWithdrawal: ReturnType<typeof readPaymasterWithdrawal>
  checkedAt: number
}

/**
 * Running a proved withdrawal on the latest block: it 'ran', it 'would-fail', or it is
 * 'unavailable' - the node cannot run it, or did not answer in time.
 */
type WithdrawalSimulation =
  | { status: 'ran'; estimate: PrivacyPoolsWithdrawalFeeEstimate }
  | { status: 'would-fail' | 'unavailable'; error: Error | null }

/**
 * Withdrawals from Privacy Pools accounts: proving one, checking it again while it waits, and
 * sending it. One at a time across phrases.
 */
export class PrivacyPoolsWithdrawal implements PhraseScopedModule {
  #ctx: PrivacyPoolsContext

  #registry: PrivacyPoolsProtocolRegistry

  #sync: PrivacyPoolsSync

  #poolStatsReader: PrivacyPoolsPoolStatsReader

  /** The latest withdrawal of any phrase. */
  #operation: PrivacyPoolsOperation | null = null

  /** The proved-but-unsent withdrawal. Private: it holds the proof and the signed userOp. */
  #pendingWithdrawal: PendingWithdrawal | null = null

  /** Cancels the withdrawal being prepared, if any. See `dropUnsent`. */
  #preparationAbortController: AbortController | null = null

  /** The signal of the withdrawal proving now, which its proofs are cancelled by. */
  #provingSignal: AbortSignal | null = null

  /**
   * Settles once the last started withdrawal preparation has stopped. The SDK cannot be stopped
   * between proofs, nor an in-process proof midway, so a cancelled preparation may still run for a
   * while; the next one waits for it rather than prove beside it on the same plugin.
   */
  #preparationQueue: Promise<void> = Promise.resolve()

  /**
   * The Send form's latest check. Phrase-derived (see the README), so a lock drops it, as it tells
   * what the phrase's notes give away.
   */
  #privacyCheck: { seedId: string; check: PrivacyPoolsWithdrawalPrivacyCheck } | null = null

  constructor(
    ctx: PrivacyPoolsContext,
    registry: PrivacyPoolsProtocolRegistry,
    sync: PrivacyPoolsSync,
    poolStatsReader: PrivacyPoolsPoolStatsReader
  ) {
    this.#ctx = ctx
    this.#registry = registry
    this.#sync = sync
    this.#poolStatsReader = poolStatsReader
  }

  /** The latest withdrawal of any phrase - see `PrivacyPoolsController.operation`. */
  get operation(): PrivacyPoolsOperation | null {
    return this.#operation
  }

  get provingSignal(): AbortSignal | null {
    return this.#provingSignal
  }

  /**
   * The withdrawal half of `PrivacyPoolsController.prepareWithdrawal`, for an account already
   * checked to be available.
   */
  async prepare({
    seedId,
    chainId,
    tokenAddress,
    noteLabel,
    amount,
    recipient
  }: PrivacyPoolsWithdrawalParams & { seedId: string }): Promise<void> {
    const { paymaster } = getChainConfig(chainId)
    if (!paymaster) throw privacyPoolsErrors.withdrawalUnsupportedNetwork(chainId)

    this.#assertBundlerIsAllowed()

    // Not only in the form: a proof to a malformed or zero address would burn the funds
    if (!isAddress(recipient) || BigInt(recipient) === 0n)
      throw privacyPoolsErrors.withdrawalInvalidRecipient()

    // One at a time across phrases: only one proved withdrawal is kept
    if (this.#isOperationInFlight()) throw privacyPoolsErrors.withdrawalInFlight()

    this.#discardPending()

    const operation = this.#startOperation({
      seedId,
      chainId,
      tokenAddress,
      isNative: isPrivacyPoolsNativeAsset(tokenAddress),
      amount,
      recipient
    })
    const abortController = new AbortController()
    this.#preparationAbortController = abortController
    const { signal } = abortController
    const previousPreparation = this.#preparationQueue
    let finishPreparation = () => {}
    this.#preparationQueue = new Promise<void>((resolve) => {
      finishPreparation = resolve
    })

    try {
      // Not raced with the signal: a cancelled preparation must stop before this one proves
      await previousPreparation
      throwIfWithdrawalCancelled(signal)
      this.#provingSignal = signal

      const poolAddress = await this.#assertPoolIsSponsored(chainId, tokenAddress)
      throwIfWithdrawalCancelled(signal)

      // The SDK syncs before proving, outside the queue, so only wait for this account's sync of
      // the chain rather than run beside it on the same plugin. No sync of our own: it would only
      // double the wait. Stops waiting once cancelled, as a first sync can take minutes.
      await untilWithdrawalCancelled(
        this.#sync.getRunningSync(seedId, chainId) || Promise.resolve(),
        signal
      )

      const spentNote = { tokenAddress, noteLabel, amount }
      // Before proving, as a proof takes a while. Against the notes of the last sync, which the
      // SDK's own sync rarely changes - checked again against its notes after proving, also when
      // the chain has not synced yet.
      const syncedNotes = this.#getNotes(seedId, chainId)
      if (syncedNotes) this.#assertSdkSpendsNote(syncedNotes, spentNote)

      const protocol = await this.#registry.getProtocol(chainId, seedId)
      throwIfWithdrawalCancelled(signal)

      // Checked by `isAddress` above
      const sdkRecipient = recipient as Hex
      // Prices gas, proves and signs the userOp. Spends one deposit, which the SDK picks itself -
      // checked to be the chosen one. The unused gas is refunded to the recipient, which is the
      // SDK's default too, so a different default can't send it elsewhere.
      const privateOp = await protocol.prepareUnshield(
        {
          asset: { __type: 'erc20', contract: toPrivacyPoolsAssetAddress(tokenAddress) },
          amount
        },
        sdkRecipient,
        { mode: 'paymaster', refundRecipient: sdkRecipient }
      )

      // Only paymaster mode is asked for, so anything else means the SDK ignored it
      if (privateOp.mode !== 'paymaster')
        throw new Error('privacyPools: the withdrawal came back in an unsupported form')

      // The SDK synced before proving, so its notes may be newer than the last sync's
      const provedNotes = await readPrivacyPoolsNotes(protocol, false)
      this.#assertSdkSpendsNote(provedNotes, spentNote)

      const paymasterWithdrawal = readPaymasterWithdrawal({
        withdrawal: privateOp.withdrawal,
        paymaster,
        poolAddress,
        recipient,
        tokenAddress,
        amount
      })
      const { fee } = paymasterWithdrawal

      const feeEstimate = await this.#getExpectedWithdrawalFee({
        chainId,
        userOperation: privateOp.withdrawal.userOperation,
        paymaster,
        recipient,
        tokenAddress,
        fee
      })
      throwIfWithdrawalCancelled(signal)
      const expectedFeeAmount = feeEstimate?.expectedFee ?? null

      const privacy = this.#getWithdrawalPrivacy(
        { seedId, chainId, tokenAddress, noteLabel, amount, recipient },
        provedNotes
      )
      throwIfWithdrawalCancelled(signal)

      const isStillCurrent = this.#updateOperation({
        ...operation,
        phase: 'ready',
        quote: { feeAmount: fee, amountAfterFee: amount - fee, expectedFeeAmount },
        privacy,
        humanization: humanizePrivacyPoolsWithdrawal({
          chainId,
          withdrawal: paymasterWithdrawal,
          expectedFeeAmount,
          usdPrice: this.#ctx.getTokenPrice(chainId, tokenAddress)
        })
      })
      // Not kept if a lock or a cancel superseded it
      if (isStillCurrent)
        this.#pendingWithdrawal = { privateOp, paymasterWithdrawal, checkedAt: Date.now() }
    } catch (error: any) {
      // Whatever it failed with: the user left, so there is nothing to tell them
      if (!signal.aborted)
        this.#failOperation(
          operation,
          toReadableWithdrawalError(error),
          'The transfer could not be prepared. Please try again.'
        )
    } finally {
      if (this.#provingSignal === signal) this.#provingSignal = null
      if (this.#preparationAbortController === abortController)
        this.#preparationAbortController = null
      finishPreparation()
    }

    this.#ctx.emitUpdate()
  }

  /** The Send form's latest check, if it was made for this account. */
  getWithdrawalPrivacyCheck(seedId: string | null): PrivacyPoolsWithdrawalPrivacyCheck | null {
    if (this.#privacyCheck?.seedId !== seedId) return null

    return this.#privacyCheck.check
  }

  /** Checks the Send form's transfer and keeps the result in place of the previous one. */
  checkWithdrawalPrivacy(params: PrivacyPoolsWithdrawalPrivacyParams) {
    const privacy = this.#getWithdrawalPrivacy(params)
    const { seedId, ...checkedParams } = params
    this.#privacyCheck = { seedId, check: { ...checkedParams, privacy } }
  }

  /**
   * The privacy of a send from `notes`, by default the account's as of its last sync. Rated
   * `unchecked` before the pool's deposits are read. Null when the deposit cannot pay `amount`.
   */
  #getWithdrawalPrivacy(
    {
      seedId,
      chainId,
      tokenAddress,
      noteLabel,
      amount,
      recipient
    }: PrivacyPoolsWithdrawalPrivacyParams,
    notes: PrivacyPoolsNote[] | undefined = this.#getNotes(seedId, chainId)
  ): PrivacyPoolsWithdrawalPrivacy | null {
    const depositIndex = this.#poolStatsReader.getDepositIndex(chainId, tokenAddress)
    if (!notes) return null

    return getPrivacyPoolsWithdrawalPrivacy({
      amount,
      notes,
      tokenAddress,
      noteLabel,
      recipient,
      depositIndex,
      commonAmounts:
        PRIVACY_POOLS_DEPOSIT_CHIPS[getPrivacyPoolsTokenId(chainId, tokenAddress)] ?? []
    })
  }

  /**
   * Throws unless the SDK, given `amount`, spends the chosen deposit: it picks the deposit itself
   * and cannot be told which (see `getSdkPickedPrivacyPoolsNote`).
   *
   * TODO: delete once the SDK takes the deposit to spend, and pass it the chosen one instead.
   */
  #assertSdkSpendsNote(
    notes: PrivacyPoolsNote[],
    { tokenAddress, noteLabel, amount }: { tokenAddress: string; noteLabel: bigint; amount: bigint }
  ) {
    if (!findSendablePrivacyPoolsNote(notes, tokenAddress, noteLabel, amount))
      throw privacyPoolsErrors.withdrawalDepositUnavailable()

    if (getSdkPickedPrivacyPoolsNote(notes, tokenAddress, amount)?.label !== noteLabel)
      throw privacyPoolsErrors.withdrawalOtherDepositPicked()
  }

  /** The notes the privacy checks need, the spent ones too. Undefined before the chain's sync. */
  #getNotes(seedId: string, chainId: string): PrivacyPoolsNote[] | undefined {
    const state = this.#sync.getAccountChainStates(seedId)[chainId]
    if (!state) return undefined

    return [...state.notes, ...state.spentNotes]
  }

  /**
   * Runs the proved withdrawal of `operation` again, if it is due - see
   * `PrivacyPoolsController.recheckWithdrawal`.
   */
  async recheck(operation: PrivacyPoolsOperation | null): Promise<void> {
    const pendingWithdrawal = this.#pendingWithdrawal
    if (operation?.status !== 'pending' || operation.phase !== 'ready' || !pendingWithdrawal) return
    if (!this.#isDueForCheck(pendingWithdrawal)) return

    const { isStale, estimate } = await this.#checkWithdrawal(operation, pendingWithdrawal)
    // Sent, dropped or proved again meanwhile
    if (this.#pendingWithdrawal !== pendingWithdrawal) return

    if (isStale) {
      this.#failStaleWithdrawal(operation)
      return
    }
    // Not run, so it is still due: sending checks it again
    if (!estimate || !operation.quote) return

    this.#pendingWithdrawal = { ...pendingWithdrawal, checkedAt: Date.now() }
    const expectedFeeAmount = estimate.expectedFee
    this.#updateOperation({
      ...operation,
      quote: { ...operation.quote, expectedFeeAmount },
      humanization: humanizePrivacyPoolsWithdrawal({
        chainId: operation.chainId,
        withdrawal: pendingWithdrawal.paymasterWithdrawal,
        expectedFeeAmount,
        usdPrice: this.#ctx.getTokenPrice(operation.chainId, operation.tokenAddress)
      })
    })
    this.#ctx.emitUpdate()
  }

  /** Throws unless `operation` has a proved withdrawal waiting to be sent. */
  assertReadyToSend(
    operation: PrivacyPoolsOperation | null
  ): asserts operation is PrivacyPoolsOperation {
    this.#getPendingToSend(operation)
  }

  /**
   * Sends the proved withdrawal of `operation` to the bundler and waits for it. Null when it was
   * not handed over: it went stale, or a lock came while it was checked again.
   */
  async broadcast(operation: PrivacyPoolsOperation): Promise<PrivacyPoolsBroadcastAttempt | null> {
    const pendingWithdrawal = this.#getPendingToSend(operation)
    this.#assertBundlerIsAllowed()
    const { seedId } = operation

    this.#updateOperation({ ...operation, phase: 'broadcasting' })
    this.#ctx.emitUpdate()

    // Sent once: the sender is single-use (nonce 0), so a retry could only fail or duplicate. A
    // failed send is prepared again from scratch.
    this.#discardPending()
    const { privateOp } = pendingWithdrawal

    if (
      this.#isDueForCheck(pendingWithdrawal) &&
      (await this.#checkWithdrawal(operation, pendingWithdrawal)).isStale
    ) {
      // Nothing was sent: the sheet says so and goes back to the form, to prove it again
      this.#failStaleWithdrawal(operation)
      return null
    }

    // A lock while checking: not sent, as nothing derived from the phrase may outlive it
    if (this.#operation?.id !== operation.id) return null

    try {
      const host = this.#registry.getHost(operation.chainId, seedId)
      // No relayers: a paymaster withdrawal goes to the bundler URL carried in the payload.
      const broadcaster = createPPv1Broadcaster(host, { broadcasterUrl: {} })
      const { requestId } = await broadcaster.broadcast(privateOp)

      const isCurrentOperation = this.#updateOperation({
        ...operation,
        status: 'success',
        phase: 'finalizing'
      })
      this.#ctx.emitUpdate()

      // After the UI is told, as the sheet need not wait for it
      const blockNumber = await this.#readBlockNumber(
        requestId,
        operation.chainId,
        privateOp.withdrawal.bundlerUrl
      )

      return { operation, isSent: isCurrentOperation, blockNumber }
    } catch (error: any) {
      // Silent: the confirmation sheet is open and shows the error itself
      this.#failOperation(
        { ...operation, phase: 'broadcasting' },
        error,
        'We could not confirm the transfer yet. Check your balance before you send it again.',
        'silent'
      )
      this.#ctx.emitUpdate()

      return { operation, isSent: false, blockNumber: null }
    }
  }

  /**
   * The block a sent withdrawal landed in, or null if unknown. Asks the bundler the withdrawal was
   * sent to, not our RPC, so our RPC cannot link the user's IP to the withdrawal.
   */
  async #readBlockNumber(
    userOpHash: string,
    chainId: string,
    bundlerUrl: string
  ): Promise<number | null> {
    let provider: RPCProvider | undefined

    try {
      provider = getRpcProvider([bundlerUrl], BigInt(chainId))
      const receipt = await provider.send('eth_getUserOperationReceipt', [userOpHash])
      // A hex string
      const blockNumber = Number(receipt?.receipt?.blockNumber)
      if (!Number.isSafeInteger(blockNumber))
        throw new Error('privacyPools: the bundler returned no block for the withdrawal')

      return blockNumber
    } catch (error: any) {
      this.#ctx.emitError({
        level: 'silent',
        message: 'Could not read the block of the Privacy Pools withdrawal.',
        error: error instanceof Error ? error : new Error('privacyPools: block read failed')
      })

      return null
    } finally {
      provider?.destroy()
    }
  }

  /**
   * Drops a withdrawal not sent yet: cancels one being proved and forgets a proved one, whose proof
   * is for a form no longer shown. One being sent is left to finish. Returns whether there was one.
   */
  dropUnsent(): boolean {
    this.#preparationAbortController?.abort()
    this.#preparationAbortController = null

    const operation = this.#operation
    if (operation?.status !== 'pending' || operation.phase === 'broadcasting') return false

    this.#operation = null
    this.#discardPending()

    return true
  }

  /** Forgets the operation unless it is in flight. Returns whether it did. */
  dismiss(): boolean {
    if (this.#isOperationInFlight()) return false

    this.#operation = null
    this.#discardPending()

    return true
  }

  /** Drops the Send form's check. Returns whether there was one. */
  dropPrivacyCheck(): boolean {
    const hadCheck = !!this.#privacyCheck
    this.#privacyCheck = null

    return hadCheck
  }

  hasPhraseDerivedState(): boolean {
    return !!this.#pendingWithdrawal || !!this.#preparationAbortController || !!this.#privacyCheck
  }

  /** Drops the account's withdrawal unless it is being sent, which is left to finish. */
  forgetSeed(seedId: string) {
    if (this.#operation?.seedId === seedId) this.dropUnsent()
    if (this.#privacyCheck?.seedId === seedId) this.dropPrivacyCheck()
  }

  /**
   * Drops the operation and its proof. A withdrawal being proved is cancelled; one being sent
   * cannot be stopped, and finds itself replaced when it ends.
   */
  clear() {
    this.#preparationAbortController?.abort()
    this.#preparationAbortController = null
    this.#operation = null
    this.#discardPending()
    this.dropPrivacyCheck()
  }

  #startOperation(params: {
    seedId: string
    chainId: string
    tokenAddress: string
    isNative: boolean
    amount: bigint
    recipient: string
  }): PrivacyPoolsOperation {
    const operation: PrivacyPoolsOperation = {
      id: generateUuid(),
      ...params,
      status: 'pending',
      phase: 'proving',
      startedAt: Date.now(),
      quote: null,
      humanization: null,
      privacy: null,
      error: null
    }

    this.#operation = operation
    this.#ctx.emitUpdate()

    return operation
  }

  /** Updates the operation unless a lock, a cancel or a newer one replaced it meanwhile. */
  #updateOperation(operation: PrivacyPoolsOperation): boolean {
    if (this.#operation?.id !== operation.id) return false

    this.#operation = operation

    return true
  }

  #isOperationInFlight() {
    return this.#operation?.status === 'pending' && this.#operation.phase !== 'ready'
  }

  #getPendingToSend(operation: PrivacyPoolsOperation | null): PendingWithdrawal {
    const pendingWithdrawal = this.#pendingWithdrawal
    if (operation && pendingWithdrawal) return pendingWithdrawal

    throw privacyPoolsErrors.withdrawalNotReady()
  }

  /**
   * The expected fee of a proved withdrawal, by simulating it, or null when it cannot be run.
   * Best effort: the proof's fee is already the cap. A simulated failure does not fail it here, as
   * the bundler checks it again.
   */
  async #getExpectedWithdrawalFee(
    params: WithdrawalSimulationParams
  ): Promise<PrivacyPoolsWithdrawalFeeEstimate | null> {
    const simulation = await this.#simulateWithdrawal(params)
    if (simulation.status === 'ran') return simulation.estimate

    if (simulation.error)
      this.#ctx.emitError({
        message: 'Could not work out the exact network fee, so the most it can cost is shown.',
        level: 'silent',
        error: simulation.error
      })

    return null
  }

  /** Runs a proved withdrawal on the latest block, as the bundler will submit it. */
  async #simulateWithdrawal({
    chainId,
    userOperation,
    paymaster,
    recipient,
    tokenAddress,
    fee
  }: WithdrawalSimulationParams): Promise<WithdrawalSimulation> {
    const network = this.#ctx.networks.networks.find((n) => n.chainId.toString() === chainId)
    // The sender only has code to run through a state override
    if (!network || network.rpcNoStateOverride) return { status: 'unavailable', error: null }

    try {
      const estimate = await withTimeout(
        () =>
          estimatePaymasterWithdrawalFee({
            provider: getChainProvider(this.#ctx.providers, chainId),
            userOperation,
            entryPointAddress: paymaster.entryPointAddress,
            paymasterAddress: paymaster.paymasterAddress,
            recipient,
            tokenAddress,
            fee
          }),
        {
          timeoutMs: WITHDRAWAL_ESTIMATION_TIMEOUT_MS,
          message: 'privacyPools: the withdrawal fee estimation timed out'
        }
      )

      return { status: 'ran', estimate }
    } catch (error: any) {
      return {
        status:
          error instanceof PrivacyPoolsWithdrawalWouldFailError ? 'would-fail' : 'unavailable',
        error:
          error instanceof Error
            ? error
            : new Error('privacyPools: withdrawal fee estimation failed')
      }
    }
  }

  /** Whether a proved withdrawal has gone unchecked long enough for the chain to have moved on. */
  #isDueForCheck({ checkedAt }: PendingWithdrawal) {
    return Date.now() - checkedAt >= WITHDRAWAL_RECHECK_AFTER_MS
  }

  /**
   * Runs a proved withdrawal again. Stale when it fails on the latest block (e.g. the association
   * set's root moved on), or the network's base fee has outgrown the gas price signed into it,
   * which no bundler would submit at. `estimate` is its fee as of now, when it could be run.
   *
   * One that cannot be checked is not stale: a stale one is refused by the bundler before anything
   * is spent, while calling it stale would send the user back to prove again over a flaky node.
   */
  async #checkWithdrawal(
    operation: PrivacyPoolsOperation,
    { privateOp }: PendingWithdrawal
  ): Promise<{ isStale: boolean; estimate: PrivacyPoolsWithdrawalFeeEstimate | null }> {
    const paymaster = getPrivacyPoolsChainConfig(BigInt(operation.chainId))?.paymaster
    if (!paymaster || !operation.quote) return { isStale: false, estimate: null }

    const { userOperation } = privateOp.withdrawal

    try {
      const latestBlock = await getChainProvider(this.#ctx.providers, operation.chainId).getBlock(
        'latest'
      )
      const baseFee = latestBlock?.baseFeePerGas
      if (baseFee != null && BigInt(userOperation.maxFeePerGas) < baseFee)
        return { isStale: true, estimate: null }
    } catch (error: any) {
      this.#ctx.emitError({
        message: 'Could not check the network fee of the transfer again.',
        level: 'silent',
        error: error instanceof Error ? error : new Error('privacyPools: base fee read failed')
      })
    }

    const simulation = await this.#simulateWithdrawal({
      chainId: operation.chainId,
      userOperation,
      paymaster,
      recipient: operation.recipient,
      tokenAddress: operation.tokenAddress,
      fee: operation.quote.feeAmount
    })
    if (simulation.status === 'ran') return { isStale: false, estimate: simulation.estimate }

    if (simulation.status === 'unavailable' && simulation.error)
      this.#ctx.emitError({
        message: 'Could not check the transfer again.',
        level: 'silent',
        error: simulation.error
      })

    return { isStale: simulation.status === 'would-fail', estimate: null }
  }

  /** Drops a stale withdrawal. Nothing was sent: the sheet says so and goes back to the form. */
  #failStaleWithdrawal(operation: PrivacyPoolsOperation) {
    this.#discardPending()
    this.#updateOperation({
      ...operation,
      status: 'failed',
      phase: 'ready',
      error: STALE_WITHDRAWAL_MESSAGE
    })
    this.#ctx.emitUpdate()
  }

  /** A transfer out goes through an ERC-4337 bundler, which the user can opt out of. */
  #assertBundlerIsAllowed() {
    if (this.#ctx.featureFlags.isFeatureEnabled('erc4337')) return

    throw privacyPoolsErrors.withdrawalBundlerOptedOut()
  }

  /**
   * Refuses before proving a token whose pool has no paymaster adapter (the SDK does so only after
   * syncing). The pool is read from the entrypoint, so a replaced pool is caught. Returns the pool,
   * which the proved withdrawal must be from.
   */
  async #assertPoolIsSponsored(chainId: string, tokenAddress: string): Promise<string> {
    const config = getPrivacyPoolsChainConfig(BigInt(chainId))
    if (!config?.paymaster) throw new Error(`privacyPools: no paymaster for chain ${chainId}`)

    const { poolAddress } = await readEntrypointAssetConfig({
      provider: getChainProvider(this.#ctx.providers, chainId),
      entrypointAddress: config.entrypointAddress,
      assetAddress: toPrivacyPoolsAssetAddress(tokenAddress)
    })

    if (config.paymaster.poolAdapters[poolAddress.toLowerCase()]) return poolAddress

    const symbol = getPrivacyPoolsAsset(BigInt(chainId), tokenAddress)?.symbol || 'this token'
    throw privacyPoolsErrors.withdrawalUnsupportedToken(symbol, poolAddress)
  }

  /** Drops the unsent withdrawal, so its proof is not sent later at a stale gas price. */
  #discardPending() {
    this.#pendingWithdrawal = null
  }

  /**
   * Shows an `EmittableError`'s message, or `fallback` for SDK, bundler and chain errors. Also as a
   * toast, unless `level` is 'silent' because the UI shows the failed operation itself - the error
   * is reported either way.
   */
  #failOperation(
    operation: PrivacyPoolsOperation,
    error: any,
    fallback: string,
    level: 'major' | 'silent' = 'major'
  ) {
    const message = error instanceof EmittableError ? error.message : fallback

    this.#updateOperation({ ...operation, status: 'failed', error: message })
    this.#ctx.emitError({
      message,
      level,
      error: toPrivacyPoolsSdkError(error, 'privacyPools: withdrawal failed')
    })
  }
}
