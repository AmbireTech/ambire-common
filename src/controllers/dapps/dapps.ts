import { getDomain } from 'tldts'

import { ISelectedAccountController } from '@/interfaces/selectedAccount'

import {
  IRecurringTimeout,
  RecurringTimeout
} from '../../classes/recurringTimeout/recurringTimeout'
import { getSessionId, Session, SessionInitProps, SessionProp } from '../../classes/session'
import {
  categoriesNotToFilterOut,
  categoriesToExclude,
  CATEGORY_MAP,
  dappIdsToBeRemoved,
  dappsNotToFilterOutByDomain,
  defiLlamaProtocolIdsToExclude,
  featuredDapps,
  predefinedDapps
} from '../../consts/dapps/dapps'
import {
  ConnectionSource,
  Dapp,
  DAPP_VERIFICATION_BANNER_IDS,
  DappVerificationBanner,
  DefiLlamaChain,
  DefiLlamaProtocol,
  GetCurrentDappRes,
  HasUnverifiedDappsRes,
  IDappsController,
  RecentDappEntry
} from '../../interfaces/dapp'
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter'
import { Fetch } from '../../interfaces/fetch'
import { Messenger } from '../../interfaces/messenger'
import { INetworksController } from '../../interfaces/network'
import { BlacklistedStatus, IPhishingController } from '../../interfaces/phishing'
import { IStorageController } from '../../interfaces/storage'
import { IUiController, View } from '../../interfaces/ui'
import { UserRequest } from '../../interfaces/userRequest'
import {
  formatDappName,
  getAccountsForDapp,
  getDappIdFromUrl,
  getDappNameFromId,
  getDomainFromUrl,
  modifyDappPropsIfNeeded,
  normalizeDappConnection,
  sortDapps,
  unifyDefiLlamaDappUrl
} from '../../libs/dapps/helpers'
import { networkChainIdToHex } from '../../libs/networks/networks'
import { fetchWithTimeout } from '../../utils/fetch'
import EventEmitter from '../eventEmitter/eventEmitter'

const mergeSource = (
  existing: ConnectionSource[] | undefined,
  source: ConnectionSource
): ConnectionSource[] => {
  const current = existing ?? []
  return current.includes(source) ? current : [...current, source]
}

// The DappsController is responsible for the following tasks:
// 1. Managing the dApp catalog
// 2. Handling active sessions between dApps and the wallet
// 3. Broadcasting events from the wallet to connected dApps via the Session
// The possible events include: accountsChanged, chainChanged, disconnect, lock, unlock, and connect.
export class DappsController extends EventEmitter implements IDappsController {
  static MAX_RECENT_DAPPS = 20

  #appVersion: string

  #fetch: Fetch

  #storage: IStorageController

  #networks: INetworksController

  #phishing: IPhishingController

  #ui: IUiController

  dappSessions: { [sessionId: string]: Session } = {}

  #dapps = new Map<string, Dapp>()

  #recentDapps: RecentDappEntry[] = []

  dappToConnect: Dapp | null = null

  isReadyToDisplayDapps: boolean = true

  fetchAndUpdatePromise?: Promise<void>

  #shouldRetryFetchAndUpdate: boolean = false

  #retryFetchAndUpdateInterval: IRecurringTimeout

  #retryFetchAndUpdateAttempts: number = 0

  #retryFetchAndUpdateMaxAttempts: number = 3

  #selectedAccount: ISelectedAccountController

  get shouldRetryFetchAndUpdate() {
    return this.#shouldRetryFetchAndUpdate
  }

  get retryFetchAndUpdateInterval() {
    return this.#retryFetchAndUpdateInterval
  }

  get retryFetchAndUpdateAttempts() {
    return this.#retryFetchAndUpdateAttempts
  }

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  constructor({
    eventEmitterRegistry,
    appVersion,
    fetch,
    storage,
    networks,
    phishing,
    ui,
    selectedAccount
  }: {
    eventEmitterRegistry?: IEventEmitterRegistryController
    appVersion: string
    fetch: Fetch
    storage: IStorageController
    networks: INetworksController
    phishing: IPhishingController
    ui: IUiController
    selectedAccount: ISelectedAccountController
  }) {
    super(eventEmitterRegistry)

    this.#appVersion = appVersion
    this.#fetch = fetch
    this.#storage = storage
    this.#networks = networks
    this.#phishing = phishing
    this.#ui = ui
    this.#selectedAccount = selectedAccount

    this.#phishing.onUpdate(() => {
      if (!this.#phishing.shouldSyncDapps) return
      this.#syncDappsBlacklistedStatusWithPhishing()
      this.#phishing.resetShouldSyncDapps()
    })

    // Retry fetching and updating dapps after 5 minutes of user inactivity if the initial attempt fails
    this.#retryFetchAndUpdateInterval = new RecurringTimeout(
      this.fetchAndUpdateDapps.bind(this),
      5 * 60 * 1000 // 5min.
    )

    this.#ui.uiEvent.on('addView', () => {
      if (this.#retryFetchAndUpdateInterval.running) this.#retryFetchAndUpdateInterval.stop()
    })

    this.#ui.uiEvent.on('removeView', (removedView: View) => {
      if (
        removedView.type === 'popup' &&
        this.#shouldRetryFetchAndUpdate &&
        this.#retryFetchAndUpdateAttempts < this.#retryFetchAndUpdateMaxAttempts
      ) {
        this.#retryFetchAndUpdateInterval.start()
      }
    })

    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  get isReady() {
    return !!this.dapps
  }

  get dapps(): Dapp[] {
    // Clone the original map so we don’t mutate #dapps
    const filteredMap = new Map(this.#dapps)

    for (const [key, d] of filteredMap) {
      const isPredefined = predefinedDapps.some((pd) => pd.id === d.id)
      const isConnected = !!d.connectedSources?.length
      if (!isConnected && d.blacklisted === 'BLACKLISTED') {
        filteredMap.delete(key)
        continue
      }
      if (isPredefined || d.isFeatured || isConnected || d.isCustom) continue

      const domainId = getDomainFromUrl(d.url)
      const isInDappsNotToFilterOutByDomain =
        domainId && dappsNotToFilterOutByDomain.includes(domainId)

      const shouldSkipByCategory = !categoriesNotToFilterOut.includes(d.category as string)
      const hasNoNetworks = !d.chainIds || d.chainIds.length === 0
      const hasLowTVL = !d.tvl || d.tvl <= 15_000_000

      // Remove dapps that are not in excluded categories and either have no networks or low TVL
      // But skip this filtering if the dapp's domain is in dappsNotToFilterOutByDomain
      if (
        shouldSkipByCategory &&
        (hasNoNetworks || hasLowTVL) &&
        !isInDappsNotToFilterOutByDomain
      ) {
        filteredMap.delete(key)
      }
    }

    for (const [, d] of filteredMap) {
      const domainId = getDomainFromUrl(d.url)
      if (!domainId) continue
      if (dappsNotToFilterOutByDomain.includes(domainId)) continue

      // If the dapp's id is NOT its domain and there's already a dapp using that domain id → delete the dapp with that domain
      if (domainId !== d.id && filteredMap.has(domainId)) filteredMap.delete(domainId)
    }

    return Array.from(filteredMap.values()).sort(sortDapps)
  }

  get recentDapps(): Dapp[] {
    // Resolve each recent entry against #dapps; filter stale ids whose dapp was removed.
    // Defensive sort by openedAt desc — entries are unshifted on add, but stale-filtering can disturb ordering across versions.
    return this.#recentDapps
      .slice()
      .sort((a, b) => b.openedAt - a.openedAt)
      .map((entry) => this.#dapps.get(entry.id))
      .filter((d): d is Dapp => !!d)
  }

  get categories(): string[] {
    return [
      ...new Set(
        this.dapps.map((d) => d.category!).filter((c) => !!c && !categoriesToExclude.includes(c))
      )
    ].sort()
  }

  async #load() {
    await this.#networks.initialLoadPromise
    await this.#selectedAccount.initialLoadPromise

    const [storedDapps, storedRecentDapps] = await Promise.all([
      this.#storage.get('dappsV2', predefinedDapps),
      this.#storage.get('recentDapps', [] as RecentDappEntry[])
    ])
    // Normalize on read so a drifted record (e.g. isConnected: true but connectedSources: [])
    // can't show a dapp as connected in the UI while permission checks force a reconnect.
    this.#dapps = new Map(storedDapps.map((d) => [d.id, normalizeDappConnection(d)]))
    this.#recentDapps = storedRecentDapps

    void this.fetchAndUpdateDapps()
  }

  async fetchAndUpdateDapps() {
    if (!this.isReadyToDisplayDapps) return

    this.isReadyToDisplayDapps = false
    this.emitUpdate()

    this.fetchAndUpdatePromise = this.#fetchAndUpdateDapps()
    await this.fetchAndUpdatePromise
      .catch((err: any) => {
        this.#shouldRetryFetchAndUpdate = true

        // run the interval if the initial fetch failed while the extension is not in use
        if (!this.#retryFetchAndUpdateAttempts && !this.#ui.views.some((v) => v.type === 'popup')) {
          this.#retryFetchAndUpdateInterval.start()
        } else {
          this.#retryFetchAndUpdateInterval.stop()
        }
        this.emitError({
          message: 'Failed to fetch the app catalog.',
          error: err,
          level: 'silent'
        })
      })
      .finally(() => {
        this.fetchAndUpdatePromise = undefined
        this.isReadyToDisplayDapps = true
        this.emitUpdate()
      })
  }

  async #fetchAndUpdateDapps() {
    // NOTE: For debugging purposes — uncomment to force a fetch and update every time
    // const lastDappsUpdateVersion = 'debug-force-fetch'
    const lastDappsUpdateVersion = await this.#storage.get('lastDappsUpdateVersion', null)
    if (lastDappsUpdateVersion && lastDappsUpdateVersion === this.#appVersion) {
      const dappsWithoutBlacklistedStatus = Array.from(this.#dapps.values()).filter(
        (d) =>
          !d.blacklisted ||
          ['LOADING', 'FAILED_TO_GET'].includes(d.blacklisted) ||
          // Re-check dApps stored with a non-SUSPICIOUS_HOSTING status that now match the
          // suspicious hosting pattern, so existing entries are migrated on startup.
          (d.blacklisted !== 'SUSPICIOUS_HOSTING' &&
            this.#phishing.getDomainBlacklistedStatus(d.url) === 'SUSPICIOUS_HOSTING')
      )
      // IMPORTANT: Do NOT await this call — we want `isReadyToDisplayDapps` to resolve immediately
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.#updateDappsBlacklistedStatus(dappsWithoutBlacklistedStatus)
      return
    }

    if (this.#shouldRetryFetchAndUpdate) this.#retryFetchAndUpdateAttempts += 1

    const dappsMap = new Map<string, Dapp>()

    let fetchedDappsList: DefiLlamaProtocol[] = []
    let fetchedChainsList: DefiLlamaChain[] = []

    const [res, chainsRes] = await Promise.all([
      fetchWithTimeout(
        this.#fetch,
        'https://api.llama.fi/protocols',
        {},
        this.#shouldRetryFetchAndUpdate ? 15000 : 10000
      ),
      fetchWithTimeout(
        this.#fetch,
        'https://api.llama.fi/v2/chains',
        {},
        this.#shouldRetryFetchAndUpdate ? 15000 : 10000
      )
    ])

    if (!res.ok || !chainsRes.ok) {
      throw new Error(`Fetch failed: protocols=${res.status}, chains=${chainsRes.status}`)
    }

    ;[fetchedDappsList, fetchedChainsList] = await Promise.all([res.json(), chainsRes.json()])

    if (!fetchedDappsList.length || !fetchedChainsList.length) {
      throw new Error('Fetch completed, but no apps or chains were returned')
    }

    const chainNamesToIds = new Map<string, number | null>()
    for (const c of fetchedChainsList) {
      chainNamesToIds.set(c.name.toLowerCase(), c.chainId)
    }

    const nonEvmChainsByName = fetchedChainsList
      .filter((c) => !c.chainId)
      .map((c) => c.name.toLowerCase())

    const prevDapps = new Map(this.#dapps)

    for (const dapp of fetchedDappsList) {
      if (categoriesToExclude.includes(dapp.category)) continue
      if (defiLlamaProtocolIdsToExclude.includes(dapp.id)) continue

      const id = getDappIdFromUrl(dapp.url)

      // Tries to find non-EVM protocols by matching their text with known non-EVM chain names because
      // some protocols have an empty chains props, and thats the only way to filter the non-EVM ones.
      if (categoriesNotToFilterOut.includes(dapp.category) && !dapp.chains.length) {
        const text = `${dapp.name} ${dapp.description ?? ''}`.toLowerCase()
        if (nonEvmChainsByName.some((chainName) => text.includes(chainName))) {
          continue
        }
      }

      const prevStoredDapp = prevDapps.get(id)

      const chainIds = (dapp.chains ?? [])
        .map((chainName: string) => chainNamesToIds.get(chainName.toLowerCase())!)
        .filter(
          (chainId: number) =>
            !!chainId &&
            this.#networks.allNetworks.find((n) => n.chainId.toString() === chainId.toString())
        )

      const prevSources = prevStoredDapp?.connectedSources ?? []
      const updatedDapp: Dapp = {
        id,
        name: formatDappName(dapp.name),
        description: dapp.description,
        url: unifyDefiLlamaDappUrl(dapp.url),
        icon: dapp.logo,
        category: CATEGORY_MAP[dapp.category] || dapp.category,
        tvl: dapp.tvl,
        chainIds,
        isConnected: prevSources.length > 0,
        connectedSources: prevSources,
        isFeatured: featuredDapps.has(id) || featuredDapps.has(getDomainFromUrl(dapp.url)!),
        isCustom: !!prevStoredDapp?.isCustom,
        chainId: prevStoredDapp?.chainId || 1,
        favorite: !!prevStoredDapp?.favorite,
        blacklisted: 'LOADING',
        twitter: dapp.twitter,
        geckoId: dapp.gecko_id,
        grantedPermissionId: prevStoredDapp?.grantedPermissionId,
        grantedPermissionAt: prevStoredDapp?.grantedPermissionAt
      }

      modifyDappPropsIfNeeded(id, dappsMap, dapp, (modifiedDapp: Dapp) => {
        dappsMap.set(id, modifiedDapp)
      })

      if (!dappsMap.has(id) && !dappsMap.has(getDomain(updatedDapp.url)!)) {
        dappsMap.set(id, updatedDapp)
      }
    }

    // Add predefined
    for (const pd of predefinedDapps) {
      const id = getDappIdFromUrl(pd.url)

      const prevStoredDapp = prevDapps.get(id)

      if (!dappsMap.has(id)) {
        const prevSources = prevStoredDapp?.connectedSources ?? []
        dappsMap.set(id, {
          id,
          name: formatDappName(pd.name),
          description: pd.description,
          url: pd.url,
          icon: pd.icon,
          category: pd.category ? CATEGORY_MAP[pd.category] || pd.category : null,
          tvl: null,
          chainIds: pd.chainIds || [],
          isConnected: prevSources.length > 0,
          connectedSources: prevSources,
          isFeatured: featuredDapps.has(id) || featuredDapps.has(getDomainFromUrl(pd.url)!),
          isCustom: false,
          chainId: prevStoredDapp?.chainId ?? 1,
          favorite: prevStoredDapp?.favorite ?? false,
          blacklisted: 'LOADING',
          twitter: pd.twitter || null,
          geckoId: null
        })
      }
    }

    const prevDappsArray = Array.from(prevDapps.values())
    const prevConnectedDapps = prevDappsArray.filter((d) => (d.connectedSources?.length ?? 0) > 0)
    const prevCustomDapps = prevDappsArray.filter((d) => d.isCustom)

    // Add connected + custom
    for (const d of [...prevConnectedDapps, ...prevCustomDapps]) {
      if (!dappsMap.has(d.id)) {
        const existingByDomain = dappsMap.get(getDomainFromUrl(d.url)!)
        if (existingByDomain) {
          d.name = existingByDomain.name
          d.description = existingByDomain.description
          d.tvl = existingByDomain.tvl
          d.icon = existingByDomain.icon
          d.isFeatured = existingByDomain.isFeatured
          d.twitter = existingByDomain.twitter
          d.geckoId = existingByDomain.geckoId
          d.chainIds = existingByDomain.chainIds
        }
        dappsMap.set(d.id, d)
      }
    }

    // Delete legacy IDs
    for (const id of dappIdsToBeRemoved) dappsMap.delete(id)
    const unverifiedDappsArray = Array.from(dappsMap.values())

    this.#dapps = dappsMap
    this.isReadyToDisplayDapps = true
    this.#shouldRetryFetchAndUpdate = false
    this.#retryFetchAndUpdateInterval.stop()
    this.emitUpdate()

    await this.#updateDappsBlacklistedStatus(unverifiedDappsArray)
    await this.#storage.set('dappsV2', Array.from(dappsMap.values()))
    await this.#storage.set('lastDappsUpdateVersion', this.#appVersion)
  }

  async #updateDappsBlacklistedStatus(dapps: Dapp[]) {
    await this.#phishing.updateDomainsBlacklistedStatus(
      dapps.map((d) => d.url),
      (blacklistedStatus) => {
        Object.entries(blacklistedStatus).forEach(([dappId, status]) => {
          const dapp = this.#dapps.get(dappId)
          if (dapp && dapp.blacklisted !== status) {
            this.#dapps.set(dapp.id, { ...dapp, blacklisted: status })
          }
        })
        this.emitUpdate()
      }
    )
  }

  #syncDappsBlacklistedStatusWithPhishing() {
    if (!this.#dapps.size) return

    let hasUpdatedDapps = false
    this.#dapps.forEach((dapp, dappId) => {
      const updatedStatus = this.#phishing.getDomainBlacklistedStatus(dapp.url)
      if (!updatedStatus || dapp.blacklisted === updatedStatus) return

      this.#dapps.set(dappId, { ...dapp, blacklisted: updatedStatus })
      hasUpdatedDapps = true
    })

    if (!hasUpdatedDapps) return

    this.emitUpdate()
    void this.#storage.set('dappsV2', Array.from(this.#dapps.values()))
  }

  async #createDappSession(initProps: SessionInitProps) {
    await this.initialLoadPromise
    const dappSession = new Session(initProps)
    this.dappSessions[dappSession.sessionId] = dappSession

    this.emitUpdate()

    return dappSession
  }

  async getOrCreateDappSession({ windowId, tabId, url, wcTopic }: SessionInitProps) {
    if (!tabId || !url) throw new Error('Invalid props passed to getOrCreateDappSession')

    const dappId = getDappIdFromUrl(new URL(url).origin)
    const sessionId = getSessionId({ windowId, tabId, dappId })

    if (this.dappSessions[sessionId]) return this.dappSessions[sessionId]

    return this.#createDappSession({ windowId, tabId, url, wcTopic })
  }

  getDappSessionByWcTopic(wcTopic: string): Session | undefined {
    return Object.values(this.dappSessions).find((session) => session.wcTopic === wcTopic)
  }

  setSessionMessenger = (sessionId: string, messenger: Messenger, isAmbireNext: boolean) => {
    this.dappSessions[sessionId]?.setMessenger(messenger, isAmbireNext)
  }

  setSessionLastHandledRequestsId = (
    sessionId: string,
    providerId: number,
    id: number,
    isWeb3AppRequest?: boolean
  ) => {
    if (!this.dappSessions[sessionId]) return

    if (id > this.dappSessions[sessionId].lastHandledRequestIds[providerId]!) {
      this.dappSessions[sessionId].lastHandledRequestIds[providerId] = id
      if (isWeb3AppRequest && !this.dappSessions[sessionId].isWeb3App) {
        this.dappSessions[sessionId].isWeb3App = true
        this.emitUpdate()
      }
    }
  }

  resetSessionLastHandledRequestsId = (sessionId: string, providerId?: number) => {
    if (providerId) {
      this.dappSessions[sessionId]!.lastHandledRequestIds[providerId] = -1
    } else {
      Object.keys(this.dappSessions[sessionId]!.lastHandledRequestIds).forEach((key) => {
        this.dappSessions[sessionId]!.lastHandledRequestIds[key] = -1
      })
    }
  }

  setSessionProp = (sessionId: string, props: SessionProp) => {
    this.dappSessions[sessionId]?.setProp(props)
  }

  deleteDappSession = (sessionId: string) => {
    delete this.dappSessions[sessionId]

    this.emitUpdate()
  }

  deleteDappSessionByWcTopic = (wcTopic: string) => {
    const session = this.getDappSessionByWcTopic(wcTopic)
    if (session) {
      delete this.dappSessions[session.sessionId]
      this.emitUpdate()
    }
  }

  broadcastDappSessionEvent = async (
    ev: any,
    data?: any,
    id?: string,
    skipPermissionCheck?: boolean,
    sourceFilter?: ConnectionSource
  ) => {
    await this.initialLoadPromise
    let dappSessions: { sessionId: string; data: Session }[] = []
    Object.keys(this.dappSessions).forEach((sessionId) => {
      const hasPermissionToBroadcast =
        skipPermissionCheck || this.hasPermission(this.dappSessions[sessionId]!.id)
      if (this.dappSessions[sessionId] && hasPermissionToBroadcast) {
        dappSessions.push({ sessionId, data: this.dappSessions[sessionId] })
      }
    })
    if (id) {
      dappSessions = dappSessions.filter((dappSession) => dappSession.data.id === id)
    }
    // Source filter: 'wc' → only sessions with a wcTopic; 'injected' → only sessions without one.
    // Used by `disconnectDappSource` so disconnecting one channel doesn't tear down the other.
    if (sourceFilter) {
      dappSessions = dappSessions.filter((dappSession) =>
        sourceFilter === 'wc' ? !!dappSession.data.wcTopic : !dappSession.data.wcTopic
      )
    }

    dappSessions.forEach((dappSession) => {
      try {
        dappSession.data.sendMessage?.(ev, data)
      } catch (e: any) {
        console.error('Error broadcasting event to dapp session', e)
        if (this.dappSessions[dappSession.sessionId]) {
          this.deleteDappSession(dappSession.sessionId)
        }
      }
    })

    // on disconnect clean up the WC sessions
    if (ev === 'disconnect') {
      dappSessions.forEach((dappSession) => {
        if (this.dappSessions[dappSession.sessionId]?.wcTopic) {
          this.deleteDappSession(dappSession.sessionId)
        }
      })
    }
  }

  async #buildDapp(dapp: {
    id: Dapp['id']
    name: Dapp['name']
    url: Dapp['url']
    icon: Dapp['icon']
    chainId?: Dapp['chainId']
    isConnected: Dapp['isConnected']
  }): Promise<Dapp> {
    await this.initialLoadPromise

    const existing = this.#dapps.get(dapp.id)

    const network = this.#networks.allNetworks.find(
      (n) => n.chainId.toString() === dapp.chainId?.toString()
    )

    const DEFAULT_CHAIN_ID = 1

    if (existing) {
      return {
        ...existing,
        chainId: network ? dapp.chainId! : DEFAULT_CHAIN_ID,
        isConnected: dapp.isConnected,
        connectedSources: existing.connectedSources ?? []
      }
    }

    const existingByDomain = this.#dapps.get(getDomainFromUrl(dapp.url)!)

    return {
      id: dapp.id,
      url: dapp.url,
      name: existingByDomain?.name || dapp.name || getDappNameFromId(dapp.id),
      chainId: network ? dapp.chainId! : existingByDomain?.chainId || DEFAULT_CHAIN_ID,
      description: existingByDomain?.description || '',
      icon: existingByDomain?.icon || dapp.icon,
      category: existingByDomain?.category || null,
      favorite: existingByDomain?.favorite || false,
      isConnected: dapp.isConnected,
      connectedSources: [],
      chainIds: existingByDomain?.chainIds || [],
      isFeatured: existingByDomain?.isFeatured || false,
      isCustom: existingByDomain?.isCustom ?? true,
      tvl: existingByDomain?.tvl || null,
      blacklisted: 'LOADING',
      geckoId: existingByDomain?.geckoId || null,
      twitter: existingByDomain?.twitter || null
    }
  }

  /**
   * Picks the best chainId for a WalletConnect dapp out of the chains it approved in its
   * eip155 namespace. WC sessions can approve multiple chains, and the chain the user is
   * actually transacting on is not necessarily the first one. Blindly taking `chains[0]`
   * (or hard-defaulting to mainnet) can strand the dapp on the wrong network, so prefer:
   *   1. the first approved chain that maps to an ENABLED wallet network,
   *   2. then the first approved chain that maps to any known wallet network,
   *   3. then the first approved chain as-is (so a not-yet-loaded custom network still
   *      round-trips its real chainId instead of being replaced by a default).
   * Returns `undefined` when there are no candidates, leaving the default handling to the caller.
   */
  pickWalletConnectChainId(candidateChainIds?: number[]): number | undefined {
    if (!candidateChainIds?.length) return undefined

    const enabledChainIds = new Set(this.#networks.networks.map((n) => Number(n.chainId)))
    const enabledMatch = candidateChainIds.find((chainId) => enabledChainIds.has(Number(chainId)))
    if (enabledMatch !== undefined) return enabledMatch

    const knownChainIds = new Set(this.#networks.allNetworks.map((n) => Number(n.chainId)))
    const knownMatch = candidateChainIds.find((chainId) => knownChainIds.has(Number(chainId)))
    if (knownMatch !== undefined) return knownMatch

    return candidateChainIds[0]
  }

  /**
   * Convenience for callers that have a dapp identity (id/url/name/icon) but not a full
   * Dapp record yet — used by the WalletConnect session setup/restore paths, which need
   * to register the dapp with `'wc'` as the source even when there's no prior catalog
   * entry. Defers to `#buildDapp` so existing catalog metadata is preserved.
   *
   * `candidateChainIds` are the chains the WC dapp approved in its eip155 namespace; the
   * dapp's stored chainId is resolved from them via `pickWalletConnectChainId`, falling
   * back to `identity.chainId` when no candidates are provided.
   */
  async addDappFromIdentity(
    identity: {
      id: Dapp['id']
      name: Dapp['name']
      url: Dapp['url']
      icon: Dapp['icon']
      chainId?: Dapp['chainId']
      candidateChainIds?: number[]
    },
    source: ConnectionSource
  ) {
    if (!this.isReady) return
    await this.initialLoadPromise

    const { candidateChainIds, ...identityRest } = identity
    const resolvedChainId = this.pickWalletConnectChainId(candidateChainIds) ?? identity.chainId
    const dapp = await this.#buildDapp({
      ...identityRest,
      chainId: resolvedChainId,
      isConnected: true
    })
    await this.addDapp(dapp, source)
  }

  /**
   * Add a dapp and mark it connected via `source`. `source` defaults to `'injected'`
   * to keep the existing web/extension call sites (which don't know about sources)
   * behaving exactly as before. Calling `addDapp` again with a different source
   * appends it to `connectedSources` rather than overwriting.
   */
  async addDapp(dapp: Dapp, source: ConnectionSource = 'injected') {
    if (!this.isReady) return

    const existing = this.#dapps.get(dapp.id)

    if (existing) {
      const mergedSources = mergeSource(existing.connectedSources, source)
      this.updateDapp(dapp.id, {
        chainId: dapp.chainId,
        connectedSources: mergedSources,
        isConnected: mergedSources.length > 0,
        accountPreferences: dapp.accountPreferences
      })
      return
    }

    const sources: ConnectionSource[] = dapp.isConnected ? [source] : []
    this.#dapps.set(dapp.id, {
      ...dapp,
      connectedSources: sources,
      isConnected: sources.length > 0
    })

    await this.#storage.set('dappsV2', Array.from(this.#dapps.values()))
    this.emitUpdate()

    if (sources.length > 0) {
      const network = this.#networks.allNetworks.find(
        (n) => n.chainId.toString() === dapp.chainId?.toString()
      )
      const DEFAULT_CHAIN_ID = 1

      await this.broadcastDappSessionEvent(
        'chainChanged',
        {
          chain: dapp.chainId
            ? networkChainIdToHex(dapp.chainId)
            : networkChainIdToHex(DEFAULT_CHAIN_ID),
          networkVersion: network?.chainId?.toString() || DEFAULT_CHAIN_ID.toString()
        },
        dapp.id
      )
    }
  }

  updateDapp(id: string, dapp: Partial<Dapp>) {
    if (!this.isReady) return

    const existing = this.#dapps.get(id)
    if (!existing) return

    const dappPropsToUpdate = { ...dapp }

    // Treat connectedSources as the source of truth and keep isConnected derived from it
    // so the two cannot drift. Callers may pass either (or both) — connectedSources wins.
    if (dappPropsToUpdate.connectedSources !== undefined) {
      dappPropsToUpdate.isConnected = dappPropsToUpdate.connectedSources.length > 0
    } else if (dappPropsToUpdate.isConnected !== undefined) {
      // Legacy callers (web/extension code that still passes `isConnected`) — translate
      // it to a full sources update. `true` → add 'injected' if not already present.
      const nextSources: ConnectionSource[] = dappPropsToUpdate.isConnected
        ? mergeSource(existing.connectedSources, 'injected')
        : []
      dappPropsToUpdate.connectedSources = nextSources
      dappPropsToUpdate.isConnected = nextSources.length > 0
    }

    const wasConnected = (existing.connectedSources?.length ?? 0) > 0
    const willBeConnected = dappPropsToUpdate.connectedSources
      ? dappPropsToUpdate.connectedSources.length > 0
      : wasConnected

    // remove the custom dapp if it gets fully disconnected
    if (existing.isCustom && wasConnected && !willBeConnected) {
      this.removeDapp(id)
      return
    }

    const existingByDomain = this.#dapps.get(getDomainFromUrl(existing.url)!)

    const accountPreferencesToUpdate = dappPropsToUpdate.accountPreferences

    // Notify the dapp of the preference change
    if ('accountPreferences' in dappPropsToUpdate && !!accountPreferencesToUpdate) {
      if (
        !accountPreferencesToUpdate.selectedAccount ||
        !accountPreferencesToUpdate.accounts.length ||
        !accountPreferencesToUpdate.accounts.includes(accountPreferencesToUpdate.selectedAccount)
      ) {
        this.emitError({
          message: `Invalid preferences for ${dapp.name}. Contact support if the issue persists.`,
          error: new Error(
            'Invalid account preferences' + JSON.stringify(accountPreferencesToUpdate)
          ),
          level: 'major'
        })
        return
      }

      const newAccounts = getAccountsForDapp(
        accountPreferencesToUpdate,
        this.#selectedAccount.account?.addr
      )

      // We could add (and had) some logic here to prevent unnecessary updates, but it's not that simple
      // and an extra update or two won't hurt anyway
      void this.broadcastDappSessionEvent('accountsChanged', newAccounts, id, true)
    }

    if (!existing.isCustom) {
      dappPropsToUpdate.name = existing.name
    } else if (existingByDomain && existing.isCustom) {
      dappPropsToUpdate.name = existingByDomain.name
      dappPropsToUpdate.description = existingByDomain.description
      dappPropsToUpdate.icon = existingByDomain.icon
      dappPropsToUpdate.category = existingByDomain.category
      dappPropsToUpdate.chainIds = existingByDomain.chainIds
      dappPropsToUpdate.tvl = existingByDomain.tvl
      dappPropsToUpdate.geckoId = existingByDomain.geckoId
      dappPropsToUpdate.twitter = existingByDomain.twitter
    }

    this.#dapps.set(id, { ...existing, ...dappPropsToUpdate })
    void this.#storage.set('dappsV2', Array.from(this.#dapps.values()))

    this.emitUpdate()
  }

  updateDappToConnect(id: string, data: Partial<Dapp>) {
    if (!this.dappToConnect || this.dappToConnect.id !== id) {
      this.emitError({
        level: 'silent',
        message: `Trying to update dappToConnect with id ${id}, but current dappToConnect is ${this.dappToConnect?.id}`,
        error: new Error('updateDappToConnect: id not found')
      })
      return
    }

    this.dappToConnect = { ...this.dappToConnect, ...data }
    this.emitUpdate()
  }

  async onSelectedAccountChange(newAccount: string) {
    Object.values(this.dappSessions).forEach(async (session) => {
      if (!this.hasPermission(session.id)) return

      const accountPreferences = this.getDapp(session.id)?.accountPreferences

      // Update the last selected account
      if (
        accountPreferences?.accounts.includes(newAccount) &&
        accountPreferences.selectedAccount !== newAccount
      ) {
        accountPreferences.selectedAccount = newAccount
      }

      // Broadcast to dapps that the selected account has changed
      const accounts = getAccountsForDapp(accountPreferences, newAccount)

      await this.broadcastDappSessionEvent('accountsChanged', accounts, session.id, true)
    })
  }

  removeAccountData(address: string) {
    this.#dapps.forEach((dapp) => {
      if (!dapp.accountPreferences) return

      if (!dapp.accountPreferences.accounts.includes(address)) return

      const newAccounts = dapp.accountPreferences.accounts.filter((a) => a !== address)

      this.#dapps.set(dapp.id, {
        ...dapp,
        // Disconnect the dapp if the removed account was the only one with access
        isConnected: newAccounts.length > 0,
        // Also delete preferences in this case
        accountPreferences: newAccounts.length
          ? {
              ...dapp.accountPreferences,
              accounts: newAccounts,
              selectedAccount:
                dapp.accountPreferences.selectedAccount === address
                  ? newAccounts[0]!
                  : dapp.accountPreferences.selectedAccount
            }
          : undefined
      })
    })

    this.emitUpdate()
  }

  /**
   * Disconnect a single connection source (e.g. only WalletConnect or only injected).
   * Broadcasts `disconnect` only to the sessions of that source. If no sources remain,
   * the dapp is fully disconnected (and removed if custom).
   */
  async disconnectDappSource(id: string, source: ConnectionSource) {
    if (!this.isReady) return

    const existing = this.#dapps.get(id)
    if (!existing) return

    const current = existing.connectedSources ?? []
    if (!current.includes(source)) return

    const nextSources = current.filter((s) => s !== source)

    await this.broadcastDappSessionEvent('disconnect', undefined, id, false, source)

    this.updateDapp(id, {
      connectedSources: nextSources,
      isConnected: nextSources.length > 0
    })
  }

  removeDapp(id: string) {
    if (!this.isReady) return

    const existing = this.#dapps.get(id)
    if (!existing) return

    if (!existing.isCustom) return

    this.#dapps.delete(id)
    void this.#storage.set('dappsV2', Array.from(this.#dapps.values()))
    void this.broadcastDappSessionEvent('disconnect', undefined, id)

    this.emitUpdate()
  }

  async addToRecentDapps(id: string) {
    await this.initialLoadPromise

    // Skip non-catalog ids (direct-URL/Google visits that don't match a known dapp).
    if (!this.#dapps.has(id)) return

    this.#recentDapps = [
      { id, openedAt: Date.now() },
      ...this.#recentDapps.filter((entry) => entry.id !== id)
    ].slice(0, DappsController.MAX_RECENT_DAPPS)

    await this.#storage.set('recentDapps', this.#recentDapps)
    this.emitUpdate()
  }

  async clearRecentDapps() {
    await this.initialLoadPromise

    if (!this.#recentDapps.length) return

    this.#recentDapps = []
    await this.#storage.set('recentDapps', this.#recentDapps)
    this.emitUpdate()
  }

  hasPermission(id: string, source?: ConnectionSource) {
    if (!id) return false

    const dapp = this.#dapps.get(id)
    if (!dapp) return false

    const sources = dapp.connectedSources ?? []
    if (source) return sources.includes(source)
    return sources.length > 0
  }

  getDapp(id: string) {
    if (!this.isReady) return

    return this.#dapps.get(id)
  }

  getDappByDomain(url: string) {
    if (!this.isReady) return

    return this.#dapps.get(getDomainFromUrl(url)!)
  }

  async setDappToConnectIfNeeded(currentRequest: UserRequest | null) {
    try {
      if (currentRequest && currentRequest.kind === 'dappConnect') {
        const { dappPromises } = currentRequest
        const existingDapp = this.#dapps.get(dappPromises[0].session.id)
        const dapp = await this.#buildDapp({
          id: dappPromises[0].session.id,
          name: dappPromises[0].session.name,
          url: dappPromises[0].session.origin,
          icon: dappPromises[0].session.icon,
          chainId: existingDapp?.chainId || 1,
          isConnected: false
        })
        if (!this.dappToConnect || this.dappToConnect.id !== dapp.id) {
          this.dappToConnect = dapp
          // Don't persist the preferences after the dapp has been disconnected
          delete this.dappToConnect.accountPreferences
          this.emitUpdate()

          const session = dappPromises[0].session

          // eslint-disable-next-line @typescript-eslint/no-floating-promises
          this.#phishing.updateDomainsBlacklistedStatus([dapp.url], (blacklistedStatus) => {
            const intrinsicStatus = blacklistedStatus[dapp.id] || 'FAILED_TO_GET'

            // Check all other sessions in the same tab/window for a dangerous context
            // (e.g. a phishing page hosting the dApp in an iframe). Context status is
            // not stored in #dapps so the dApp's global status stays uncontaminated.
            const contextStatus = this.#getTabContextStatus(session)
            // BLACKLISTED on the dApp itself always wins over any session context status.
            const effectiveStatus =
              intrinsicStatus === 'BLACKLISTED' ? 'BLACKLISTED' : (contextStatus ?? intrinsicStatus)

            if (this.dappToConnect && this.dappToConnect.id === dapp.id) {
              this.dappToConnect.blacklisted = effectiveStatus
            }

            // Update #dapps with intrinsic status only — never the context-derived one.
            const existingDapp = this.#dapps.get(dapp.id)
            if (existingDapp && existingDapp.blacklisted !== intrinsicStatus) {
              this.#dapps.set(dapp.id, { ...existingDapp, blacklisted: intrinsicStatus })
            }

            this.emitUpdate()
          })
        }

        return
      }

      if (this.dappToConnect) {
        this.dappToConnect = null
        this.emitUpdate()
      }
    } catch (err: any) {
      this.emitError({
        message: 'Error in DappsController while updating the dappToConnect',
        error: err,
        level: 'silent'
      })
    }
  }

  async getCurrentDappAndSendResToUi({
    requestId,
    dappId,
    currentSessionId = ''
  }: {
    requestId: string
    dappId: string
    currentSessionId?: string
  }) {
    const dapp = this.#dapps.get(currentSessionId) || this.#dapps.get(dappId) || null

    const message: GetCurrentDappRes = {
      type: 'GetCurrentDappRes',
      requestId,
      ok: true,
      res: dapp
    }

    this.#ui.message.sendUiMessage(message)
  }

  protected hasUnverifiedDappUrls(dapps: string[]): boolean {
    const verifiedDappUrlsSet = new Set<string>()
    for (const dapp of this.#dapps.values()) {
      if (dapp.blacklisted === 'VERIFIED') {
        verifiedDappUrlsSet.add(dapp.url.toLowerCase())
      }
    }

    return dapps.some((dappUrl) => !!dappUrl && !verifiedDappUrlsSet.has(dappUrl.toLowerCase()))
  }

  async hasUnverifiedDappsAndSendResToUi({
    requestId,
    dapps
  }: {
    requestId: string
    dapps: string[]
  }) {
    const hasUnverifiedDapps = this.hasUnverifiedDappUrls(dapps)
    const message: HasUnverifiedDappsRes = {
      type: 'HasUnverifiedDappsRes',
      requestId,
      ok: true,
      res: hasUnverifiedDapps
    }

    this.#ui.message.sendUiMessage(message)
  }

  /**
   * Returns the highest-priority dangerous status from any OTHER session sharing the same
   * tab/window as `session`. BLACKLISTED takes priority over SUSPICIOUS_HOSTING.
   *
   * This detects phishing pages that host a legitimate dApp in an iframe: the legitimate
   * dApp's own session looks clean, but the phishing page's session (e.g. sites.google.com)
   * is in the same tab and has SUSPICIOUS_HOSTING status.
   *
   * Returns `undefined` if no dangerous co-session is found, or if the status cannot yet
   * be determined (phishing DB not loaded and domain not in the static list).
   */
  #getTabContextStatus(session: Session): BlacklistedStatus | undefined {
    for (const s of Object.values(this.dappSessions)) {
      if (
        s.sessionId === session.sessionId ||
        s.tabId !== session.tabId ||
        s.windowId !== session.windowId
      ) {
        continue
      }
      const status = this.#phishing.getDomainBlacklistedStatus(s.origin)
      // Whether the co-session's domain is BLACKLISTED or SUSPICIOUS_HOSTING, the threat
      // is the same for this session: dangerous hosting context. Always return SUSPICIOUS_HOSTING
      // — BLACKLISTED belongs to the co-session's own domain, not to this dApp.
      if (status === 'BLACKLISTED' || status === 'SUSPICIOUS_HOSTING') return 'SUSPICIOUS_HOSTING'
    }
    return undefined
  }

  /**
   * Returns the highest-priority dApp verification banner for the provided dApp URLs, or `null` if none apply.
   *
   * Priority order:
   * 1) dApp is blacklisted (`BLACKLISTED`)
   * 2) dApp is hosted on a suspicious user-content platform (`SUSPICIOUS_HOSTING`)
   * 3) dApp verification in progress (`LOADING`)
   * 4) dApp verification failed / unknown (`FAILED_TO_GET` or missing status)
   * 5) dApp is verified but not in the default catalog
   *
   * Pass `includeDappNamesInText: false` in single-dApp flows (e.g. SignMessage),
   * where appending the dApp names in the banner text is redundant.
   */
  getDappVerificationBanner(
    dappUrls: string[],
    {
      includeDappNamesInText = true,
      sessionId
    }: { includeDappNamesInText?: boolean; sessionId?: string } = {}
  ): DappVerificationBanner | null {
    const validDappUrls = dappUrls
      .map((url) => url?.toLowerCase())
      .filter((url): url is string => !!url)
    if (!validDappUrls.length) return null

    const sessionForId = sessionId ? this.dappSessions[sessionId] : undefined
    const contextStatus = sessionForId ? this.#getTabContextStatus(sessionForId) : undefined

    const dappVerificationData = validDappUrls.map((url) => {
      const id = getDappIdFromUrl(url)
      const dapp = this.#dapps.get(id)

      // BLACKLISTED on the dApp itself always wins over any session context status.
      const intrinsic = dapp?.blacklisted
      return {
        id,
        // BLACKLISTED on the dApp itself always wins. While the initial storage load is still
        // pending, #dapps may be empty, so a missing record/status doesn't mean verification
        // failed - report LOADING instead (e.g. a sign request right after a service worker wake-up).
        status:
          intrinsic === 'BLACKLISTED'
            ? 'BLACKLISTED'
            : this.initialLoadPromise
              ? 'LOADING'
              : (contextStatus ?? intrinsic),
        name: dapp?.name || new URL(url).hostname
      }
    })

    // Returns the names of dApps matching a predicate (e.g. all dapps with BLACKLISTED status).
    const getDappNamesByPredicate = (
      predicate: (item: (typeof dappVerificationData)[number]) => boolean
    ) =>
      Array.from(new Set(dappVerificationData.filter(predicate).map((dapp) => dapp.name))).join(
        ', '
      )

    // Conditionally appends the matching dApp names, separated by ":" for readability.
    const withOptionalDappNames = (baseText: string, dappNames: string) => {
      if (!includeDappNamesInText || !dappNames) return baseText

      const shouldReplaceTrailingPunctuation = baseText.endsWith('.') || baseText.endsWith('!')
      const withColon = shouldReplaceTrailingPunctuation
        ? `${baseText.slice(0, -1)}:`
        : `${baseText}:`

      return `${withColon} ${dappNames}`
    }

    const isDappInDefaultCatalog = (dappId: string) => {
      const storedDapp = this.#dapps.get(dappId)

      // Custom dApps are user-added/connected entries, not default catalog entries.
      return !!storedDapp && !storedDapp.isCustom
    }

    // 1) dApp is blacklisted
    const blacklistedDappNames = getDappNamesByPredicate((dapp) => dapp.status === 'BLACKLISTED')
    if (blacklistedDappNames.length) {
      return {
        id: DAPP_VERIFICATION_BANNER_IDS.BLACKLISTED,
        type: 'error',
        text: withOptionalDappNames(
          "This app didn't pass our safety check. Proceed at your own risk.",
          blacklistedDappNames
        )
      }
    }

    // 2) dApp is hosted on a user-content platform never used by legitimate DeFi protocols
    const suspiciousHostingDappNames = getDappNamesByPredicate(
      (dapp) => dapp.status === 'SUSPICIOUS_HOSTING'
    )
    if (suspiciousHostingDappNames.length) {
      return {
        id: DAPP_VERIFICATION_BANNER_IDS.SUSPICIOUS_HOSTING,
        type: 'warning',
        text: withOptionalDappNames(
          'This app is hosted on a shared platform commonly used for phishing. Be careful - do not sign unless you are certain you trust it.',
          '' // We explicitly don't append the dApp name, because here what matters is the suspicious hosting URL, but showing the name could confuse the user, so we simply don't
        )
      }
    }

    // 3) dApp verification in progress
    const loadingDappNames = getDappNamesByPredicate((dapp) => dapp.status === 'LOADING')
    if (loadingDappNames.length) {
      return {
        id: DAPP_VERIFICATION_BANNER_IDS.LOADING,
        type: 'warning',
        text: withOptionalDappNames(
          "We're still verifying the app. Please wait, or make sure you trust it before signing requests.",
          loadingDappNames
        )
      }
    }

    // 4) dApp verification failed / unknown
    const failedToVerifyDappNames = getDappNamesByPredicate(
      (dapp) => dapp.status === 'FAILED_TO_GET' || !dapp.status
    )
    if (failedToVerifyDappNames.length) {
      return {
        id: DAPP_VERIFICATION_BANNER_IDS.FAILED_TO_GET_OR_UNKNOWN,
        type: 'warning',
        text: withOptionalDappNames(
          "We couldn't verify the app. Make sure you trust it before signing requests.",
          failedToVerifyDappNames
        )
      }
    }

    // 5) dApp is not in the default catalog
    const notInCatalogDappNames = getDappNamesByPredicate(
      (dapp) => dapp.status === 'VERIFIED' && !isDappInDefaultCatalog(dapp.id)
    )
    if (notInCatalogDappNames.length) {
      return {
        id: DAPP_VERIFICATION_BANNER_IDS.NOT_IN_CATALOG,
        type: 'warning',
        text: withOptionalDappNames(
          'App is not on the default Ambire App Catalog. Make sure you trust it before signing requests.',
          notInCatalogDappNames
        )
      }
    }

    return null
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      dapps: this.dapps,
      recentDapps: this.recentDapps,
      categories: this.categories,
      isReady: this.isReady,
      shouldRetryFetchAndUpdate: this.shouldRetryFetchAndUpdate,
      retryFetchAndUpdateInterval: this.retryFetchAndUpdateInterval,
      retryFetchAndUpdateAttempts: this.retryFetchAndUpdateAttempts
    }
  }
}
