import { Session, SessionProp } from '../../classes/session'
import predefinedDapps from '../../consts/dappCatalog.json'
import { Dapp } from '../../interfaces/dapp'
import { Messenger } from '../../interfaces/messenger'
import { patchStorageApps } from '../../libs/dapps/helpers'
import getDomainFromUrl from '../../utils/getDomainFromUrl'
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
      ({ url, name, icon, description }): Omit<Dapp, 'id'> => ({
        name,
        description,
        url,
        icon,
        isConnected: false,
        chainId: 1,
        favorite: false
      })
    )

    const combined = [...this.#dapps, ...predefinedDappsParsed]

    const combinedWithId = combined.map((d) => {
      if ((d as Dapp).id) return d

      return { id: getDomainFromUrl(d.url), ...d }
    }) as Dapp[]

    return combinedWithId.reduce((acc: Dapp[], curr: Dapp): Dapp[] => {
      if (!acc.some((dapp) => dapp.id === curr.id)) {
        acc.push(curr)
      }

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

  setSessionLastHandledRequestsId = (key: string, id: number, isWeb3AppRequest?: boolean) => {
    if (id > this.dappSessions[key].lastHandledRequestId) {
      this.dappSessions[key].lastHandledRequestId = id
      if (isWeb3AppRequest && !this.dappSessions[key].isWeb3App) {
        this.dappSessions[key].isWeb3App = true
        this.emitUpdate()
      }
    }
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
    id?: string,
    skipPermissionCheck?: boolean
  ) => {
    await this.initialLoadPromise

    let dappSessions: { key: string; data: Session }[] = []
    Object.keys(this.dappSessions).forEach((key) => {
      const hasPermissionToBroadcast =
        skipPermissionCheck || this.hasPermission(this.dappSessions[key].id)
      if (this.dappSessions[key] && hasPermissionToBroadcast) {
        dappSessions.push({ key, data: this.dappSessions[key] })
      }
    })
    if (id) {
      dappSessions = dappSessions.filter((dappSession) => dappSession.data.id === id)
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

    this.dapps = this.dapps.map((d) => {
      if (d.id === id) return { ...d, ...dapp }
      return d
    })
    this.emitUpdate()
  }

  removeDapp(id: string) {
    if (!this.isReady) return

    const dapp = this.dapps.find((d) => d.id === id)

    if (!dapp) return

    // do not remove predefined dapps
    if (predefinedDapps.find((d) => d.url === dapp.url)) return
    this.dapps = this.dapps.filter((d) => d.id !== id)

    this.emitUpdate()
  }

  hasPermission(id: string) {
    if (!id) return false

    const dapp = this.dapps.find((d) => d.id === id)
    console.log('hasPermission', dapp)
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
