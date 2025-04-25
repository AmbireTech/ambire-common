import { Session, SessionProp } from '../../classes/session'
import predefinedDapps from '../../consts/dappCatalog.json'
import { Dapp } from '../../interfaces/dapp'
import { Messenger } from '../../interfaces/messenger'
import { patchStorageApps } from '../../libs/dapps/helpers'
import EventEmitter from '../eventEmitter/eventEmitter'
import { StorageController } from '../storage/storage'

// The DappsController is responsible for the following tasks:
// 1. Managing the dApp catalog
// 2. Handling active sessions between dApps and the wallet
// 3. Broadcasting events from the wallet to connected dApps via the Session

// The possible events include: accountsChanged, chainChanged, disconnect, lock, unlock, and connect.

export class DappsController extends EventEmitter {
  #dapps: Dapp[] = []

  #storage: StorageController

  dappSessions: { [key: string]: Session } = {}

  // Holds the initial load promise, so that one can wait until it completes
  initialLoadPromise: Promise<void>

  constructor(storage: StorageController) {
    super()

    this.#storage = storage

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.initialLoadPromise = this.#load()
  }

  get isReady() {
    return !!this.dapps
  }

  get dapps(): Dapp[] {
    const predefinedDappsParsed = predefinedDapps.map(
      ({ url, name, icon, description }): Dapp => ({
        name,
        description,
        url,
        icon,
        isConnected: false,
        chainId: 1,
        favorite: false
      })
    )

    return [...this.#dapps, ...predefinedDappsParsed].reduce((acc: Dapp[], curr: Dapp): Dapp[] => {
      if (!acc.some(({ url }) => url === curr.url)) return [...acc, curr]
      return acc
    }, [])
  }

  set dapps(updatedDapps: Dapp[]) {
    this.#dapps = updatedDapps
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.#storage.set('dapps', updatedDapps)
  }

  async #load() {
    // Before extension version 4.55.0, dappSessions were stored in storage.
    // This logic is no longer needed, so we remove the data from the user's storage.
    // Keeping this here as a reminder to handle future use of the `dappSessions` key with caution.
    this.#storage.remove('dappSessions')
    const storedDapps = await this.#storage.get('dapps', [])

    this.#dapps = patchStorageApps(storedDapps)
    this.emitUpdate()
  }

  #dappSessionsSet(sessionId: string, session: Session) {
    this.dappSessions[sessionId] = session
  }

  #dappSessionsDelete(sessionId: string) {
    delete this.dappSessions[sessionId]
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

  setSessionLastHandledRequestsId = (key: string, id: number) => {
    if (id > this.dappSessions[key].lastHandledRequestId)
      this.dappSessions[key].lastHandledRequestId = id
  }

  resetSessionLastHandledRequestsId = (key: string) => {
    this.dappSessions[key].lastHandledRequestId = -1
  }

  setSessionProp = (key: string, props: SessionProp) => {
    this.dappSessions[key].setProp(props)
  }

  deleteDappSession = (key: string) => {
    this.#dappSessionsDelete(key)
    this.emitUpdate()
  }

  broadcastDappSessionEvent = async (
    ev: any,
    data?: any,
    origin?: string,
    skipPermissionCheck?: boolean
  ) => {
    await this.initialLoadPromise

    let dappSessions: { key: string; data: Session }[] = []
    Object.keys(this.dappSessions).forEach((key) => {
      const hasPermissionToBroadcast =
        skipPermissionCheck || this.hasPermission(this.dappSessions[key].origin)
      if (this.dappSessions[key] && hasPermissionToBroadcast) {
        dappSessions.push({ key, data: this.dappSessions[key] })
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
