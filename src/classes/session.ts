import { Messenger } from '../interfaces/messenger'

export interface SessionProp {
  origin?: string
  icon?: string
  name?: string
  tabId?: number
}

// Each instance of a Session represents an active connection between a dApp and the wallet.
// For more details on how to use it, refer to the DappsController.
export class Session {
  origin: string = ''

  icon: string = ''

  name: string = ''

  tabId: number | null = null

  lastHandledRequestId: number = 0

  messenger: Messenger | null = null

  sendMessage(event: any, data: any) {
    if (this.messenger) {
      this.messenger.send('broadcast', { event, data }, { tabId: this.tabId })
    }
  }

  constructor(data: SessionProp) {
    this.setProp(data)
  }

  setMessenger(messenger: Messenger) {
    this.messenger = messenger
  }

  setProp({ origin, icon, name, tabId }: SessionProp) {
    if (origin) this.origin = origin
    if (icon) this.icon = icon
    if (name) this.name = name
    if (tabId) this.tabId = tabId
  }

  get sessionId() {
    return `${this.tabId}-${this.origin}`
  }

  toJSON() {
    return {
      ...this,
      sessionId: this.sessionId
    }
  }
}
