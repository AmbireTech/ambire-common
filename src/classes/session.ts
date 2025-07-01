import { Messenger } from '../interfaces/messenger'
import { getDappIdFromUrl } from '../libs/dapps/helpers'

export interface SessionInitProps {
  tabId?: number
  windowId?: number
  origin?: string
}
export interface SessionProp {
  icon?: string
  name?: string
  isWeb3App?: boolean
}

export function getSessionId({ tabId, windowId, origin }: SessionInitProps) {
  if (windowId) {
    return `${windowId}-${tabId}-${origin}`
  }

  return `${tabId}-${origin}`
}

// Each instance of a Session represents an active connection between a dApp and the wallet.
// For more details on how to use it, refer to the DappsController.
export class Session {
  /**
  @state {string} id = the domain of the dapp
   */
  id: string

  /**
  @state {string} origin = the url of the dapp
   */
  origin: string

  tabId: number

  windowId?: number

  name: string = ''

  icon: string = ''

  messenger?: Messenger

  // requestIds start from 0 but the default val should not be the fist req
  lastHandledRequestId: number = -1

  isWeb3App: boolean = false

  sendMessage(event: any, data: any) {
    if (!this.messenger) {
      console.error(
        `Cannot send message for session with id: ${this.sessionId} - messenger not initialized`
      )
      return
    }

    this.messenger.send('broadcast', { event, data }, { tabId: this.tabId })
  }

  constructor({ tabId, windowId, origin }: SessionInitProps = {}) {
    this.id = getDappIdFromUrl(origin)
    this.origin = origin || 'internal'
    this.tabId = tabId || Date.now()
    this.windowId = windowId
  }

  setMessenger(messenger: Messenger) {
    this.messenger = messenger
  }

  setProp({ icon, name }: SessionProp) {
    if (icon) this.icon = icon
    if (name) this.name = name
  }

  get sessionId() {
    return getSessionId({
      tabId: this.tabId,
      windowId: this.windowId,
      origin: this.origin
    })
  }

  toJSON() {
    return {
      ...this,
      sessionId: this.sessionId
    }
  }
}
