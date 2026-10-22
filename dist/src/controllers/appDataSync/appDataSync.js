"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppDataSyncController = exports.STATUS_WRAPPED_METHODS = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const EmittableError_1 = tslib_1.__importDefault(require("../../classes/EmittableError"));
const featureFlags_1 = require("../../consts/featureFlags");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
const appDataSync_1 = require("../../libs/appDataSync/appDataSync");
exports.STATUS_WRAPPED_METHODS = {
    exportData: 'INITIAL',
    importData: 'INITIAL'
};
/**
 * Syncs the wallet's data (accounts and their keys, settings, networks and the Address
 * Book) between the Ambire extension and the mobile app through animated QR codes.
 * It only puts the payload together and spreads it back over the other controllers,
 * which merge their part of it themselves.
 */
class AppDataSyncController extends eventEmitter_1.default {
    #keystore;
    #accounts;
    #networks;
    #addressBook;
    #featureFlags;
    #swapAndBridge;
    #ui;
    statuses = exports.STATUS_WRAPPED_METHODS;
    constructor({ eventEmitterRegistry, keystore, accounts, networks, addressBook, featureFlags, swapAndBridge, ui }) {
        super(eventEmitterRegistry);
        this.#keystore = keystore;
        this.#accounts = accounts;
        this.#networks = networks;
        this.#addressBook = addressBook;
        this.#featureFlags = featureFlags;
        this.#swapAndBridge = swapAndBridge;
        this.#ui = ui;
    }
    /**
     * Runs a sync step and replies to the UI request that triggered it, so the
     * UI can await the result instead of watching a transient status.
     */
    async #withSyncResponse(callName, requestId, fn) {
        await this.withStatus(callName, async () => {
            try {
                const res = await fn();
                if (requestId)
                    this.#ui.message.sendUiMessage({ requestId, ok: true, res });
            }
            catch (error) {
                // Rethrown, so that `withStatus` emits (and reports) the error as usual
                if (requestId)
                    this.#ui.message.sendUiMessage({
                        requestId,
                        ok: false,
                        error: error?.message || `${callName} failed`
                    });
                throw error;
            }
        });
    }
    /**
     * Prepares the selected accounts and the keys controlling them for the other Ambire
     * product and returns the payload, which the UI displays as animated QR codes.
     * Everything sensitive leaves this device encrypted, see `keystore.exportForSync`.
     *
     * `includeSeeds` lets the user leave the recovery phrases of the selected accounts
     * behind, in which case only the accounts and their keys are sent over. The settings,
     * the networks and the Address Book travel only if the user chose them, and they can
     * also be synced without any accounts.
     */
    async exportData(addrs, { includeSeeds, appSettings, includeNetworks, includeContacts }, requestId) {
        await this.#withSyncResponse('exportData', requestId, async () => {
            const accounts = this.#accounts.accounts.filter((account) => addrs.includes(account.addr));
            if (!accounts.length && !appSettings && !includeNetworks && !includeContacts)
                throw new EmittableError_1.default({
                    level: 'expected',
                    message: 'Select what you want to sync.',
                    error: new Error('appDataSync: nothing to sync')
                });
            const { secret, keys, seeds } = await this.#keystore.exportForSync((0, appDataSync_1.getAppDataSyncKeyAddrs)(accounts), includeSeeds);
            return (0, appDataSync_1.serializeAppDataSyncPayload)({
                v: appDataSync_1.APP_DATA_SYNC_PAYLOAD_VERSION,
                secret,
                accounts,
                keys,
                seeds,
                ...(appSettings && {
                    settings: {
                        featureFlags: Object.fromEntries(featureFlags_1.USER_FEATURE_FLAGS.map((flag) => [flag, this.#featureFlags.isFeatureEnabled(flag)])),
                        disabledSwapProviderIds: this.#swapAndBridge.getDisabledSwapProviderIds(),
                        app: appSettings
                    }
                }),
                ...(includeNetworks && { networks: this.#networks.allNetworks }),
                // The wallet's own accounts are contacts too, but each device derives them itself
                ...(includeContacts && {
                    contacts: this.#addressBook.contacts.filter((contact) => !contact.isWalletAccount)
                })
            });
        });
    }
    /**
     * Takes over the accounts and keys scanned from the other Ambire product's QR codes,
     * along with the settings, networks and contacts if the user chose to sync them. Those
     * are merged: what comes from the other product overrides what is here, the rest stays.
     * `payload` is the hex encoded data assembled from the scanned codes and `password`
     * is the device password of the product that exported them, required whatever was
     * synced, so that nothing is taken over without the user confirming it.
     */
    async importData({ payload, password }, requestId) {
        await this.#withSyncResponse('importData', requestId, async () => {
            let parsedPayload;
            try {
                parsedPayload = (0, appDataSync_1.parseAppDataSyncPayload)((0, ethers_1.getBytes)(payload));
            }
            catch (error) {
                throw new EmittableError_1.default({
                    level: 'expected',
                    message: error instanceof appDataSync_1.AppDataSyncNewerVersionError
                        ? 'The QR codes come from a newer version of Ambire. Please update this app and scan them again.'
                        : 'The scanned QR codes do not contain Ambire accounts, or not all of them were scanned. Please try again.',
                    error: error instanceof Error ? error : new Error('appDataSync: invalid sync payload')
                });
            }
            // The accounts are added only if the keys made it in, so that the user doesn't
            // end up with accounts they cannot sign with
            await this.#keystore.importFromSync(parsedPayload, password);
            const { networks, contacts, settings } = parsedPayload;
            // Before the accounts, so their first update already runs on the synced networks
            if (networks)
                await this.#networks.mergeNetworks(networks);
            if (parsedPayload.accounts.length)
                await this.#accounts.addAccounts(parsedPayload.accounts);
            // After the accounts, so the ones that are contacts here already are skipped
            if (contacts)
                await this.#addressBook.mergeContacts(contacts);
            // The app settings (like the theme) are kept by the app, so it applies them itself
            if (settings) {
                const featureFlags = featureFlags_1.USER_FEATURE_FLAGS.reduce((flags, flag) => typeof settings.featureFlags[flag] === 'boolean'
                    ? { ...flags, [flag]: settings.featureFlags[flag] }
                    : flags, {});
                await this.#featureFlags.setFeatureFlags(featureFlags);
                await this.#swapAndBridge.setDisabledSwapProviderIds(settings.disabledSwapProviderIds);
            }
        });
    }
}
exports.AppDataSyncController = AppDataSyncController;
//# sourceMappingURL=appDataSync.js.map