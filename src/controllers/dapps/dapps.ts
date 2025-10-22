import { getSessionId, Session, SessionInitProps, SessionProp } from '../../classes/session'
import { dappIdsToBeRemoved, featuredDapps, predefinedDapps } from '../../consts/dapps'
import legacyPredefinedDapps from '../../consts/legacyDappCatalog.json'
import { Dapp, DefiLlamaProtocol, IDappsController } from '../../interfaces/dapp'
import { Fetch } from '../../interfaces/fetch'
import { Messenger } from '../../interfaces/messenger'
import { INetworksController } from '../../interfaces/network'
import { IStorageController } from '../../interfaces/storage'
import { getDappIdFromUrl, patchStorageApps } from '../../libs/dapps/helpers'
import EventEmitter from '../eventEmitter/eventEmitter'

// Create a static map for predefined dapps for efficient lookups
<<<<<<< HEAD
const legacyPredefinedDappsMap = new Map<string, typeof legacyPredefinedDapps[0]>()
legacyPredefinedDapps.forEach((dapp) => {
=======
const predefinedDappsMap = new Map<string, typeof predefinedDapps[0]>()
predefinedDapps.forEach((dapp) => {
>>>>>>> v2
  const id = getDappIdFromUrl(dapp.url)
  legacyPredefinedDappsMap.set(id, dapp)
})

// The DappsController is responsible for the following tasks:
// 1. Managing the dApp catalog
// 2. Handling active sessions between dApps and the wallet
// 3. Broadcasting events from the wallet to connected dApps via the Session

// The possible events include: accountsChanged, chainChanged, disconnect, lock, unlock, and connect.

export class DappsController extends EventEmitter implements IDappsController {
  #dapps: Dapp[] = []

  #lastDappsUpdateVersion: string | null = null

  #fetch: Fetch

  #storage: IStorageController

  #networks: INetworksController

  #isLegacyStructure: boolean = false

  dappSessions: { [sessionId: string]: Session } = {}

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise?: Promise<void>

  isUpdatingDapps: boolean = false

  constructor({
    fetch,
    storage,
    networks
  }: {
    fetch: Fetch
    storage: IStorageController
    networks: INetworksController
  }) {
    super()

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
    // Create a map for faster lookups of user dapps
    const userDappsMap = new Map<string, Dapp>()
    this.#dapps.forEach((dapp) => {
      userDappsMap.set(dapp.id, dapp)
    })

    if (this.#isLegacyStructure) {
      // Start with predefined dapps first (maintaining order)
      const result: Dapp[] = []
      legacyPredefinedDapps.forEach((predefinedDapp) => {
        const id = getDappIdFromUrl(predefinedDapp.url)
        const userDapp = userDappsMap.get(id)

        result.push({
          id,
          // Take metadata from predefined dapp
          name: predefinedDapp.name,
          description: predefinedDapp.description,
          icon: predefinedDapp.icon,
          url: predefinedDapp.url,
          // Take user data if available, otherwise use defaults
          category: userDapp?.category ?? null,
          networkNames: userDapp?.networkNames ?? [],
          tvl: userDapp?.tvl ?? null,
          twitter: userDapp?.twitter ?? null,
          geckoId: userDapp?.geckoId ?? null,
          isConnected: userDapp?.isConnected ?? false,
          isFeatured: featuredDapps.has(id),
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
      })

      // Add user-only dapps (not in predefined list)
      this.#dapps.forEach((userDapp) => {
        if (!legacyPredefinedDappsMap.has(userDapp.id)) result.push(userDapp)
      })

      return result
    }

    return this.#dapps
      .filter((d) => {
        if (!d.isFeatured && !d.networkNames.length) return false
        if (d.isFeatured) return true
        if (d.tvl && d.tvl > 10000000) return true
        return false
      })
      .sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured) || Number(b.tvl) - Number(a.tvl))
  }

  set dapps(updatedDapps: Dapp[]) {
    this.#dapps = updatedDapps
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#storage.set('dapps', updatedDapps)
  }

  async #load() {
    await this.#networks.initialLoadPromise
    // Before extension version 4.55.0, dappSessions were stored in storage.
    // This logic is no longer needed, so we remove the data from the user's storage.
    // Keeping this here as a reminder to handle future use of the `dappSessions` key with caution.
    this.#storage.remove('dappSessions')

    const [storedDapps, lastDappsUpdateVersion] = await Promise.all([
      this.#storage.get('dapps', []),
      this.#storage.get('lastDappsUpdateVersion', null)
    ])
    this.fetchAndUpdateDapps(storedDapps, lastDappsUpdateVersion)
    this.#dapps = storedDapps
  }

  async fetchAndUpdateDapps(prevDapps: Dapp[], lastDappsUpdateVersion: string | null) {
    this.isUpdatingDapps = true
    await this.#fetchAndUpdateDapps(prevDapps, lastDappsUpdateVersion)
    this.isUpdatingDapps = false
  }

  async #fetchAndUpdateDapps(prevDapps: Dapp[], lastDappsUpdateVersion: string | null) {
    let updatedDapps = []
    let fetchedDappsList: DefiLlamaProtocol[] = []

    try {
      const dappsUrl = 'https://api.llama.fi/protocols'

      const resp = await this.#fetch(dappsUrl)
      fetchedDappsList = await resp.json()
    } catch (err) {
      console.error('Dapps fetch failed:', err)
    }

    if (!fetchedDappsList.length) {
      const isLegacyStructure = prevDapps.every((d) => !d.networkNames && !d.tvl && !d.category)
      updatedDapps = patchStorageApps(
        isLegacyStructure
          ? prevDapps.map((p) => ({
              ...p,
              category: 'unknown',
              networkNames: [],
              tvl: null,
              twitter: null,
              geckoId: null
            }))
          : prevDapps
      )
      this.#isLegacyStructure = true
    }

    updatedDapps = fetchedDappsList.reduce((acc: Dapp[], dapp: DefiLlamaProtocol) => {
      if (dapp.category === 'CEX') return acc

      const prevStoredDapp = prevDapps.find(
        (d) => getDappIdFromUrl(d.url) === getDappIdFromUrl(dapp.url)
      )

      const id = prevStoredDapp?.id || getDappIdFromUrl(dapp.url)

      if (dappIdsToBeRemoved.has(id)) return acc

      const updatedDapp: Dapp = {
        id,
        name: dapp.name,
        description: dapp.description,
        url: dapp.url,
        icon: dapp.logo,
        category: dapp.category,
        tvl: dapp.tvl,
        networkNames: dapp.chains.filter((c) =>
          this.#networks.networks.some((n) => n.name.toLowerCase() === c.toLowerCase())
        ),
        isConnected: prevStoredDapp?.isConnected || false,
        isFeatured: featuredDapps.has(id),
        chainId: prevStoredDapp?.chainId || 1,
        favorite: prevStoredDapp?.favorite || false,
        blacklisted: prevStoredDapp?.blacklisted || false,
        twitter: dapp.twitter,
        geckoId: dapp.gecko_id,
        grantedPermissionId: prevStoredDapp?.grantedPermissionId,
        grantedPermissionAt: prevStoredDapp?.grantedPermissionAt
      }

      acc.push(updatedDapp)
      return acc
    }, [])

    const extendedPredefined = predefinedDapps.map((pd) => {
      const id = getDappIdFromUrl(pd.url)
      const prevStoredDapp = prevDapps.find((d) => d.id === id)
      return {
        id,
        name: pd.name,
        description: pd.description,
        url: pd.url,
        icon: pd.icon,
        category: null,
        tvl: null,
        networkNames: pd.networkNames || [],
        isConnected: prevStoredDapp?.isConnected || false,
        isFeatured: featuredDapps.has(id),
        chainId: prevStoredDapp?.chainId || 1,
        favorite: prevStoredDapp?.favorite || false,
        blacklisted: prevStoredDapp?.blacklisted || false,
        twitter: null,
        geckoId: null,
        grantedPermissionId: prevStoredDapp?.grantedPermissionId,
        grantedPermissionAt: prevStoredDapp?.grantedPermissionAt
      }
    })

    const existingIds = new Set(updatedDapps.map((d) => d.id))
    // eslint-disable-next-line no-restricted-syntax
    for (const d of extendedPredefined) if (!existingIds.has(d.id)) updatedDapps.push(d)

    this.#dapps = updatedDapps
    // this.#lastDappsUpdateVersion =

    this.emitUpdate()
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

    const doesAlreadyExist = this.dapps.find((d) => d.id === dapp.id)

    if (doesAlreadyExist) {
      this.updateDapp(dapp.id, {
        chainId: dapp.chainId,
        isConnected: dapp.isConnected,
        favorite: dapp.favorite,
        grantedPermissionId: dapp.grantedPermissionId,
        grantedPermissionAt: dapp.grantedPermissionAt
      })
      return
    }
    this.dapps = [...this.dapps, dapp]
    this.emitUpdate()
  }

  updateDapp(id: string, dapp: Partial<Dapp>) {
    if (!this.isReady) return

    // Override the name of a dapp that's in our predefined list
    const predefinedDappRef = predefinedDapps.find((d) => getDappIdFromUrl(d.url) === id)
    const shouldOverrideNameChange = dapp.name && predefinedDappRef
    const dappPropsToUpdate = { ...dapp }
    if (shouldOverrideNameChange) dappPropsToUpdate.name = predefinedDappRef.name

    this.dapps = this.dapps.map((d) => {
      if (d.id === id) return { ...d, ...dappPropsToUpdate }
      return d
    })
    this.emitUpdate()
  }

  removeDapp(id: string) {
    if (!this.isReady) return

    const dapp = this.dapps.find((d) => d.id === id)

    if (!dapp) return

    // do not remove predefined dapps
    if (predefinedDapps.find((d) => getDappIdFromUrl(d.url) === dapp.id)) return
    this.dapps = this.dapps.filter((d) => d.id !== id)

    this.emitUpdate()
  }

  hasPermission(id: string) {
    if (!id) return false

    const dapp = this.dapps.find((d) => d.id === id)
    if (!dapp) return false

    return dapp.isConnected
  }

  getDapp(id: string) {
    if (!this.isReady) return

    return this.dapps.find((d) => d.id === id)
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
