import { Messenger } from '../interfaces/messenger'
import { getDappIdFromUrl } from '../libs/dapps/helpers'

export interface SessionInitProps {
  url?: string
  tabId?: number
  windowId?: number
  wcTopic?: string
  /**
   * The browser frame the dApp runs in: 0 is the tab's top frame, anything else is an iframe.
   * Only platforms that can report it from a trusted source pass it (the extension reads it
   * from `chrome.runtime.MessageSender`); it stays undefined on mobile WebViews (main-frame
   * only injection) and for WalletConnect, which has no frame at all.
   */
  frameId?: number
  /**
   * The URL of the tab's top-level document, which differs from `url` when the dApp is embedded
   * in an iframe. Reported by the browser alongside `frameId`, so the page cannot spoof it.
   */
  topFrameUrl?: string
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

// `about:blank`, `about:srcdoc` and other opaque documents parse fine but have the string
// origin "null", which is not a domain we can check anything against.
function getOriginFromUrl(url?: string): string | undefined {
  if (!url) return undefined

  try {
    const { origin } = new URL(url)
    return origin === 'null' ? undefined : origin
  } catch {
    return undefined
  }
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

  frameId?: number

  /**
  @state {string} topFrameOrigin = the origin of the tab's top-level document. Equal to `origin`
  when the dApp is the top frame itself, and different when it is embedded in an iframe.
   */
  topFrameOrigin?: string

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

  constructor({ tabId, windowId, url, wcTopic, frameId, topFrameUrl }: SessionInitProps = {}) {
    if (url) {
      // SECURITY: kept exactly as the browser reports it, including the trailing dot of a
      // fully-qualified host. Platform messengers compare it byte-for-byte against the page's
      // read-only `location.origin` before delivering a response or a broadcast (see the mobile
      // WebView), so a canonicalized origin would no longer match the page it belongs to.
      // The dApp's identity - what every security check resolves - is `id`, not `origin`.
      this.origin = new URL(url).origin
    } else {
      this.origin = 'internal'
    }
    this.id = getDappIdFromUrl(this.origin)
    this.tabId = tabId || Date.now()
    this.windowId = windowId
    this.wcTopic = wcTopic
    this.updateFrameContext({ frameId, topFrameUrl })

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

  /**
   * Refreshes where the dApp sits in the tab's frame tree. Called on every incoming request, so
   * the context is always the browser's current answer instead of a remembered one - a session
   * object outlives navigations, and a stale top frame would produce a wrong verdict.
   *
   * A platform that cannot report frame context omits `frameId` entirely and leaves the previous
   * values untouched (e.g. a WalletConnect request must not wipe the context of an injected
   * session). When `frameId` is present, `topFrameUrl` is trusted as-is, including when absent.
   */
  updateFrameContext({ frameId, topFrameUrl }: Pick<SessionInitProps, 'frameId' | 'topFrameUrl'>) {
    if (frameId === undefined) return

    this.frameId = frameId
    this.topFrameOrigin = getOriginFromUrl(topFrameUrl)
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
