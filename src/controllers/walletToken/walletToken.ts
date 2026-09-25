import { Contract } from 'ethers'

import { WALLET_STAKING_ADDR } from '../../consts/addresses'
import { IActivityController } from '../../interfaces/activity'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { IProvidersController, RPCProvider } from '../../interfaces/provider'
import { IStorageController } from '../../interfaces/storage'
import { BindedRelayerCall } from '../../libs/relayerCall/relayerCall'
import {
  findWalletStakingLeaveLogsInTxns,
  getWalletStakingLeaveTxnIds,
  isValidWalletStakingTxnId
} from '../../libs/walletStaking/localWithdrawals'
import {
  getActivePendingWalletWithdrawals,
  getPendingWalletWithdrawalCommitmentId,
  getPendingWalletWithdrawalId,
  getPendingWalletWithdrawalSummary,
  getUniqueAccountWalletStakingLeaveLogs,
  LOG_LEAVE_TOPIC,
  parseWalletStakingRelayerLogsResponse,
  PendingWalletWithdrawal,
  WALLET_STAKING_COMMITMENT_RPC_TIMEOUT_MS,
  walletStakingInterface,
  WalletStakingRelayerLog
} from '../../libs/walletStaking/pendingWithdrawal'
import { WALLET_STAKING_CHAIN_ID } from '../../libs/walletStaking/shareValue'
import { withTimeout } from '../../utils/with-timeout'
import EventEmitter from '../eventEmitter/eventEmitter'

export const WALLET_STAKING_RELAYER_LOGS_TIMEOUT_MS = 5000

/** Why the transaction ID that the user entered didn't reveal a pending withdrawal. */
export type WalletStakingTxnIdLookupError = 'invalid' | 'not-found' | 'failed'

/** The pending $WALLET withdrawals (unstakes) of one account. */
export interface AccountPendingWalletWithdrawals {
  status: 'loading' | 'loaded' | 'error'
  /** The withdrawal that unlocks last - the one the staking screen shows. */
  latestWithdrawal: PendingWalletWithdrawal | null
  /** The shares of all active withdrawals, which the xWALLET balance must back. */
  totalShares: bigint
  txnIdLookupError: WalletStakingTxnIdLookupError | null
}

type LeaveLogsByAccount = { [accountAddr: string]: WalletStakingRelayerLog[] }

/**
 * Loads the pending $WALLET withdrawals (unstakes) of each account. The xWALLET conversion rate
 * that the portfolio shows is loaded by the portfolio itself (`getWalletStakingShareValue`).
 *
 * The withdrawals are found from the staking contract's leave logs. The relayer returns them,
 * but that sends the account address to the relayer, so the user can opt out
 * (`walletStakingWithdrawalsLookup`). Then the logs are read from the receipts of the unstake
 * transactions made from this device and of the transaction IDs that the user enters. The logs
 * of active withdrawals are stored, so a withdrawal found once stays known.
 */
export class WalletTokenController extends EventEmitter {
  #storage: IStorageController

  #featureFlags: IFeatureFlagsController

  #providers: IProvidersController

  #callRelayer: BindedRelayerCall

  #activity: IActivityController

  /** The stored leave logs, keyed by the lowercase account address. */
  #leaveLogs: LeaveLogsByAccount = {}

  #loadRequestIds = new Map<string, number>()

  #storageWriteQueue: Promise<void> = Promise.resolve()

  pendingWithdrawals: { [accountAddr: string]: AccountPendingWalletWithdrawals } = {}

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  constructor({
    eventEmitterRegistry,
    storage,
    featureFlags,
    providers,
    callRelayer,
    activity
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    storage: IStorageController
    featureFlags: IFeatureFlagsController
    providers: IProvidersController
    callRelayer: BindedRelayerCall
    /** Gives the unstake transactions made from this device. */
    activity: IActivityController
  }) {
    super(eventEmitterRegistry)
    this.#storage = storage
    this.#featureFlags = featureFlags
    this.#providers = providers
    this.#callRelayer = callRelayer
    this.#activity = activity

    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    try {
      this.#leaveLogs = await this.#storage.get('walletStakingLeaveLogs', {})
    } catch (error) {
      this.emitError({
        level: 'silent',
        message: 'Unable to load the stored $WALLET withdrawals.',
        error: error instanceof Error ? error : new Error('Unable to load the leave logs.')
      })
    }
  }

  /** Loads the account's pending $WALLET withdrawals into `pendingWithdrawals`. */
  async loadPendingWithdrawals(accountAddr: string) {
    await this.#refreshPendingWithdrawals(accountAddr, null)
  }

  /**
   * Looks for the account's pending withdrawal in a transaction that the user entered. The leave
   * logs found in it are stored, as if the relayer had returned them. The transaction ID itself
   * is not stored.
   */
  async findPendingWithdrawalInTxn(accountAddr: string, txnId: string) {
    const normalizedTxnId = txnId.trim().toLowerCase()
    if (!isValidWalletStakingTxnId(normalizedTxnId)) {
      this.#setAccountPendingWithdrawals(accountAddr, { txnIdLookupError: 'invalid' })
      return
    }

    this.#setAccountPendingWithdrawals(accountAddr, { status: 'loading', txnIdLookupError: null })

    let txnLeaveLogs: WalletStakingRelayerLog[] = []
    try {
      await this.initialLoadPromise
      const { results, errors } = await findWalletStakingLeaveLogsInTxns(
        [normalizedTxnId],
        accountAddr,
        this.#getEthereumProvider()
      )
      if (errors.length) throw errors[0]
      txnLeaveLogs = results[0]?.logs || []
    } catch (error) {
      this.emitError({
        level: 'silent',
        message: 'Unable to check the unstake transaction.',
        error: error instanceof Error ? error : new Error('Unable to check the transaction.')
      })
      this.#setAccountPendingWithdrawals(accountAddr, {
        status: this.pendingWithdrawals[accountAddr]?.latestWithdrawal ? 'loaded' : 'error',
        txnIdLookupError: 'failed'
      })
      return
    }

    if (!txnLeaveLogs.length) {
      this.#setAccountPendingWithdrawals(accountAddr, {
        status: 'loaded',
        txnIdLookupError: 'not-found'
      })
      return
    }

    // Kept in memory right away, so that a load that runs meanwhile also checks these logs. The
    // load stores them if their withdrawals are still active
    const accountKey = accountAddr.toLowerCase()
    this.#leaveLogs[accountKey] = [...(this.#leaveLogs[accountKey] || []), ...txnLeaveLogs]

    const txnWithdrawalIds = getUniqueAccountWalletStakingLeaveLogs(txnLeaveLogs, accountAddr).map(
      ({ withdrawal }) => getPendingWalletWithdrawalId(withdrawal)
    )
    await this.#refreshPendingWithdrawals(accountAddr, (activeWithdrawals) => {
      const activeWithdrawalIds = new Set(activeWithdrawals.map(getPendingWalletWithdrawalId))
      return txnWithdrawalIds.some((id) => activeWithdrawalIds.has(id)) ? null : 'not-found'
    })
  }

  /**
   * Finds the account's leave logs, checks which withdrawals are still committed in the staking
   * contract and updates the state. `getTxnIdLookupError` sets the lookup error of a transaction
   * that the user entered, based on the active withdrawals.
   */
  async #refreshPendingWithdrawals(
    accountAddr: string,
    getTxnIdLookupError:
      | ((activeWithdrawals: PendingWalletWithdrawal[]) => WalletStakingTxnIdLookupError | null)
      | null
  ) {
    const accountKey = accountAddr.toLowerCase()
    const requestId = (this.#loadRequestIds.get(accountKey) || 0) + 1
    this.#loadRequestIds.set(accountKey, requestId)
    const isStale = () => this.#loadRequestIds.get(accountKey) !== requestId

    this.#setAccountPendingWithdrawals(accountAddr, {
      status: 'loading',
      ...(!getTxnIdLookupError && { txnIdLookupError: null })
    })

    try {
      await this.initialLoadPromise
      const provider = this.#getEthereumProvider()
      const foundLeaveLogs = this.#featureFlags.isFeatureEnabled('walletStakingWithdrawalsLookup')
        ? await this.#getRelayerLeaveLogs(accountAddr)
        : await this.#getLocalTxnsLeaveLogs(accountAddr, provider)
      const leaveLogEntries = getUniqueAccountWalletStakingLeaveLogs(
        [...(this.#leaveLogs[accountKey] || []), ...foundLeaveLogs],
        accountAddr
      )
      const contract = new Contract(WALLET_STAKING_ADDR, walletStakingInterface, provider)
      const getCommitment = contract.commitments
      if (typeof getCommitment !== 'function') {
        throw new Error('Pending WALLET withdrawals are unavailable.')
      }
      const { activeWithdrawals, errors: commitmentErrors } =
        await getActivePendingWalletWithdrawals(
          leaveLogEntries.map(({ withdrawal }) => withdrawal),
          async (withdrawal) =>
            BigInt(
              await withTimeout(
                () =>
                  getCommitment(getPendingWalletWithdrawalCommitmentId(accountAddr, withdrawal)),
                {
                  timeoutMs: WALLET_STAKING_COMMITMENT_RPC_TIMEOUT_MS,
                  message: 'Pending WALLET withdrawals took too long to load.'
                }
              )
            )
        )
      if (isStale()) return

      commitmentErrors.forEach((error) => {
        this.emitError({
          level: 'silent',
          message: 'Unable to check a pending $WALLET withdrawal.',
          error: error instanceof Error ? error : new Error('Unable to check a commitment.')
        })
      })
      const { latestWithdrawal, totalShares } = getPendingWalletWithdrawalSummary(activeWithdrawals)
      this.#setAccountPendingWithdrawals(accountAddr, {
        status: commitmentErrors.length ? 'error' : 'loaded',
        latestWithdrawal,
        totalShares,
        ...(getTxnIdLookupError && { txnIdLookupError: getTxnIdLookupError(activeWithdrawals) })
      })

      // Withdrawn commitments are pruned, but only when every check succeeded, so that a failed
      // check doesn't drop a withdrawal that is still pending
      const activeWithdrawalIds = new Set(activeWithdrawals.map(getPendingWalletWithdrawalId))
      const leaveLogsToStore = commitmentErrors.length
        ? leaveLogEntries
        : leaveLogEntries.filter(({ withdrawal }) =>
            activeWithdrawalIds.has(getPendingWalletWithdrawalId(withdrawal))
          )
      await this.#storeLeaveLogs(
        accountKey,
        leaveLogsToStore.map(({ log }) => log)
      )
    } catch (error) {
      if (isStale()) return

      this.emitError({
        level: 'silent',
        message: 'Unable to load the pending $WALLET withdrawals.',
        error: error instanceof Error ? error : new Error('Unable to load the withdrawals.')
      })
      this.#setAccountPendingWithdrawals(accountAddr, {
        status: 'error',
        ...(getTxnIdLookupError && { txnIdLookupError: 'failed' })
      })
    }
  }

  async #getRelayerLeaveLogs(accountAddr: string) {
    const response = await this.#callRelayer(
      '/v2/identity/logs',
      'POST',
      {
        identity: accountAddr,
        address: WALLET_STAKING_ADDR,
        requestedTopic: LOG_LEAVE_TOPIC
      },
      undefined,
      WALLET_STAKING_RELAYER_LOGS_TIMEOUT_MS
    )

    return parseWalletStakingRelayerLogsResponse(response)
  }

  /**
   * Reads the leave logs from the receipts of the unstake transactions made from this device. A
   * receipt that fails to load is reported, and the other receipts are still used.
   */
  async #getLocalTxnsLeaveLogs(accountAddr: string, provider: RPCProvider) {
    const accountOps = await this.#activity.getInternalAccountOps(
      accountAddr,
      WALLET_STAKING_CHAIN_ID
    )
    const txnIds = getWalletStakingLeaveTxnIds(accountOps)
    if (!txnIds.length) return []

    const { results, errors } = await findWalletStakingLeaveLogsInTxns(
      txnIds,
      accountAddr,
      provider
    )
    errors.forEach((error) => {
      this.emitError({ level: 'silent', message: 'Unable to load an unstake transaction.', error })
    })

    return results.flatMap(({ logs }) => logs)
  }

  #getEthereumProvider() {
    const provider = this.#providers.providers[WALLET_STAKING_CHAIN_ID.toString()]
    if (!provider) throw new Error('walletToken: the Ethereum provider is not available')

    return provider
  }

  #setAccountPendingWithdrawals(
    accountAddr: string,
    update: Partial<AccountPendingWalletWithdrawals>
  ) {
    this.pendingWithdrawals[accountAddr] = {
      status: 'loading',
      latestWithdrawal: null,
      totalShares: 0n,
      txnIdLookupError: null,
      ...this.pendingWithdrawals[accountAddr],
      ...update
    }
    this.emitUpdate()
  }

  /** Stores the account's leave logs. The writes are queued, so they never run in parallel. */
  async #storeLeaveLogs(accountKey: string, logs: WalletStakingRelayerLog[]) {
    if (logs.length) this.#leaveLogs[accountKey] = logs
    else delete this.#leaveLogs[accountKey]

    this.#storageWriteQueue = this.#storageWriteQueue
      .then(() => this.#storage.set('walletStakingLeaveLogs', { ...this.#leaveLogs }))
      .catch((error) => {
        this.emitError({
          level: 'silent',
          message: 'Unable to store the pending $WALLET withdrawals.',
          error: error instanceof Error ? error : new Error('Unable to store the leave logs.')
        })
      })

    await this.#storageWriteQueue
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON()
    }
  }
}
