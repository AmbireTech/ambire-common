import { Messenger } from '../interfaces/messenger'
import { getDappIdFromUrl } from '../libs/dapps/helpers'

export interface SessionInitProps {
  url: string
  tabId: number
  windowId?: number
}
export interface SessionProp {
  icon?: string
  name?: string
  isWeb3App?: boolean
}

export function getSessionId({
  tabId,
  windowId,
  dappId
}: {
  windowId: SessionInitProps['windowId']
  tabId: SessionInitProps['tabId']
  dappId: string
}) {
  if (windowId) {
    return `${windowId}-${tabId}-${dappId}`
  }

  return `${tabId}-${dappId}`
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

  lastHandledRequestIds: { [providerId: string]: number }

  isWeb3App: boolean = false

  isAmbireNext: boolean = false

  sendMessage(event: any, data: any) {
    if (!this.messenger) {
      console.error(
        `Cannot send message for session with id: ${this.sessionId} - messenger not initialized`
      )
      return
    }

    this.messenger.send(
      this.isAmbireNext ? 'broadcast-next' : 'broadcast',
      { event, data },
      { tabId: this.tabId }
    )
  }

  constructor({ tabId, windowId, url }: SessionInitProps) {
    this.origin = new URL(url).origin
    this.id = getDappIdFromUrl(this.origin)
    this.id = getDappIdFromUrl(url)
    this.tabId = tabId || Date.now()
    this.windowId = windowId

    // Track requestIds per providerId, since we inject an EthereumProvider into all frames for the same session
    this.lastHandledRequestIds = new Proxy(
      {},
      {
        get: (target: { [providerId: string]: number }, prop: string) => {
          // When accessing an unknown providerId, initialize it with the default requestId = -1
          if (!(prop in target)) {
            // eslint-disable-next-line no-param-reassign
            target[prop] = -1
          }
          return target[prop]
        }
      }
    )
  }

  setMessenger(messenger: Messenger, isAmbireNext: boolean) {
    this.messenger = messenger
    this.isAmbireNext = isAmbireNext
  }

  setProp({ icon, name }: SessionProp) {
    if (icon) this.icon = icon
    if (name) this.name = name
  }

  get sessionId() {
    return getSessionId({ tabId: this.tabId, windowId: this.windowId, dappId: this.id })
  }

  toJSON() {
    return {
      ...this,
      sessionId: this.sessionId
    }
  }
}
