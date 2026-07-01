import { Messenger } from '../interfaces/messenger'
import { getDappIdFromUrl } from '../libs/dapps/helpers'

export interface SessionInitProps {
  url?: string
  tabId?: number
  windowId?: number
  wcTopic?: string
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

  wcTopic?: string

  lastHandledRequestIds: { [providerId: string]: number }

  isWeb3App: boolean = false

  isAmbireNext: boolean = false

  sendMessage(event: any, data: any) {
    if (!this.messenger) {
      if (this.wcTopic && this.wcTopic.startsWith('temp_wallet_connect_session')) return

      console.error(
        `[Session] Cannot send message for session with id: ${this.sessionId} - messenger not initialized.`
      )
      return
    }

    // SECURITY: include the session origin so platform messengers (e.g. mobile)
    // can verify the WebView is still on the intended origin before delivering
    // the broadcast. This prevents accountsChanged/chainChanged leakage to a
    // page the user has navigated to during an async operation.
    this.messenger.send(
      this.isAmbireNext ? 'broadcast-next' : 'broadcast',
      { event, data, origin: this.origin },
      { tabId: this.tabId }
    )
  }

  constructor({ tabId, windowId, url, wcTopic }: SessionInitProps = {}) {
    if (url) {
      this.origin = new URL(url).origin
    } else {
      this.origin = 'internal'
    }
    this.id = getDappIdFromUrl(this.origin)
    this.tabId = tabId || Date.now()
    this.windowId = windowId
    this.wcTopic = wcTopic

    // Track requestIds per providerId, since we inject an EthereumProvider into all frames for the same session
    this.lastHandledRequestIds = new Proxy(
      {},
      {
        get: (target: { [providerId: string]: number }, prop: string) => {
          // When accessing an unknown providerId, initialize it with the default requestId = -1
          if (!(prop in target)) {
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
