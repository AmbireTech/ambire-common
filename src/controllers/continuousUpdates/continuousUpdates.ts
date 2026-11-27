import {
  IRecurringTimeout,
  RecurringTimeout
} from '../../classes/recurringTimeout/recurringTimeout'
import {
  ACCOUNT_STATE_STAND_BY_INTERVAL,
  ACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL,
  INACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL,
  ACTIVITY_REFRESH_INTERVAL,
  SAFE_MESSAGES_RESOLVE_ACTIVE_INTERVAL,
  SAFE_RESOLVE_INACTIVE_INTERVAL,
  SAFE_TXNS_RESOLVE_ACTIVE_INTERVAL,
  TRENDING_TOKENS_ACTIVE_UPDATE_INTERVAL,
  TRENDING_TOKENS_FAILED_UPDATE_INTERVAL
} from '../../consts/intervals'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { Hex } from '../../interfaces/hex'
import { IMainController } from '../../interfaces/main'
import { Network } from '../../interfaces/network'
import { CallsUserRequest } from '../../interfaces/userRequest'
import { getAccountOpNonce } from '../../libs/accountOp/accountOp'
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { getNetworksWithFailedRPC } from '../../libs/networks/networks'
import {
  getNextSafeResolvePollState,
  getSafeResolveTimeout,
  INITIAL_SAFE_RESOLVE_POLL_STATE,
  SafeResolvePollState,
  toSafeResolveFingerprint
} from '../../libs/safe/resolvePolling'
import { sortSigs } from '../../libs/safe/safe'
import EventEmitter from '../eventEmitter/eventEmitter'

/* eslint-disable @typescript-eslint/no-floating-promises */

/** How many consecutive failed trending tokens fetches are retried at the fast failed-retry
cadence before falling back to the normal one, so a long API outage isn't retried every minute. */
export const MAX_TRENDING_TOKENS_FAILED_RETRIES = 5

/**
 * What the user is doing with the wallet, which decides which timers run and how often. The
 * wallet is `background` when it is unlocked but no wallet window is open (the user closed the
 * popup), and `inUse` when it is unlocked and at least one window is open. Opening a second
 * window doesn't change the state.
 */
type WalletState = 'locked' | 'background' | 'inUse'

/**
 * Something that just happened, like the user sending a txn or switching the account. Unlike
 * the wallet state, an event doesn't last, so a timer reacts to it only at the moment it happens.
 */
type TimerEvent =
  | 'viewOpen'
  | 'viewFocus'
  | 'accountSwitch'
  | 'txnSent'
  | 'providersChange'
  | 'activityChange'

export type TimerName =
  | 'portfolio'
  | 'accountState'
  | 'failedRpcReFetch'
  | 'trendingTokens'
  | 'safeTxns'
  | 'safeMessages'
  | 'accountsOpsStatuses'

type Interval = number | (() => number)

type TimerSchedule = {
  /** The work the timer does each time it fires, like updating the portfolio */
  run: () => Promise<void>
  /**
   * How long to wait between runs in each wallet state. The timer doesn't run at all in a state
   * that is left out. For example, `{ background: 10 min, inUse: 2 min }` updates every 10
   * minutes while the popup is closed, every 2 minutes while it is open, and never while the
   * wallet is locked. When the state changes to one with a different interval, the timer starts
   * over with the new one at once. A function is called each time the timer starts, for an
   * interval that depends on data.
   */
  intervals: Partial<Record<WalletState, Interval>> & { inUse: Interval }
  /**
   * For a timer that is needed only sometimes. When this returns false, the timer stops even in
   * a state where it would run. For example, the txn status timer has work only while a sent
   * txn waits for confirmation.
   */
  hasWork?: () => boolean
  /**
   * Runs once as soon as the timer starts, instead of waiting a full interval first. For
   * example, trending tokens update the moment the user opens the wallet.
   */
  runOnStart?: boolean
  /**
   * Events after which the full wait starts again from now. Use it when the event already did
   * the work of the timer. For example, switching the account loads its portfolio, so the next
   * portfolio update waits a full interval instead of coming a few seconds later.
   */
  restartOn?: TimerEvent[]
  /**
   * Events after which a timer that has slowed down goes back to the interval of the state at
   * once. A timer that already runs at that interval is left alone, so the event can't push
   * its next run later. For example, a Safe check that slowed down to 30 seconds goes back to
   * 10 seconds when the user focuses the wallet, but a check that is 2 seconds away still runs
   * in 2 seconds.
   */
  speedUpOn?: TimerEvent[]
  /**
   * Events after which `hasWork` may give a different answer, so the timer starts or stops to
   * match it. A timer that already runs is left alone. For example, the txn status timer starts
   * when a txn is sent and stops when the last one is confirmed.
   */
  checkOn?: TimerEvent[]
  /**
   * For a timer that slows itself down in `run`. Undoes that slowdown before the timer starts
   * over or speeds up, otherwise its next run would pick the slow interval again. For example,
   * the Safe checks wait longer each time they find nothing new, and this sets that count back
   * to zero.
   */
  resetPace?: () => void
}

type TimerAction = 'start' | 'restart' | 'speedUp'

type Timer = TimerSchedule & { timer: IRecurringTimeout }

const toTimeout = (interval: Interval) => (typeof interval === 'function' ? interval() : interval)

export class ContinuousUpdatesController extends EventEmitter {
  #main: IMainController

  #timers: Record<TimerName, Timer>

  getTimer(name: TimerName) {
    return this.#timers[name].timer
  }

  #accountStateRetriesByNetwork: {
    [chainId: string]: number
  } = {}

  /** What the last checks for resolved Safe txns and messages found, to slow them down */
  #safeTxnsPollState: SafeResolvePollState = INITIAL_SAFE_RESOLVE_POLL_STATE

  #safeMessagesPollState: SafeResolvePollState = INITIAL_SAFE_RESOLVE_POLL_STATE

  #trendingTokensFailedRetries = 0

  #walletState: WalletState

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void> | undefined

  constructor({
    eventEmitterRegistry,
    main
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    main: IMainController
  }) {
    super(eventEmitterRegistry)

    this.#main = main
    this.#walletState = this.#getWalletState()

    const getAccountsOpsStatusesInterval = () =>
      this.#getAccountsOpsStatusesRefreshInterval(this.#getOpsWaitingForConfirmation())

    // The schedule of every background timer: how often it runs in each wallet state, and
    // which events restart it
    this.#timers = {
      portfolio: this.#createTimer('portfolio', {
        run: this.#updatePortfolio,
        intervals: {
          background: INACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL,
          inUse: ACTIVE_EXTENSION_PORTFOLIO_UPDATE_INTERVAL
        },
        restartOn: ['accountSwitch']
      }),
      accountState: this.#createTimer('accountState', {
        run: this.#updateAccountStateLatest,
        intervals: { inUse: ACCOUNT_STATE_STAND_BY_INTERVAL },
        restartOn: ['accountSwitch', 'txnSent']
      }),
      failedRpcReFetch: this.#createTimer('failedRpcReFetch', {
        run: this.#fastAccountStateReFetch,
        intervals: { inUse: 8000 },
        hasWork: () =>
          !!getNetworksWithFailedRPC({ providers: this.#main.providers.providers }).length,
        restartOn: ['providersChange']
      }),
      trendingTokens: this.#createTimer('trendingTokens', {
        run: this.#updateTrendingTokens,
        intervals: { inUse: TRENDING_TOKENS_ACTIVE_UPDATE_INTERVAL },
        runOnStart: true
      }),
      safeTxns: this.#createTimer('safeTxns', {
        run: this.#pollConfirmedSafeTxns,
        intervals: {
          background: SAFE_RESOLVE_INACTIVE_INTERVAL,
          inUse: SAFE_TXNS_RESOLVE_ACTIVE_INTERVAL
        },
        speedUpOn: ['viewOpen', 'viewFocus'],
        resetPace: () => {
          this.#safeTxnsPollState = { ...this.#safeTxnsPollState, unchangedChecksCount: 0 }
        }
      }),
      safeMessages: this.#createTimer('safeMessages', {
        run: this.#pollConfirmedSafeMessages,
        intervals: {
          background: SAFE_RESOLVE_INACTIVE_INTERVAL,
          inUse: SAFE_MESSAGES_RESOLVE_ACTIVE_INTERVAL
        },
        speedUpOn: ['viewOpen', 'viewFocus'],
        resetPace: () => {
          this.#safeMessagesPollState = { ...this.#safeMessagesPollState, unchangedChecksCount: 0 }
        }
      }),
      accountsOpsStatuses: this.#createTimer('accountsOpsStatuses', {
        run: this.#updateAccountsOpsStatuses,
        intervals: {
          locked: getAccountsOpsStatusesInterval,
          background: getAccountsOpsStatusesInterval,
          inUse: getAccountsOpsStatusesInterval
        },
        hasWork: () => !!this.#getOpsWaitingForConfirmation().length,
        checkOn: ['activityChange']
      })
    }

    this.#main.keystore.onUpdate(() => this.#setWalletState(), 'continuous-update')
    this.#main.ui.uiEvent.on('addView', () => {
      this.#setWalletState()
      this.#onEvent('viewOpen')
    })
    this.#main.ui.uiEvent.on('removeView', () => this.#setWalletState())
    this.#main.ui.uiEvent.on('viewFocus', () => this.#onEvent('viewFocus'))

    this.#main.swapAndBridge.onUpdate(() => {
      if (this.#main.swapAndBridge.signAccountOpController?.broadcastStatus === 'SUCCESS') {
        this.#onEvent('txnSent')
      }
    }, 'continuous-update')

    this.#main.transfer.onUpdate(() => {
      if (this.#main.transfer.signAccountOpController?.broadcastStatus === 'SUCCESS') {
        this.#onEvent('txnSent')
      }
    }, 'continuous-update')

    this.#main.requests.onUpdate(() => {
      if (this.#main.requests.currentUserRequest?.kind === 'calls') {
        if (
          !this.#main.requests.currentUserRequest.signAccountOp.onUpdateIds.includes(
            'continuous-update'
          )
        ) {
          this.#main.requests.currentUserRequest.signAccountOp.onUpdate(() => {
            if (
              this.#main.requests.currentUserRequest?.kind === 'calls' &&
              this.#main.requests.currentUserRequest.signAccountOp.broadcastStatus === 'SUCCESS'
            ) {
              this.#onEvent('txnSent')
            }
          }, 'continuous-update')
        }
      }
    }, 'continuous-update')

    this.#main.providers.onUpdate(() => this.#onEvent('providersChange'), 'continuous-update')
    this.#main.activity.onUpdate(() => this.#onEvent('activityChange'), 'continuous-update')

    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  async #load() {
    await this.#main.initialLoadPromise

    this.#walletState = this.#getWalletState()
    Object.values(this.#timers).forEach((timer) => this.#apply(timer, 'start'))
  }

  /** Creates the timer of a schedule. #apply sets its interval again on every start */
  #createTimer(name: TimerName, schedule: TimerSchedule): Timer {
    const timer = new RecurringTimeout(
      schedule.run.bind(this),
      toTimeout(schedule.intervals.inUse),
      this.emitError.bind(this),
      name
    )

    return { ...schedule, timer }
  }

  /** Starts the interval of the portfolio and account state timers over for the new account */
  onAccountSwitch() {
    this.#onEvent('accountSwitch')
  }

  #getWalletState(): WalletState {
    if (!this.#main.keystore.isUnlocked) return 'locked'

    return this.#isUiActive() ? 'inUse' : 'background'
  }

  /** Moves the timers to the new wallet state. Only the ones whose interval changes are touched */
  #setWalletState() {
    const previousState = this.#walletState
    const nextState = this.#getWalletState()
    if (nextState === previousState) return

    this.#walletState = nextState
    Object.values(this.#timers).forEach((timer) => {
      const previousInterval = timer.intervals[previousState]
      const nextInterval = timer.intervals[nextState]
      if (previousInterval === nextInterval) return

      this.#apply(timer, previousInterval === undefined ? 'start' : 'restart')
    })
  }

  #onEvent(event: TimerEvent) {
    Object.values(this.#timers).forEach((timer) => {
      if (timer.restartOn?.includes(event)) this.#apply(timer, 'restart')
      else if (timer.speedUpOn?.includes(event)) this.#apply(timer, 'speedUp')
      else if (timer.checkOn?.includes(event)) this.#apply(timer, 'start')
    })
  }

  /** Stops, starts or restarts a timer to match its schedule in the current wallet state */
  #apply({ timer, intervals, hasWork, runOnStart, resetPace }: Timer, action: TimerAction) {
    const interval = intervals[this.#walletState]
    if (interval === undefined || (hasWork && !hasWork())) {
      timer.stop()
      return
    }

    const timeout = toTimeout(interval)
    if (action === 'start') {
      timer.start({ timeout, runImmediately: runOnStart })
      return
    }

    resetPace?.()
    if (action === 'speedUp' && timer.running && timer.currentTimeout <= timeout) return

    // A restart during a run would let the next run start before this one ends, so the running
    // one schedules the next run with the new interval instead
    if (timer.promise) timer.updateTimeout({ timeout })
    else timer.restart({ timeout })
  }

  async #updatePortfolio() {
    await this.initialLoadPromise
    await Promise.all([
      this.#main.updateSelectedAccountPortfolio({
        maxDataAgeMs: 60 * 1000,
        maxDataAgeMsUnused: 60 * 60 * 1000
      }),
      // Only while a view is open, as a sync is much heavier than a portfolio update. Does nothing
      // unless a Privacy Pools account is selected and the wallet is unlocked.
      this.#isUiActive() ? this.#main.privacyPools.syncInBackground() : undefined
    ])
  }

  async #updateTrendingTokens() {
    await this.initialLoadPromise
    await this.#main.dapps.initialLoadPromise

    // Skip if the last successful update is still fresh — prevents redundant requests when the
    // background reloads multiple times within a short period (e.g. service worker wake-ups) and
    // makes "refresh on becoming active" a no-op unless the data is older than the current cadence.
    const updatedAt = this.#main.dapps.trendingTokensUpdatedAt
    const timeSinceLastUpdate = updatedAt ? Date.now() - updatedAt : null
    if (
      updatedAt &&
      timeSinceLastUpdate !== null &&
      timeSinceLastUpdate < this.#timers.trendingTokens.timer.currentTimeout
    ) {
      return
    }

    try {
      await this.#main.dapps.updateTrendingTokens()
      this.#trendingTokensFailedRetries = 0

      // Recover the normal cadence after a previously failed fetch bumped it down.
      if (
        this.#timers.trendingTokens.timer.currentTimeout === TRENDING_TOKENS_FAILED_UPDATE_INTERVAL
      ) {
        this.#timers.trendingTokens.timer.updateTimeout({
          timeout: TRENDING_TOKENS_ACTIVE_UPDATE_INTERVAL
        })
      }
    } catch (err) {
      this.#trendingTokensFailedRetries += 1
      const hasExhaustedRetries =
        this.#trendingTokensFailedRetries >= MAX_TRENDING_TOKENS_FAILED_RETRIES

      // Back off to the fast failed-retry cadence, but give up on it once the retries are
      // exhausted (the API is likely down for a while), then rethrow so RecurringTimeout's
      // onError handler reports it (with level 'silent', i.e. no user-facing toast).
      this.#timers.trendingTokens.timer.updateTimeout({
        timeout: hasExhaustedRetries
          ? TRENDING_TOKENS_ACTIVE_UPDATE_INTERVAL
          : TRENDING_TOKENS_FAILED_UPDATE_INTERVAL
      })
      throw err
    }
  }

  async #updateAccountsOpsStatuses() {
    try {
      await this.initialLoadPromise
      await this.#main.updateAccountsOpsStatuses()
    } finally {
      this.#timers.accountsOpsStatuses.timer.updateTimeout({
        timeout: Math.min(
          this.#timers.accountsOpsStatuses.timer.currentTimeout + 1000,
          ACTIVITY_REFRESH_INTERVAL
        )
      })
    }
  }

  #getOpsWaitingForConfirmation() {
    return Object.values(this.#main.activity.broadcastedButNotConfirmed).flat()
  }

  #getAccountsOpsStatusesRefreshInterval(accountOps: SubmittedAccountOp[]) {
    return accountOps.reduce((refreshInterval, accountOp) => {
      const networkRefreshInterval = this.#main.networks.networks.find(
        ({ chainId }) => chainId === accountOp.chainId
      )?.refreshInterval

      if (
        !networkRefreshInterval ||
        !Number.isFinite(networkRefreshInterval) ||
        networkRefreshInterval <= 0
      ) {
        return refreshInterval
      }

      return Math.min(refreshInterval, networkRefreshInterval)
    }, ACTIVITY_REFRESH_INTERVAL)
  }

  /**
   * Updates the account state for the selected account. Doesn't update the state for networks with failed RPC as this is handled by a different interval.
   */
  async #updateAccountStateLatest() {
    await this.initialLoadPromise
    await this.#main.accounts.accountStateInitialLoadPromise
    if (!this.#main.accounts.accounts.length) return // no accounts imported yet

    // A Privacy Pools account has no address, so it has no account state
    if (this.#main.selectedAccount.selectedType === 'privacyPools') return

    if (!this.#main.selectedAccount.account) {
      console.error('No selected account to latest state')
      return
    }

    const failedChainIds: string[] = getNetworksWithFailedRPC({
      providers: this.#main.providers.providers
    })

    const selectedAccountBroadcastedButNotConfirmed = this.#main.selectedAccount.account
      ? this.#main.activity.broadcastedButNotConfirmed[this.#main.selectedAccount.account.addr] ||
        []
      : []
    const networksWithPendingAccountOp = selectedAccountBroadcastedButNotConfirmed
      .map((op) => op.chainId)
      .filter((chainId, index, self) => self.indexOf(chainId) === index)

    const networksToUpdate = this.#main.networks.networks
      .filter(
        ({ chainId }) =>
          !networksWithPendingAccountOp.includes(chainId) &&
          !failedChainIds.includes(chainId.toString())
      )
      .map(({ chainId }) => chainId)

    await this.#main.accounts.updateAccountState(
      this.#main.selectedAccount.account.addr,
      'latest',
      networksToUpdate
    )
  }

  /**
   * Update failed network states more often. If a network's first failed
   *  update is just now, retry in 8s. If it's a repeated failure, retry in 20s.
   */
  async #fastAccountStateReFetch() {
    await this.initialLoadPromise
    const selectedAccountAddr = this.#main.selectedAccount.account?.addr

    const failedChainIds: string[] = getNetworksWithFailedRPC({
      providers: this.#main.providers.providers
    })

    const chainIdsToRetry = failedChainIds.filter((id) => {
      const retries = this.#accountStateRetriesByNetwork[id] || 0

      return retries < 3
    })

    if (!chainIdsToRetry.length || !selectedAccountAddr) {
      this.#timers.failedRpcReFetch.timer.stop()
      this.#accountStateRetriesByNetwork = {}
      return
    }

    await this.#main.accounts.updateAccountState(
      selectedAccountAddr,
      'latest',
      chainIdsToRetry.map((id) => BigInt(id))
    )

    // Increment the retry count for each chainId
    chainIdsToRetry.forEach((id) => {
      this.#accountStateRetriesByNetwork[id] = (this.#accountStateRetriesByNetwork[id] || 0) + 1
    })

    const failedChainIdsAfterUpdate = getNetworksWithFailedRPC({
      providers: this.#main.providers.providers
    })

    // Delete the network ids that have been successfully re-fetched so the logic can be re-applied
    // if the RPC goes down again
    if (Object.keys(this.#accountStateRetriesByNetwork).length) {
      const networksToUpdate: Network[] = []
      Object.keys(this.#accountStateRetriesByNetwork).forEach((chainId) => {
        if (!failedChainIdsAfterUpdate.includes(chainId)) {
          delete this.#accountStateRetriesByNetwork[chainId]

          const network = this.#main.networks.networks.find((n) => n.chainId.toString() === chainId)

          if (network) networksToUpdate.push(network)
        }
      })
      this.#main.updateSelectedAccountPortfolio({
        networks: networksToUpdate.length ? networksToUpdate : undefined,
        maxDataAgeMs: 60 * 1000
      })
    }

    if (!failedChainIdsAfterUpdate.length) {
      this.#timers.failedRpcReFetch.timer.stop()
      return
    }

    // Filter out the network ids that have already been retried
    const networksNotYetRetried = failedChainIdsAfterUpdate.filter(
      (id) => !this.#accountStateRetriesByNetwork[id]
    )

    const updateTime = networksNotYetRetried.length ? 8000 : 20000

    this.#timers.failedRpcReFetch.timer.updateTimeout({ timeout: updateTime })
  }

  #isUiActive() {
    return !!this.#main.ui.views.length
  }

  async #pollConfirmedSafeTxns() {
    try {
      const fingerprint = await this.#resolveConfirmedSafeTxns()
      this.#safeTxnsPollState = getNextSafeResolvePollState(this.#safeTxnsPollState, fingerprint)
    } finally {
      this.#timers.safeTxns.timer.updateTimeout({
        timeout: getSafeResolveTimeout({
          activeTimeout: SAFE_TXNS_RESOLVE_ACTIVE_INTERVAL,
          isUiActive: this.#isUiActive(),
          unchangedChecksCount: this.#safeTxnsPollState.unchangedChecksCount
        })
      })
    }
  }

  async #pollConfirmedSafeMessages() {
    try {
      const fingerprint = await this.#resolveConfirmedSafeMessages()
      this.#safeMessagesPollState = getNextSafeResolvePollState(
        this.#safeMessagesPollState,
        fingerprint
      )
    } finally {
      this.#timers.safeMessages.timer.updateTimeout({
        timeout: getSafeResolveTimeout({
          activeTimeout: SAFE_MESSAGES_RESOLVE_ACTIVE_INTERVAL,
          isUiActive: this.#isUiActive(),
          unchangedChecksCount: this.#safeMessagesPollState.unchangedChecksCount
        })
      })
    }
  }

  /**
   * Resolves the selected Safe's signed txns that were executed or got more signatures.
   * Returns the fingerprint of the check, or undefined when there was nothing to check.
   */
  async #resolveConfirmedSafeTxns(): Promise<string | undefined> {
    await this.initialLoadPromise

    // call only if the selected account is a safe
    if (!this.#main.selectedAccount.account || !this.#main.selectedAccount.account.safeCreation)
      return

    // do not make Safe requests if the extension is locked
    if (!this.#main.keystore.isUnlocked) return

    const safeAddr = this.#main.selectedAccount.account.addr as Hex
    if (!safeAddr) return

    // Ask each chain only for the transactions that can still resolve a request we
    // are waiting on, which is everything from the smallest pending nonce upwards
    const minNonceByChainId = new Map<bigint, bigint>()
    // A request that is added or signed changes the fingerprint, which resets the slowdown
    const checkedRequestParts: string[] = []
    this.#main.requests.userRequests.forEach((r) => {
      if (
        r.meta.accountAddr !== safeAddr ||
        r.kind !== 'calls' ||
        !r.signAccountOp.account.safeCreation ||
        !r.signAccountOp.accountOp.txnId ||
        !r.signAccountOp.accountOp.signed?.length
      )
        return

      const { accountOp } = r.signAccountOp
      // A request with no nonce cannot narrow the range, so fetch the chain in full
      const nonce = getAccountOpNonce(accountOp) ?? 0n
      checkedRequestParts.push(
        `request:${accountOp.chainId}:${accountOp.txnId}:${accountOp.signed?.length ?? 0}`
      )

      const currentMin = minNonceByChainId.get(accountOp.chainId)
      if (currentMin === undefined || nonce < currentMin)
        minNonceByChainId.set(accountOp.chainId, nonce)
    })

    if (!minNonceByChainId.size) return

    const chains = [...minNonceByChainId].map(([chainId, minNonce]) => ({
      chainId,
      minNonce: Number(minNonce)
    }))

    const confirmed = await this.#main.safe.fetchExecuted(safeAddr, chains).catch((e) => {
      console.log('failed to retrieve executed Safe txns', e)
      return []
    })
    // A failed fetch also counts as nothing new, so the checks slow down while the Safe API
    // is down or rate limiting us instead of retrying it at the fast interval
    const fingerprint = toSafeResolveFingerprint([
      ...checkedRequestParts,
      ...confirmed.map(
        ({ safeTxnHash, transactionHash, confirmations }) =>
          `txn:${safeTxnHash}:${transactionHash ?? ''}:${confirmations?.length ?? 0}`
      )
    ])
    if (!confirmed.length) return fingerprint

    // resolve each request
    for (const oneConfirmed of confirmed) {
      const userR = this.#main.requests.userRequests.find(
        (r) =>
          r.kind === 'calls' &&
          !!r.signAccountOp.account.safeCreation &&
          r.signAccountOp.accountOp.chainId === oneConfirmed.chainId &&
          oneConfirmed.safeTxnHash === r.signAccountOp.accountOp.txnId
      )
      if (!userR) continue

      const callsUserR = userR as CallsUserRequest

      if (oneConfirmed.transactionHash) {
        const accountOp = callsUserR.signAccountOp.accountOp
        const submittedAccountOp: SubmittedAccountOp = {
          ...accountOp,
          status: AccountOpStatus.BroadcastedButNotConfirmed,
          txnId: oneConfirmed.transactionHash,
          nonce: BigInt(oneConfirmed.nonce),
          identifiedBy: { type: 'Transaction', identifier: oneConfirmed.transactionHash },
          timestamp: new Date().getTime()
        }
        const commonSuccessHandler = await this.#main
          .commonHandlerForBroadcastSuccess({
            type: 'default',
            submittedAccountOp,
            accountOp,
            fromRequestId: userR.id
          })
          .catch((e: Error) => {
            console.log('could not resolve Safe Global request')
            console.log(e)
            return e
          })
        if (commonSuccessHandler instanceof Error) continue

        await this.#main.resolveAccountOpRequest(submittedAccountOp, userR.id, false).catch((e) => {
          console.log('could not resolve Safe Global request')
          console.log(e)
        })

        continue
      }

      // we come here only if transactionHash is undefined. The confirmations are only the ones
      // whose owners were verified (see SafeController.fetchExecuted)
      const signatures = (oneConfirmed.confirmations?.map((c) => c.signature) || []) as Hex[]
      const safeGlobalSigs = callsUserR.signAccountOp.accountOp.txnId
        ? sortSigs(
            signatures,
            callsUserR.signAccountOp.accountOp.txnId,
            callsUserR.signAccountOp.accountOp.safeTx?.confirmations
          )
        : null
      if (
        safeGlobalSigs &&
        callsUserR.signAccountOp.isInRegistry() && // update only if on foreground
        callsUserR.signAccountOp.accountOp.signature !== safeGlobalSigs &&
        (callsUserR.signAccountOp.accountOp.signature?.length || 0) < safeGlobalSigs.length
      ) {
        callsUserR.signAccountOp.update({
          accountOpData: {
            signature: safeGlobalSigs
          }
        })
      }
    }

    return fingerprint
  }

  /**
   * Resolves the selected Safe's signed messages that got all the owner signatures they need.
   * Returns the fingerprint of the check, or undefined when there was nothing to check.
   */
  async #resolveConfirmedSafeMessages(): Promise<string | undefined> {
    await this.initialLoadPromise

    // call only if the selected account is a safe
    if (!this.#main.selectedAccount.account || !this.#main.selectedAccount.account.safeCreation)
      return

    // do not make Safe requests if the extension is locked
    if (!this.#main.keystore.isUnlocked) return

    const accountStates = await this.#main.accounts.getOrFetchAccountStates(
      this.#main.selectedAccount.account.addr
    )
    if (!accountStates) return

    const pendingSafeMessages = this.#main.requests.userRequests
      .filter(
        (r) =>
          r.meta.accountAddr === this.#main.selectedAccount.account?.addr &&
          (r.kind === 'message' || r.kind === 'typedMessage' || r.kind === 'siwe') &&
          r.meta.hash &&
          !!r.meta.signed?.length
      )
      .map((r) => {
        return {
          chainId: r.meta.chainId,
          threshold: accountStates[r.meta.chainId]?.threshold || 0,
          messageHash: r.meta.hash,
          requestId: r.id,
          signedCount: r.meta.signed?.length ?? 0
        }
      })
    if (!pendingSafeMessages.length) return

    const fetchedMsgs = await this.#main.safe.getMessagesByHash(
      this.#main.selectedAccount.account.addr as Hex,
      pendingSafeMessages
    )
    // A request that is added or signed, or a message that gets more signatures, changes the
    // fingerprint, which resets the slowdown
    const fingerprint = toSafeResolveFingerprint([
      ...pendingSafeMessages.map(
        ({ chainId, messageHash, signedCount }) =>
          `request:${chainId}:${messageHash}:${signedCount}`
      ),
      ...fetchedMsgs.map(
        ({ messageHash, confirmations }) => `message:${messageHash}:${confirmations.length}`
      )
    ])
    const msgs = fetchedMsgs.filter((m) => m.isConfirmed)

    // resolve each request
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i]!
      const userR = this.#main.requests.userRequests.find(
        (r) =>
          (r.kind === 'message' || r.kind === 'typedMessage' || r.kind === 'siwe') &&
          r.meta.hash === msg.messageHash
      )
      if (!userR) continue
      // Built from the owner signatures that were verified, see SafeController.getMessagesByHash
      await this.#main.requests.resolveUserRequest({ hash: msg.preparedSignature }, userR.id)
    }

    return fingerprint
  }
}
