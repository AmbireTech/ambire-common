import { getDappIdFromUrl } from '../libs/dapps/helpers';
export function getSessionId({ tabId, windowId, dappId }) {
    if (windowId) {
        return `${windowId}-${tabId}-${dappId}`;
    }
    return `${tabId}-${dappId}`;
}
// Each instance of a Session represents an active connection between a dApp and the wallet.
// For more details on how to use it, refer to the DappsController.
export class Session {
    /**
    @state {string} id = the domain of the dapp
     */
    id;
    /**
    @state {string} origin = the url of the dapp
     */
    origin;
    tabId;
    windowId;
    name = '';
    icon = '';
    messenger;
    wcTopic;
    lastHandledRequestIds;
    isWeb3App = false;
    isAmbireNext = false;
    sendMessage(event, data) {
        if (!this.messenger) {
            if (this.wcTopic && this.wcTopic.startsWith('temp_wallet_connect_session'))
                return;
            console.error(`[Session] Cannot send message for session with id: ${this.sessionId} - messenger not initialized.`);
            return;
        }
        // SECURITY: include the session origin so platform messengers (e.g. mobile)
        // can verify the WebView is still on the intended origin before delivering
        // the broadcast. This prevents accountsChanged/chainChanged leakage to a
        // page the user has navigated to during an async operation.
        this.messenger.send(this.isAmbireNext ? 'broadcast-next' : 'broadcast', { event, data, origin: this.origin }, { tabId: this.tabId });
    }
    constructor({ tabId, windowId, url, wcTopic } = {}) {
        if (url) {
            this.origin = new URL(url).origin;
        }
        else {
            this.origin = 'internal';
        }
        this.id = getDappIdFromUrl(this.origin);
        this.tabId = tabId || Date.now();
        this.windowId = windowId;
        this.wcTopic = wcTopic;
        // Track requestIds per providerId, since we inject an EthereumProvider into all frames for the same session
        this.lastHandledRequestIds = new Proxy({}, {
            get: (target, prop) => {
                // When accessing an unknown providerId, initialize it with the default requestId = -1
                if (!(prop in target)) {
                    target[prop] = -1;
                }
                return target[prop];
            }
        });
    }
    setMessenger(messenger, isAmbireNext) {
        this.messenger = messenger;
        this.isAmbireNext = isAmbireNext;
    }
    setProp({ icon, name }) {
        if (icon)
            this.icon = icon;
        if (name)
            this.name = name;
    }
    get sessionId() {
        return getSessionId({ tabId: this.tabId, windowId: this.windowId, dappId: this.id });
    }
    toJSON() {
        return {
            ...this,
            sessionId: this.sessionId
        };
    }
}
//# sourceMappingURL=session.js.map