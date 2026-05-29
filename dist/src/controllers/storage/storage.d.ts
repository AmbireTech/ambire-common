import { IAccountPickerController } from '../../interfaces/accountPicker';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { IKeystoreController } from '../../interfaces/keystore';
import { IStorageController, Storage, StorageProps } from '../../interfaces/storage';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare const STATUS_WRAPPED_METHODS: {
    readonly associateAccountKeysWithLegacySavedSeedMigration: "INITIAL";
};
export declare class StorageController extends EventEmitter implements IStorageController {
    #private;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    constructor(storage: Storage, eventEmitterRegistry?: IEventEmitterRegistryController);
    get<K extends keyof StorageProps>(key: K): Promise<StorageProps[K] | undefined>;
    get<K extends keyof StorageProps>(key: K, defaultValue: StorageProps[K]): Promise<StorageProps[K]>;
    get<K extends keyof StorageProps>(key: K, defaultValue: null): Promise<StorageProps[K] | null>;
    set<K extends keyof StorageProps>(key: K, value: StorageProps[K]): Promise<void>;
    remove<K extends keyof StorageProps>(key: K): Promise<void>;
    associateAccountKeysWithLegacySavedSeedMigration(accountPickerInitFn: () => IAccountPickerController, keystore: IKeystoreController, onSuccess: () => Promise<void>): Promise<void>;
    toJSON(): this & {
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=storage.d.ts.map