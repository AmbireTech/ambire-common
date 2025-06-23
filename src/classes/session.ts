import { Messenger } from '../interfaces/messenger'
import { getDappIdFromUrl } from '../libs/dapps/helpers'

export interface SessionInitProps {
  tabId: number
  origin: string
}
export interface SessionProp {
  icon?: string
  name?: string
  isWeb3App?: boolean
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

  constructor({ tabId, origin }: SessionInitProps) {
    this.id = getDappIdFromUrl(origin)
    this.origin = origin
    this.tabId = tabId
  }

  setMessenger(messenger: Messenger) {
    this.messenger = messenger
  }

  setProp({ icon, name }: SessionProp) {
    if (icon) this.icon = icon
    if (name) this.name = name
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
