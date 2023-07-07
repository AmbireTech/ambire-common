import { EmailVault } from '../libs/emailVault/emailVault'
import { requestMagicLink } from '../libs/magicLink/magicLink'
import { EmailVaultData } from '../interfaces/emailVault'
import { Storage } from '../interfaces/storage'
import EventEmitter from './eventEmitter'

enum State {
  'loading',
  'waitingEmailConfirmation',
  'ready'
}

export type MagicLinkKey = {
  key: string
  requestedAt: Date
  confirmed: boolean
}

export type MagicLinkKeys = {
  [email: string]: MagicLinkKey
}

export class EmailVaultController extends EventEmitter {
  private storage: Storage

  private initialLoadPromise: Promise<void>

  magicLinkLifeTime: number = 300000

  magicLinkKeys: MagicLinkKeys = {}

  isReady: boolean = false

  lastUpdate: Date = new Date()

  emailVaultStates: EmailVaultData[] = []

  isWaitingEmailConfirmation: boolean = false

  fetch: Function

  relayerUrl: string

  emailVault: EmailVault

  constructor(storage: Storage, fetch: Function, relayerUrl: string) {
    super()
    this.fetch = fetch
    this.relayerUrl = relayerUrl
    this.storage = storage
    this.emailVault = new EmailVault(fetch, relayerUrl)
    this.initialLoadPromise = this.load()
  }

  private async load(): Promise<void> {
    this.isReady = false
    ;[this.emailVaultStates, this.magicLinkKeys] = await Promise.all([
      this.storage.get('emailVault', []),
      this.storage.get('magicLinkKeys', {})
    ])

    this.lastUpdate = new Date()
    this.isReady = true
    this.emitUpdate()
  }

  verifiedMagicLinkKey(email: string) {
    if (!this.magicLinkKeys[email]) return
    this.magicLinkKeys[email].confirmed = true
  }

  getCurrentState(): string {
    if (!this.isReady) return State[0]
    if (this.isWaitingEmailConfirmation) return State[1]
    return State[2]
  }

  async requestNewMagicLinkKey(email: string) {
    await this.initialLoadPromise
    const result = await requestMagicLink(email, this.relayerUrl, this.fetch)
    const newKey = {
      key: result.key,
      requestedAt: new Date(),
      confirmed: false
    }
    this.magicLinkKeys[email] = {
      ...newKey,
      confirmed: false
    }
    return this.magicLinkKeys[email]
  }

  async getMagicLinkKey(email: string): Promise<MagicLinkKey | null> {
    await this.initialLoadPromise
    const result = this.magicLinkKeys[email]
    if (!result) return null
    if (new Date().getTime() - result.requestedAt.getTime() > this.magicLinkLifeTime) return null
    return result
  }

  async login(email: string) {
    const existsMagicKey = await this.getMagicLinkKey(email)

    const key = existsMagicKey || (await this.requestNewMagicLinkKey(email))
    // await this.loginProceed(email)
    if (key.confirmed) {
      await this.loginProceed(email)
    } else {
      await this.pooling(this.loginProceed.bind(this), [email])
    }
  }

  async loginProceed(email: string): Promise<boolean | null> {
    this.isWaitingEmailConfirmation = true
    if (!this.magicLinkKeys[email]) {
      this.emitUpdate()
      return false
    }

    // ToDo if result not success
    const result: EmailVaultData | null = await this.emailVault
      .getEmailVaultInfo(email, this.magicLinkKeys[email].key)
      .catch(() => null)

    if (!result) {
      this.emitUpdate()
      return false
    }

    if (!this.emailVaultStates.find((ev: EmailVaultData) => ev.email === result.email)) {
      this.emailVaultStates.push(result)
    } else {
      this.emailVaultStates = this.emailVaultStates.map((ev: EmailVaultData) => {
        if (ev.email !== result.email) return ev
        return result
      })
    }

    // this will trigger the update event
    this.isWaitingEmailConfirmation = false
    this.emitUpdate()
    return true
  }

  async pooling(fn: Function, params: any) {
    setTimeout(async () => {
      const result = await fn(...params)
      if (result) return true
      return this.pooling(fn, params)
    }, 2000)
  }
}
