import { Session, SessionProp } from '../../classes/session'
import predefinedDapps from '../../consts/dappCatalog.json'
import { Dapp } from '../../interfaces/dapp'
import { Messenger } from '../../interfaces/messenger'
import { Storage } from '../../interfaces/storage'
import EventEmitter from '../eventEmitter/eventEmitter'

// The DappsController is responsible for the following tasks:
// 1. Managing the dApp catalog
// 2. Handling active sessions between dApps and the wallet
// 3. Broadcasting events from the wallet to connected dApps via the Session

// The possible events include: accountsChanged, chainChanged, disconnect, lock, unlock, and connect.

export class DappsController extends EventEmitter {
  #dapps: Dapp[] = []

  #storage: Storage

  dappSessions: { [key: string]: Session } = {}

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  constructor(_storage: Storage) {
    super()

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
    // eslint-disable-next-line prefer-const
    let [storedDapps, dappSessions] = await Promise.all([
      this.#storage.get('dapps', []),
      this.#storage.get('dappSessions', {})
    ])
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
    Object.keys(dappSessions).forEach((sessionId) => {
      const session = new Session(dappSessions[sessionId])
      this.dappSessions[sessionId] = session
    })
    this.emitUpdate()
  }

  #dappSessionsSet(sessionId: string, session: Session) {
    this.dappSessions[sessionId] = session
    this.#storage.set('dappSessions', this.dappSessions)
  }

  #dappSessionsDelete(sessionId: string) {
    delete this.dappSessions[sessionId]
    this.#storage.set('dappSessions', this.dappSessions)
  }

  #createDappSession = (data: SessionProp) => {
    const dappSession = new Session(data)
    this.#dappSessionsSet(dappSession.sessionId, dappSession)
    this.emitUpdate()

    return dappSession
  }

  getOrCreateDappSession = (data: SessionProp) => {
    if (!data.tabId || !data.origin)
      throw new Error('Invalid props passed to getOrCreateDappSession')

    if (this.dappSessions[`${data.tabId}-${data.origin}`]) {
      return this.dappSessions[`${data.tabId}-${data.origin}`]
    }

    return this.#createDappSession(data)
  }

  setSessionMessenger = (key: string, messenger: Messenger) => {
    this.dappSessions[key].setMessenger(messenger)
  }

  setSessionProp = (key: string, props: SessionProp) => {
    this.dappSessions[key].setProp(props)
  }

  deleteDappSession = (key: string) => {
    this.#dappSessionsDelete(key)
    this.emitUpdate()
  }

  broadcastDappSessionEvent = (ev: any, data?: any, origin?: string) => {
    let dappSessions: { key: string; data: Session }[] = []
    Object.keys(this.dappSessions).forEach((key) => {
      if (this.dappSessions[key] && this.hasPermission(this.dappSessions[key].origin)) {
        dappSessions.push({
          key,
          data: this.dappSessions[key]
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
        if (this.dappSessions[dappSession.key]) {
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
      dapps: this.dapps,
      isReady: this.isReady
    }
  }
}
