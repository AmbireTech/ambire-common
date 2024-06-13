import { Session, SessionProp } from '../../classes/session'
import predefinedDapps from '../../consts/dappCatalog.json'
import { Dapp } from '../../interfaces/dapp'
import { Storage } from '../../interfaces/storage'
import EventEmitter from '../eventEmitter/eventEmitter'

// The DappsController is responsible for the following tasks:
// 1. Managing the dApp catalog
// 2. Handling active sessions between dApps and the wallet
// 3. Broadcasting events from the wallet to connected dApps via the Session

// The possible events include: accountsChanged, chainChanged, disconnect, lock, unlock, and connect.

export class DappsController extends EventEmitter {
  dappsSessionMap: Map<string, Session>

  #dapps: Dapp[] = []

  #storage: Storage

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  constructor(_storage: Storage) {
    super()

    this.dappsSessionMap = new Map<string, Session>()
    this.#storage = _storage

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load()
  }

  get isReady() {
    return !!this.dapps
  }

  get dapps(): Dapp[] {
    return this.#dapps
  }

  set dapps(updatedDapps: Dapp[]) {
    this.#dapps = updatedDapps
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#storage.set('dapps', updatedDapps)
  }

  async #load() {
    let storedDapps: Dapp[]
    storedDapps = await this.#storage.get('dapps', [])
    if (!storedDapps.length) {
      storedDapps = predefinedDapps.map((dapp) => ({
        ...dapp,
        chainId: 1,
        favorite: false,
        isConnected: false
      }))
      await this.#storage.set('dapps', storedDapps)
    }

    this.#dapps = storedDapps
    this.emitUpdate()
  }

  #createDappSession = (key: string, tabId: number, data: SessionProp | null = null) => {
    const dappSession = new Session(data, tabId)
    this.dappsSessionMap.set(key, dappSession)
    this.emitUpdate()

    return dappSession
  }

  getOrCreateDappSession = (tabId: number, origin: string) => {
    if (this.dappsSessionMap.has(`${tabId}-${origin}`)) {
      return this.dappsSessionMap.get(`${tabId}-${origin}`) as Session
    }

    return this.#createDappSession(`${tabId}-${origin}`, tabId)
  }

  deleteDappSession = (key: string) => {
    this.dappsSessionMap.delete(key)
    this.emitUpdate()
  }

  broadcastDappSessionEvent = (ev: any, data?: any, origin?: string) => {
    let dappSessions: { key: string; data: Session }[] = []
    this.dappsSessionMap.forEach((session, key) => {
      if (session && this.hasPermission(session.origin)) {
        dappSessions.push({
          key,
          data: session
        })
      }
    })

    if (origin) {
      dappSessions = dappSessions.filter((dappSession) => dappSession.data.origin === origin)
    }

    dappSessions.forEach((dappSession) => {
      try {
        dappSession.data.sendMessage?.(ev, data)
      } catch (e) {
        if (this.dappsSessionMap.has(dappSession.key)) {
          this.deleteDappSession(dappSession.key)
        }
      }
    })
    this.emitUpdate()
  }

  addDapp(dapp: Dapp) {
    if (!this.isReady) return

    const doesAlreadyExist = this.dapps.find((d) => d.url === dapp.url)
    if (doesAlreadyExist) {
      this.updateDapp(dapp.url, {
        chainId: dapp.chainId,
        isConnected: dapp.isConnected,
        favorite: dapp.favorite
      })
      return
    }
    this.dapps = [...this.dapps, dapp]
    this.emitUpdate()
  }

  updateDapp(url: string, dapp: Partial<Dapp>) {
    if (!this.isReady) return

    this.dapps = this.dapps.map((d) => {
      if (d.url === url) return { ...d, ...dapp }
      return d
    })
    this.emitUpdate()
  }

  removeDapp(url: string) {
    if (!this.isReady) return

    // do not remove predefined dapps
    if (predefinedDapps.find((d) => d.url === url)) return

    this.dapps = this.dapps.filter((d) => d.url !== url)
    this.emitUpdate()
  }

  hasPermission(url: string) {
    const dapp = this.dapps.find((d) => d.url === url)
    if (!dapp) return false

    return dapp.isConnected
  }

  getDapp(url: string) {
    if (!this.isReady) return

    return this.dapps.find((d) => d.url === url)
  }

  toJSON() {
    return {
      ...this,
      ...super.toJSON(),
      dappsSessionMap: Object.fromEntries(this.dappsSessionMap),
      dapps: this.dapps,
      isReady: this.isReady
    }
  }
}
