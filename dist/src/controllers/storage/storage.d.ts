import { Storage, StorageProps } from '../../interfaces/storage';
import { AccountPickerController } from '../accountPicker/accountPicker';
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter';
import { KeystoreController } from '../keystore/keystore';
declare const STATUS_WRAPPED_METHODS: {
    readonly associateAccountKeysWithLegacySavedSeedMigration: "INITIAL";
};
export declare class StorageController extends EventEmitter {
    #private;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    constructor(storage: Storage);
    get<K extends keyof StorageProps | string | undefined>(key: K, defaultValue?: any): Promise<K extends keyof StorageProps ? StorageProps[K] : any>;
    set(key: string, value: any): Promise<void>;
    remove(key: string): Promise<void>;
    associateAccountKeysWithLegacySavedSeedMigration(accountPicker: AccountPickerController, keystore: KeystoreController, onSuccess: () => Promise<void>): Promise<void>;
    toJSON(): this & {
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=storage.d.ts.map