"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Session = void 0;
// Each instance of a Session represents an active connection between a dApp and the wallet.
// For more details on how to use it, refer to the DappsController.
class Session {
    origin = '';
    icon = '';
    name = '';
    tabId = null;
    messenger = null;
    sendMessage(event, data) {
        if (this.messenger) {
            this.messenger.send('broadcast', { event, data }, { tabId: this.tabId });
        }
    }
    constructor(data) {
        this.setProp(data);
    }
    setMessenger(messenger) {
        this.messenger = messenger;
    }
    setProp({ origin, icon, name, tabId }) {
        if (origin)
            this.origin = origin;
        if (icon)
            this.icon = icon;
        if (name)
            this.name = name;
        if (tabId)
            this.tabId = tabId;
    }
    get sessionId() {
        return `${this.tabId}-${this.origin}`;
    }
    toJSON() {
        return {
            ...this,
            sessionId: this.sessionId
        };
    }
}
exports.Session = Session;
//# sourceMappingURL=session.js.map