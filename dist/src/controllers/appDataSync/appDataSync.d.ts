import EventEmitter from '../eventEmitter/eventEmitter';
import { Account, IAccountsController } from '../../interfaces/account';
import { IAddressBookController } from '../../interfaces/addressBook';
import { IAppDataSyncController } from '../../interfaces/appDataSync';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { IKeystoreController } from '../../interfaces/keystore';
import { INetworksController } from '../../interfaces/network';
import { ISwapAndBridgeController } from '../../interfaces/swapAndBridge';
import { IUiController } from '../../interfaces/ui';
import { AppDataSyncExportOptions } from '../../libs/appDataSync/appDataSync';
export declare const STATUS_WRAPPED_METHODS: {
    readonly exportData: "INITIAL";
    readonly importData: "INITIAL";
};
/**
 * Syncs the wallet's data (accounts and their keys, settings, networks and the Address
 * Book) between the Ambire extension and the mobile app through animated QR codes.
 * It only puts the payload together and spreads it back over the other controllers,
 * which merge their part of it themselves.
 */
export declare class AppDataSyncController extends EventEmitter implements IAppDataSyncController {
    #private;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    constructor({ eventEmitterRegistry, keystore, accounts, networks, addressBook, featureFlags, swapAndBridge, ui }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        keystore: IKeystoreController;
        accounts: IAccountsController;
        networks: INetworksController;
        addressBook: IAddressBookController;
        featureFlags: IFeatureFlagsController;
        swapAndBridge: ISwapAndBridgeController;
        ui: IUiController;
    });
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
    exportData(addrs: Account['addr'][], { includeSeeds, appSettings, includeNetworks, includeContacts }: AppDataSyncExportOptions, requestId?: string): Promise<void>;
    /**
     * Takes over the accounts and keys scanned from the other Ambire product's QR codes,
     * along with the settings, networks and contacts if the user chose to sync them. Those
     * are merged: what comes from the other product overrides what is here, the rest stays.
     * `payload` is the hex encoded data assembled from the scanned codes and `password`
     * is the device password of the product that exported them, required whatever was
     * synced, so that nothing is taken over without the user confirming it.
     */
    importData({ payload, password }: {
        payload: string;
        password: string;
    }, requestId?: string): Promise<void>;
}
//# sourceMappingURL=appDataSync.d.ts.map