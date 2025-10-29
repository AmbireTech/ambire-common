/* eslint-disable no-continue */
import {
  IRecurringTimeout,
  RecurringTimeout
} from '../../classes/recurringTimeout/recurringTimeout'
import { getSessionId, Session, SessionInitProps, SessionProp } from '../../classes/session'
import {
  categoriesNotToFilterOut,
  dappIdsToBeRemoved,
  defiLlamaProtocolIdsToExclude,
  featuredDapps,
  predefinedDapps
} from '../../consts/dapps'
import { Dapp, DefiLlamaChain, DefiLlamaProtocol, IDappsController } from '../../interfaces/dapp'
import { Fetch } from '../../interfaces/fetch'
import { Messenger } from '../../interfaces/messenger'
import { INetworksController } from '../../interfaces/network'
/* eslint-disable no-restricted-syntax */
import { IPhishingController } from '../../interfaces/phishing'
import { IStorageController } from '../../interfaces/storage'
import { IUiController } from '../../interfaces/ui'
import {
  formatDappName,
  getDappIdFromUrl,
  getDomainFromUrl,
  sortDapps
} from '../../libs/dapps/helpers'
import { networkChainIdToHex } from '../../libs/networks/networks'
import EventEmitter from '../eventEmitter/eventEmitter'

// The DappsController is responsible for the following tasks:
// 1. Managing the dApp catalog
// 2. Handling active sessions between dApps and the wallet
// 3. Broadcasting events from the wallet to connected dApps via the Session
// The possible events include: accountsChanged, chainChanged, disconnect, lock, unlock, and connect.
export class DappsController extends EventEmitter implements IDappsController {
  #appVersion: string

  #fetch: Fetch

  #storage: IStorageController

  #networks: INetworksController

  #phishing: IPhishingController

  #ui: IUiController

  #dapps = new Map<string, Dapp>()

  dappSessions: { [sessionId: string]: Session } = {}

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  isUpdatingDapps: boolean = false

  #inactivityInterval: IRecurringTimeout

  #fetchAndUpdateFailed: boolean = false

  #fetchAndUpdateAttempts: number = 0

  #fetchAndUpdateMaxAttempts: number = 3

  constructor({
    appVersion,
    fetch,
    storage,
    networks,
    phishing,
    ui
  }: {
    appVersion: string
    fetch: Fetch
    storage: IStorageController
    networks: INetworksController
    phishing: IPhishingController
    ui: IUiController
  }) {
    super()

    this.#appVersion = appVersion
    this.#fetch = fetch
    this.#storage = storage
    this.#networks = networks
    this.#phishing = phishing
    this.#ui = ui

    this.#inactivityInterval = new RecurringTimeout(
      // id initial fetch and update failed retry after 5 minutes of user inactivity
      () => this.#fetchAndUpdateDapps(this.#dapps),
      5 * 1000 // 5min.
    )

    this.#ui.onUpdate(() => {
      if (
        !this.#ui.views.some((v) => v.type === 'popup') &&
        this.#fetchAndUpdateFailed &&
        this.#fetchAndUpdateAttempts < this.#fetchAndUpdateMaxAttempts
      ) {
        this.#inactivityInterval.start()
      }

      if (this.#ui.views.some((v) => v.type === 'popup') && this.#inactivityInterval.running) {
        this.#inactivityInterval.stop()
      }
    })

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
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
      if (d.isFeatured || d.isConnected || d.isCustom) continue

      const shouldSkipByCategory = !categoriesNotToFilterOut.includes(d.category as string)
      const hasNoNetworks = d.chainIds.length === 0
      const hasLowTVL = !d.tvl || d.tvl <= 5_000_000

      // Remove dapps that are not in excluded categories and either have no networks or low TVL
      if (shouldSkipByCategory && (hasNoNetworks || hasLowTVL)) {
        filteredMap.delete(key)
      }
    }

    for (const [, d] of filteredMap) {
      const domainId = getDomainFromUrl(d.url)
      if (!domainId) continue

      // If the dapp's id is NOT its domain and there's already a dapp using that domain id → delete the dapp with that domain
      if (domainId !== d.id && filteredMap.has(domainId)) filteredMap.delete(domainId)
    }

    return Array.from(filteredMap.values()).sort(sortDapps)
  }

  get categories(): string[] {
    return [...new Set(this.dapps.map((d) => d.category!).filter((c) => !!c && c !== 'CEX'))].sort()
  }

  async #load() {
    await this.#networks.initialLoadPromise

    const storedDapps = await this.#storage.get('dappsV2', [])
    this.#dapps = new Map(storedDapps.map((d) => [d.id, d]))

    this.fetchAndUpdateDapps(this.#dapps)
  }

  async fetchAndUpdateDapps(prevDapps: Map<string, Dapp>) {
    this.isUpdatingDapps = true
    this.emitUpdate()
    await this.#fetchAndUpdateDapps(prevDapps)
    this.isUpdatingDapps = false
    this.emitUpdate()
  }

  async #fetchAndUpdateDapps(prevDapps: Map<string, Dapp>) {
    const lastDappsUpdateVersion = await this.#storage.get('lastDappsUpdateVersion', null)
    // NOTE: For debugging, you can comment out this line
    // to fetch and update dapps on every extension restart.
    if (lastDappsUpdateVersion && lastDappsUpdateVersion === this.#appVersion) return

    if (this.#fetchAndUpdateFailed) {
      this.#fetchAndUpdateAttempts += 1
    }

    const dappsMap = new Map()

    let fetchedDappsList: DefiLlamaProtocol[] = []
    let fetchedChainsList: DefiLlamaChain[] = []
    try {
      const [res, chainsRes] = await Promise.all([
        this.#fetch('https://api.llama.fi/protocols'),
        this.#fetch('https://api.llama.fi/v2/chains')
      ])

      if (!res.ok || !chainsRes.ok) {
        throw new Error(`Fetch failed: protocols=${res.status}, chains=${chainsRes.status}`)
      }

      ;[fetchedDappsList, fetchedChainsList] = await Promise.all([res.json(), chainsRes.json()])
    } catch (err) {
      console.error('Dapps fetch failed:', err)
    }

    if (!fetchedDappsList.length || !fetchedChainsList.length) {
      this.#fetchAndUpdateFailed = true

      // run the interval if the initial fetch failed while the extension is not in use
      if (!this.#fetchAndUpdateAttempts && !this.#ui.views.some((v) => v.type === 'popup')) {
        this.#inactivityInterval.start()
      } else {
        this.#inactivityInterval.stop()
      }
      return
    }

    const chainNamesToIds = new Map<string, number>()
    for (const c of fetchedChainsList) {
      chainNamesToIds.set(c.name.toLowerCase(), c.chainId)
    }

    const nonEvmChainsByName = fetchedChainsList
      .filter((c) => !c.chainId)
      .map((c) => c.name.toLowerCase())

    for (const dapp of fetchedDappsList) {
      if (['CEX', 'Developer Tools'].includes(dapp.category)) continue

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

      const updatedDapp: Dapp = {
        id,
        name: formatDappName(dapp.name),
        description: dapp.description,
        url: dapp.url,
        icon: dapp.logo,
        category: dapp.category,
        tvl: dapp.tvl,
        chainIds,
        isConnected: prevStoredDapp?.isConnected || false,
        isFeatured: featuredDapps.has(id) || featuredDapps.has(getDomainFromUrl(dapp.url)!),
        isCustom: !!prevStoredDapp?.isCustom,
        chainId: prevStoredDapp?.chainId || 1,
        favorite: !!prevStoredDapp?.favorite,
        blacklisted: !!prevStoredDapp?.blacklisted,
        twitter: dapp.twitter,
        geckoId: dapp.gecko_id,
        grantedPermissionId: prevStoredDapp?.grantedPermissionId,
        grantedPermissionAt: prevStoredDapp?.grantedPermissionAt
      }

      if (!dappsMap.has(id)) dappsMap.set(id, updatedDapp)
    }

    // Add predefined
    for (const pd of predefinedDapps) {
      const id = getDappIdFromUrl(pd.url)

      const prevStoredDapp = prevDapps.get(id)

      if (!dappsMap.has(id)) {
        dappsMap.set(id, {
          id,
          name: formatDappName(pd.name),
          description: pd.description,
          url: pd.url,
          icon: pd.icon,
          category: null,
          tvl: null,
          chainIds: pd.chainIds || [],
          isConnected: prevStoredDapp?.isConnected ?? false,
          isFeatured: featuredDapps.has(id) || featuredDapps.has(getDomainFromUrl(pd.url)!),
          isCustom: false,
          chainId: prevStoredDapp?.chainId ?? 1,
          favorite: prevStoredDapp?.favorite ?? false,
          blacklisted: prevStoredDapp?.blacklisted ?? false,
          twitter: pd.twitter,
          geckoId: null
        })
      }
    }

    const prevDappsArray = Array.from(prevDapps.values())
    const prevConnectedDapps = prevDappsArray.filter((d) => d.isConnected)
    const prevCustomDapps = prevDappsArray.filter((d) => d.isCustom)

    // Add connected + custom
    for (const d of [...prevConnectedDapps, ...prevCustomDapps]) {
      if (!dappsMap.has(d.id)) dappsMap.set(d.id, d)
    }

    // Delete legacy IDs
    for (const id of dappIdsToBeRemoved) dappsMap.delete(id)

    this.#dapps = dappsMap
    await this.#storage.set('dappsV2', Array.from(dappsMap.values()))
    await this.#storage.set('lastDappsUpdateVersion', this.#appVersion)
    this.#fetchAndUpdateFailed = false
    this.#inactivityInterval.stop()
  }

  async #createDappSession(initProps: SessionInitProps) {
    await this.initialLoadPromise
    const dappSession = new Session(initProps)
    this.dappSessions[dappSession.sessionId] = dappSession

    this.emitUpdate()

    return dappSession
  }

  async getOrCreateDappSession({ windowId, tabId, url }: SessionInitProps) {
    if (!tabId || !url) throw new Error('Invalid props passed to getOrCreateDappSession')

    const dappId = getDappIdFromUrl(url)
    const sessionId = getSessionId({ windowId, tabId, dappId })
    if (this.dappSessions[sessionId]) return this.dappSessions[sessionId]

    return this.#createDappSession({ windowId, tabId, url })
  }

  setSessionMessenger = (sessionId: string, messenger: Messenger, isAmbireNext: boolean) => {
    this.dappSessions[sessionId].setMessenger(messenger, isAmbireNext)
  }

  setSessionLastHandledRequestsId = (
    sessionId: string,
    providerId: number,
    id: number,
    isWeb3AppRequest?: boolean
  ) => {
    if (!this.dappSessions[sessionId]) return

    if (id > this.dappSessions[sessionId].lastHandledRequestIds[providerId]) {
      this.dappSessions[sessionId].lastHandledRequestIds[providerId] = id
      if (isWeb3AppRequest && !this.dappSessions[sessionId].isWeb3App) {
        this.dappSessions[sessionId].isWeb3App = true
        this.emitUpdate()
      }
    }
  }

  resetSessionLastHandledRequestsId = (sessionId: string, providerId?: number) => {
    if (providerId) {
      this.dappSessions[sessionId].lastHandledRequestIds[providerId] = -1
    } else {
      Object.keys(this.dappSessions[sessionId].lastHandledRequestIds).forEach((key) => {
        this.dappSessions[sessionId].lastHandledRequestIds[key] = -1
      })
    }
  }

  setSessionProp = (sessionId: string, props: SessionProp) => {
    this.dappSessions[sessionId].setProp(props)
  }

  deleteDappSession = (sessionId: string) => {
    delete this.dappSessions[sessionId]

    this.emitUpdate()
  }

  broadcastDappSessionEvent = async (
    ev: any,
    data?: any,
    id?: string,
    skipPermissionCheck?: boolean
  ) => {
    await this.initialLoadPromise

    let dappSessions: { sessionId: string; data: Session }[] = []
    Object.keys(this.dappSessions).forEach((sessionId) => {
      const hasPermissionToBroadcast =
        skipPermissionCheck || this.hasPermission(this.dappSessions[sessionId].id)
      if (this.dappSessions[sessionId] && hasPermissionToBroadcast) {
        dappSessions.push({ sessionId, data: this.dappSessions[sessionId] })
      }
    })
    if (id) {
      dappSessions = dappSessions.filter((dappSession) => dappSession.data.id === id)
    }

    dappSessions.forEach((dappSession) => {
      try {
        dappSession.data.sendMessage?.(ev, data)
      } catch (e) {
        if (this.dappSessions[dappSession.sessionId]) {
          this.deleteDappSession(dappSession.sessionId)
        }
      }
    })
  }

  async addDapp(dapp: {
    id: Dapp['id']
    name: Dapp['name']
    url: Dapp['url']
    icon: Dapp['icon']
    chainId?: Dapp['chainId']
    isConnected: Dapp['isConnected']
  }) {
    if (!this.isReady) return

    const existing = this.#dapps.get(dapp.id)

    const network = this.#networks.allNetworks.find(
      (n) => n.chainId.toString() === dapp.chainId?.toString()
    )

    const DEFAULT_CHAIN_ID = 1

    if (existing) {
      this.updateDapp(dapp.id, {
        chainId: network ? dapp.chainId! : DEFAULT_CHAIN_ID,
        isConnected: dapp.isConnected
      })
      return
    }

    const existingByDomain = this.#dapps.get(getDomainFromUrl(dapp.url)!)

    this.#dapps.set(dapp.id, {
      id: dapp.id,
      url: dapp.url,
      name: existingByDomain?.name || dapp.name,
      chainId: network ? dapp.chainId! : DEFAULT_CHAIN_ID,
      description: existingByDomain?.description || '',
      icon: existingByDomain?.icon || dapp.icon,
      category: existingByDomain?.category || null,
      favorite: existingByDomain?.favorite || false,
      isConnected: dapp.isConnected,
      chainIds: existingByDomain?.chainIds || [],
      isFeatured: existingByDomain?.isFeatured || false,
      isCustom: existingByDomain?.isCustom ?? true,
      tvl: existingByDomain?.tvl || null,
      blacklisted: await this.#phishing.getIsBlacklisted(dapp.url),
      geckoId: existingByDomain?.geckoId || null,
      twitter: existingByDomain?.twitter || null
    })

    await this.#storage.set('dappsV2', Array.from(this.#dapps.values()))
    this.emitUpdate()

    if (dapp.isConnected) {
      await this.broadcastDappSessionEvent(
        'chainChanged',
        {
          chain: networkChainIdToHex(dapp.chainId || DEFAULT_CHAIN_ID),
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

    // remove the custom dapp if it gets disconnected
    if (dapp.isConnected !== undefined) {
      if (existing.isCustom && !dapp.isConnected && existing.isConnected) {
        this.removeDapp(id)
        return
      }
    }

    const dappPropsToUpdate = { ...dapp }
    const existingByDomain = this.#dapps.get(getDomainFromUrl(existing.url)!)

    if (!existing.isCustom) dappPropsToUpdate.name = existing.name
    if (existingByDomain && existing.isCustom) {
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
    this.#storage.set('dappsV2', Array.from(this.#dapps.values()))

    this.emitUpdate()
  }

  removeDapp(id: string) {
    if (!this.isReady) return

    const existing = this.#dapps.get(id)
    if (!existing) return

    if (!existing.isCustom) return

    this.#dapps.delete(id)
    this.#storage.set('dappsV2', Array.from(this.#dapps.values()))
    this.broadcastDappSessionEvent('disconnect', undefined, id)

    this.emitUpdate()
  }

  hasPermission(id: string) {
    if (!id) return false

    const dapp = this.#dapps.get(id)
    if (!dapp) return false

    return dapp.isConnected
  }

  getDapp(id: string) {
    if (!this.isReady) return

    return this.#dapps.get(id)
  }

  getDappByDomain(url: string) {
    if (!this.isReady) return

    return this.#dapps.get(getDomainFromUrl(url)!)
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      dapps: this.dapps,
      categories: this.categories,
      isReady: this.isReady
    }
  }
}
