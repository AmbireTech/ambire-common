/* eslint-disable no-continue */
/* eslint-disable no-restricted-syntax */
import { getSessionId, Session, SessionInitProps, SessionProp } from '../../classes/session'
import {
  categoriesToNeverExclude,
  dappIdsToBeRemoved,
  defiLlamaProtocolIdsToExclude,
  featuredDapps,
  predefinedDapps
} from '../../consts/dapps'
import legacyPredefinedDapps from '../../consts/legacyDappCatalog.json'
import { Dapp, DefiLlamaChain, DefiLlamaProtocol, IDappsController } from '../../interfaces/dapp'
import { Fetch } from '../../interfaces/fetch'
import { Messenger } from '../../interfaces/messenger'
import { INetworksController } from '../../interfaces/network'
import { IStorageController } from '../../interfaces/storage'
import {
  formatDappName,
  getDappIdFromUrl,
  getIsLegacyDappStructure
} from '../../libs/dapps/helpers'
import EventEmitter from '../eventEmitter/eventEmitter'

// Create a static map for predefined dapps for efficient lookups
const legacyPredefinedDappsMap = new Map<string, typeof legacyPredefinedDapps[0]>()
legacyPredefinedDapps.forEach((dapp) => {
  const id = getDappIdFromUrl(dapp.url)
  legacyPredefinedDappsMap.set(id, dapp)
})

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

  #dapps = new Map<string, Dapp>()

  dappSessions: { [sessionId: string]: Session } = {}

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  isUpdatingDapps: boolean = false

  constructor({
    appVersion,
    fetch,
    storage,
    networks
  }: {
    appVersion: string
    fetch: Fetch
    storage: IStorageController
    networks: INetworksController
  }) {
    super()

    this.#appVersion = appVersion
    this.#fetch = fetch
    this.#storage = storage
    this.#networks = networks

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load().finally(() => {
      this.initialLoadPromise = undefined
    })
  }

  get isReady() {
    return !!this.dapps
  }

  get dapps(): Dapp[] {
    let isLegacyStructure = false

    // Detect legacy structure during map iteration (no need for Array.from)
    for (const d of this.#dapps.values()) {
      if (getIsLegacyDappStructure(d)) {
        isLegacyStructure = true
        break
      }
    }

    const sortDapps = (a: Dapp, b: Dapp) => {
      // 1. rewards.ambire.com always first
      if (a.id === 'rewards.ambire.com') return -1
      if (b.id === 'rewards.ambire.com') return 1

      // 2. Featured first, then by TVL
      return Number(b.isFeatured) - Number(a.isFeatured) || Number(b.tvl) - Number(a.tvl)
    }

    if (isLegacyStructure) {
      const result: Dapp[] = []
      const userDappsMap = this.#dapps

      for (const predefinedDapp of legacyPredefinedDapps) {
        const id = getDappIdFromUrl(predefinedDapp.url)
        const userDapp = userDappsMap.get(id)

        result.push({
          id,
          name: predefinedDapp.name,
          description: predefinedDapp.description,
          icon: predefinedDapp.icon,
          url: predefinedDapp.url,
          category: userDapp?.category ?? null,
          chainIds: userDapp?.chainIds ?? [],
          tvl: userDapp?.tvl ?? null,
          twitter: userDapp?.twitter ?? null,
          geckoId: userDapp?.geckoId ?? null,
          isConnected: userDapp?.isConnected ?? false,
          isFeatured: featuredDapps.has(id),
          isCustom: userDapp?.isCustom ?? false,
          chainId: userDapp?.chainId ?? 1,
          favorite: userDapp?.favorite ?? false,
          ...(userDapp?.grantedPermissionId && {
            grantedPermissionId: userDapp.grantedPermissionId
          }),
          ...(userDapp?.grantedPermissionAt && {
            grantedPermissionAt: userDapp.grantedPermissionAt
          }),
          ...(userDapp?.blacklisted !== undefined && { blacklisted: userDapp.blacklisted })
        })
      }

      // Add user-only dapps not in predefined list
      for (const [id, userDapp] of this.#dapps) {
        if (!legacyPredefinedDappsMap.has(id)) result.push(userDapp)
      }

      result.sort(sortDapps)
      return result
    }

    // Non-legacy flow: filter & sort directly using map iteration
    const filtered: Dapp[] = []
    for (const d of this.#dapps.values()) {
      if (d.isFeatured || d.isConnected || d.isCustom) {
        filtered.push(d)
        continue
      }

      // For non-featured dapps: exclude only those with no networks and low/no tvl
      if (
        !d.chainIds.length ||
        !(!categoriesToNeverExclude.includes(d.category as string) && d.tvl && d.tvl > 5_000_000)
      ) {
        continue
      }

      filtered.push(d)
    }

    filtered.sort(sortDapps)

    return filtered
  }

  async #load() {
    await this.#networks.initialLoadPromise
    // Before extension version 4.55.0, dappSessions were stored in storage.
    // This logic is no longer needed, so we remove the data from the user's storage.
    // Keeping this here as a reminder to handle future use of the `dappSessions` key with caution.
    this.#storage.remove('dappSessions')

    const storedDapps = await this.#storage.get('dapps', [])
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
    if (lastDappsUpdateVersion && lastDappsUpdateVersion === this.#appVersion) return
    const prevDappsArray = Array.from(prevDapps.values())

    const isLegacyStructure = prevDappsArray.some((d) => getIsLegacyDappStructure(d))
    const prevConnectedDapps = prevDappsArray.filter((d) => d.isConnected)
    const prevCustomDapps = prevDappsArray.filter(
      (d) => d.isCustom || d.description.startsWith('Custom app automatically added')
    )

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

    if (fetchedDappsList.length && fetchedChainsList.length) {
      const chainNamesToIds = new Map<string, number>()
      for (const c of fetchedChainsList) {
        chainNamesToIds.set(c.name.toLowerCase(), c.chainId)
      }

      for (const dapp of fetchedDappsList) {
        if (['CEX', 'Developer Tools'].includes(dapp.category)) continue

        if (defiLlamaProtocolIdsToExclude.includes(dapp.id)) continue

        const id = getDappIdFromUrl(dapp.url)

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
          isFeatured: featuredDapps.has(id),
          isCustom:
            !!prevStoredDapp?.isCustom ||
            !!prevStoredDapp?.description?.startsWith('Custom app automatically added'),
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
    } else {
      // fallback if fetch fails
      for (const p of isLegacyStructure
        ? prevDappsArray.map((d) => ({
            ...d,
            category: 'unknown',
            networkNames: [],
            isCustom: d?.description?.startsWith('Custom app automatically added'),
            tvl: null,
            twitter: null,
            geckoId: null
          }))
        : prevDappsArray)
        dappsMap.set(p.id, p)
    }

    // Add predefined
    for (const pd of predefinedDapps) {
      const id = getDappIdFromUrl(pd.url)

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
          isConnected: false,
          isFeatured: featuredDapps.has(id),
          isCustom: false,
          chainId: 1,
          favorite: false,
          blacklisted: false,
          twitter: null,
          geckoId: null
        })
      }
    }

    // Add connected + custom
    for (const d of [...prevConnectedDapps, ...prevCustomDapps]) {
      if (!dappsMap.has(d.id)) dappsMap.set(d.id, d)
    }

    // Delete legacy IDs
    for (const id of dappIdsToBeRemoved) dappsMap.delete(id)

    this.#dapps = dappsMap
    await this.#storage.set('dapps', Array.from(dappsMap.values()))
    await this.#storage.set('lastDappsUpdateVersion', this.#appVersion)
  }

  #createDappSession = (initProps: SessionInitProps) => {
    const dappSession = new Session(initProps)
    this.dappSessions[dappSession.sessionId] = dappSession

    this.emitUpdate()

    return dappSession
  }

  getOrCreateDappSession = (initProps: SessionInitProps) => {
    if (!initProps.tabId || !initProps.origin)
      throw new Error('Invalid props passed to getOrCreateDappSession')

    const sessionId = getSessionId(initProps)
    if (this.dappSessions[sessionId]) return this.dappSessions[sessionId]

    return this.#createDappSession(initProps)
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

  addDapp(dapp: Dapp) {
    if (!this.isReady) return

    const existing = this.#dapps.get(dapp.id)

    if (existing) {
      this.updateDapp(dapp.id, {
        chainId: dapp.chainId,
        isConnected: dapp.isConnected,
        isCustom: dapp.isCustom ?? true,
        favorite: dapp.favorite,
        grantedPermissionId: dapp.grantedPermissionId,
        grantedPermissionAt: dapp.grantedPermissionAt
      })
      return
    }

    this.#dapps.set(dapp.id, dapp)

    this.#storage.set('dapps', Array.from(this.#dapps.values()))

    this.emitUpdate()
  }

  updateDapp(id: string, dapp: Partial<Dapp>) {
    if (!this.isReady) return

    const existing = this.#dapps.get(id)
    if (!existing) return

    // Prevent renaming predefined dapps
    const predefinedDappRef = predefinedDapps.find((d) => getDappIdFromUrl(d.url) === id)
    const shouldOverrideNameChange = dapp.name && predefinedDappRef
    const dappPropsToUpdate = { ...dapp }
    if (shouldOverrideNameChange) dappPropsToUpdate.name = predefinedDappRef.name

    this.#dapps.set(id, { ...existing, ...dappPropsToUpdate })
    this.#storage.set('dapps', Array.from(this.#dapps.values()))

    this.emitUpdate()
  }

  removeDapp(id: string) {
    if (!this.isReady) return

    const existing = this.#dapps.get(id)
    if (!existing) return

    // Do not remove predefined dapps
    const isPredefined = predefinedDapps.some((d) => getDappIdFromUrl(d.url) === id)
    if (isPredefined) return

    this.#dapps.delete(id)
    this.#storage.set('dapps', Array.from(this.#dapps.values()))

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

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      dapps: this.dapps,
      isReady: this.isReady
    }
  }
}
