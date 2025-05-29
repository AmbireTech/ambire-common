"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DappsController = void 0;
const tslib_1 = require("tslib");
const session_1 = require("../../classes/session");
const dappCatalog_json_1 = tslib_1.__importDefault(require("../../consts/dappCatalog.json"));
const helpers_1 = require("../../libs/dapps/helpers");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
// The DappsController is responsible for the following tasks:
// 1. Managing the dApp catalog
// 2. Handling active sessions between dApps and the wallet
// 3. Broadcasting events from the wallet to connected dApps via the Session
// The possible events include: accountsChanged, chainChanged, disconnect, lock, unlock, and connect.
class DappsController extends eventEmitter_1.default {
    #dapps = [];
    #storage;
    dappSessions = {};
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    constructor(storage) {
        super();
        this.#storage = storage;
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.initialLoadPromise = this.#load();
    }
    get isReady() {
        return !!this.dapps;
    }
    get dapps() {
        const predefinedDappsParsed = dappCatalog_json_1.default.map(({ url, name, icon, description }) => ({
            name,
            description,
            url,
            icon,
            isConnected: false,
            chainId: 1,
            favorite: false
        }));
        return [...this.#dapps, ...predefinedDappsParsed].reduce((acc, curr) => {
            if (!acc.some(({ url }) => url === curr.url))
                return [...acc, curr];
            return acc;
        }, []);
    }
    set dapps(updatedDapps) {
        this.#dapps = updatedDapps;
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.#storage.set('dapps', updatedDapps);
    }
    async #load() {
        // Before extension version 4.55.0, dappSessions were stored in storage.
        // This logic is no longer needed, so we remove the data from the user's storage.
        // Keeping this here as a reminder to handle future use of the `dappSessions` key with caution.
        this.#storage.remove('dappSessions');
        const storedDapps = await this.#storage.get('dapps', []);
        this.#dapps = (0, helpers_1.patchStorageApps)(storedDapps);
        this.emitUpdate();
    }
    #dappSessionsSet(sessionId, session) {
        this.dappSessions[sessionId] = session;
    }
    #dappSessionsDelete(sessionId) {
        delete this.dappSessions[sessionId];
    }
    #createDappSession = (data) => {
        const dappSession = new session_1.Session(data);
        this.#dappSessionsSet(dappSession.sessionId, dappSession);
        this.emitUpdate();
        return dappSession;
    };
    getOrCreateDappSession = (data) => {
        if (!data.tabId || !data.origin)
            throw new Error('Invalid props passed to getOrCreateDappSession');
        if (this.dappSessions[`${data.tabId}-${data.origin}`]) {
            return this.dappSessions[`${data.tabId}-${data.origin}`];
        }
        return this.#createDappSession(data);
    };
    setSessionMessenger = (key, messenger) => {
        this.dappSessions[key].setMessenger(messenger);
    };
    setSessionLastHandledRequestsId = (key, id, isWeb3AppRequest) => {
        if (id > this.dappSessions[key].lastHandledRequestId) {
            this.dappSessions[key].lastHandledRequestId = id;
            if (isWeb3AppRequest && !this.dappSessions[key].isWeb3App) {
                this.dappSessions[key].isWeb3App = true;
                this.emitUpdate();
            }
        }
    };
    resetSessionLastHandledRequestsId = (key) => {
        this.dappSessions[key].lastHandledRequestId = -1;
    };
    setSessionProp = (key, props) => {
        this.dappSessions[key].setProp(props);
    };
    deleteDappSession = (key) => {
        this.#dappSessionsDelete(key);
        this.emitUpdate();
    };
    broadcastDappSessionEvent = async (ev, data, origin, skipPermissionCheck) => {
        await this.initialLoadPromise;
        let dappSessions = [];
        Object.keys(this.dappSessions).forEach((key) => {
            const hasPermissionToBroadcast = skipPermissionCheck || this.hasPermission(this.dappSessions[key].origin);
            if (this.dappSessions[key] && hasPermissionToBroadcast) {
                dappSessions.push({ key, data: this.dappSessions[key] });
            }
        });
        if (origin) {
            dappSessions = dappSessions.filter((dappSession) => dappSession.data.origin === origin);
        }
        dappSessions.forEach((dappSession) => {
            try {
                dappSession.data.sendMessage?.(ev, data);
            }
            catch (e) {
                if (this.dappSessions[dappSession.key]) {
                    this.deleteDappSession(dappSession.key);
                }
            }
        });
    };
    addDapp(dapp) {
        if (!this.isReady)
            return;
        const doesAlreadyExist = this.dapps.find((d) => d.url === dapp.url);
        if (doesAlreadyExist) {
            this.updateDapp(dapp.url, {
                chainId: dapp.chainId,
                isConnected: dapp.isConnected,
                favorite: dapp.favorite
            });
            return;
        }
        this.dapps = [...this.dapps, dapp];
        this.emitUpdate();
    }
    updateDapp(url, dapp) {
        if (!this.isReady)
            return;
        this.dapps = this.dapps.map((d) => {
            if (d.url === url)
                return { ...d, ...dapp };
            return d;
        });
        this.emitUpdate();
    }
    removeDapp(url) {
        if (!this.isReady)
            return;
        // do not remove predefined dapps
        if (dappCatalog_json_1.default.find((d) => d.url === url))
            return;
        this.dapps = this.dapps.filter((d) => d.url !== url);
        this.emitUpdate();
    }
    hasPermission(url) {
        const dapp = this.dapps.find((d) => d.url === url);
        if (!dapp)
            return false;
        return dapp.isConnected;
    }
    getDapp(url) {
        if (!this.isReady)
            return;
        return this.dapps.find((d) => d.url === url);
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            dapps: this.dapps,
            isReady: this.isReady
        };
    }
}
exports.DappsController = DappsController;
//# sourceMappingURL=dapps.js.map