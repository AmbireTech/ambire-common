import { Messenger } from '../interfaces/messenger'

export interface SessionProp {
  origin: string
  icon: string
  name: string
}

// Each instance of a Session represents an active connection between a dApp and the wallet.
// For more details on how to use it, refer to the DappsController.
export class Session {
  origin = ''

  icon = ''

  name = ''

  tabId: number | null = null

  messenger: Messenger | null = null

  sendMessage(event: any, data: any) {
    if (this.messenger) {
      this.messenger.send('broadcast', { event, data }, { tabId: this.tabId })
    }
  }

  constructor(data?: SessionProp | null, tabId?: number) {
    if (data) {
      this.setProp(data)
    }
    if (tabId) {
      this.tabId = tabId
    }
  }

  setMessenger(messenger: Messenger) {
    this.messenger = messenger
  }

  setProp({ origin, icon, name }: SessionProp) {
    this.origin = origin
    this.icon = icon
    this.name = name
  }
}
