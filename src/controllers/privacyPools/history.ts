import {
  PrivacyPoolsHistoryFilters,
  PrivacyPoolsHistorySession
} from '../../interfaces/privacyPools'
import { getPrivacyPoolsHistoryPage } from '../../libs/privacyPools/history'
import { Pagination } from '../../utils/paginate'
import { PrivacyPoolsContext } from './context'
import { PrivacyPoolsSync } from './sync'

const DEFAULT_HISTORY_PAGINATION: Pagination = { fromPage: 0, itemsPerPage: 10 }

/**
 * The screens (sessions) showing an account's history, and their pages. The history itself is
 * read by `PrivacyPoolsSync` along with the notes, and kept with them in the account's state, so a
 * lock drops it. The sessions hold only filters and pages, so they are kept.
 */
export class PrivacyPoolsHistory {
  #ctx: PrivacyPoolsContext

  #sync: PrivacyPoolsSync

  #getSupportedChainIds: () => string[]

  /** `PrivacyPoolsController.syncChain`, which refreshes the prices along, as on any sync. */
  #syncChain: (chainId: string) => Promise<void>

  /** Per screen: what it is narrowed to and which page. See `open`. */
  #sessions: {
    [sessionId: string]: Pick<PrivacyPoolsHistorySession, 'filters' | 'pagination'>
  } = {}

  constructor(
    ctx: PrivacyPoolsContext,
    sync: PrivacyPoolsSync,
    {
      getSupportedChainIds,
      syncChain
    }: {
      getSupportedChainIds: () => string[]
      syncChain: (chainId: string) => Promise<void>
    }
  ) {
    this.#ctx = ctx
    this.#sync = sync
    this.#getSupportedChainIds = getSupportedChainIds
    this.#syncChain = syncChain
  }

  /** One page per screen, of what the account's syncs have read. Nothing to show without one. */
  getSessions(seedId: string | null): { [sessionId: string]: PrivacyPoolsHistorySession } {
    const accountChains = seedId ? this.#sync.getAccountChainStates(seedId) : {}

    return Object.fromEntries(
      Object.entries(this.#sessions).map(([sessionId, { filters, pagination }]) => {
        const chainStates = this.#getChainIds(filters).map((chainId) => accountChains[chainId])
        // A failed read settles the chain too, so the page shows what was read rather than load
        const isEveryChainSettled = chainStates.every(
          (state) => !!state && (!!state.history || !!state.historyError || !!state.error)
        )
        const histories = chainStates.flatMap((state) => (state?.history ? [state.history] : []))
        const failedState = chainStates.find((state) => state?.historyError || state?.error)

        return [
          sessionId,
          {
            filters,
            pagination,
            result: isEveryChainSettled ? getPrivacyPoolsHistoryPage(histories, pagination) : null,
            error: failedState?.historyError || failedState?.error || null
          }
        ]
      })
    )
  }

  /** Whether any screen shows the history, so a sync should read it after the notes. */
  hasSessions(): boolean {
    return !!Object.keys(this.#sessions).length
  }

  /** Opens a screen's page, or moves it to another page or network. Read it with `load`. */
  open(
    sessionId: string,
    filters: PrivacyPoolsHistoryFilters = {},
    pagination: Pagination = DEFAULT_HISTORY_PAGINATION
  ) {
    this.#sessions = { ...this.#sessions, [sessionId]: { filters, pagination } }
    this.#ctx.emitUpdate()
  }

  /** Closes a screen's page. Syncs stop reading the history once no screen shows it. */
  close(sessionId: string) {
    if (!this.#sessions[sessionId]) return

    const sessions = { ...this.#sessions }
    delete sessions[sessionId]
    this.#sessions = sessions
    this.#ctx.emitUpdate()
  }

  /**
   * Reads the history of the networks the filters show whose last sync did not read it, from their
   * current plugin. Syncs a network only when that plugin has not synced the account's notes, as a
   * new one knows none of its deposits. Rejects when a sync fails.
   */
  async load(seedId: string, filters: PrivacyPoolsHistoryFilters): Promise<void> {
    await Promise.all(
      this.#getChainIds(filters).map(async (chainId) => {
        // It may have checked whether to read the history before this screen asked for it
        await this.#sync.getRunningSync(seedId, chainId)

        // Not a sync, so the balances are not shown as loading again
        if (await this.#sync.readHistoryWithoutSync(chainId, seedId)) return

        await this.#syncChain(chainId)
      })
    )
  }

  #getChainIds({ chainId }: PrivacyPoolsHistoryFilters): string[] {
    const supportedChainIds = this.#getSupportedChainIds()
    if (!chainId) return supportedChainIds

    return supportedChainIds.filter((supportedChainId) => supportedChainId === chainId)
  }
}
