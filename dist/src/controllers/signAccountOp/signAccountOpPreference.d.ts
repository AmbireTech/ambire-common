import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IStorageController, StorageProps } from '../../interfaces/storage';
import EventEmitter from '../eventEmitter/eventEmitter';
export type SignAccountOpFeeTokenPreference = StorageProps['signAccountOpFeeTokenPreference'];
export type SignAccountOpFeeSpeedPreference = StorageProps['signAccountOpFeeSpeedPreference'];
export declare const FEE_TOKEN_PREFERENCE_STORAGE_KEY = "signAccountOpFeeTokenPreference";
export declare const FEE_SPEED_PREFERENCE_STORAGE_KEY = "signAccountOpFeeSpeedPreference";
export declare class SignAccountOpPreferenceController extends EventEmitter {
    #private;
    feeTokenPreference: SignAccountOpFeeTokenPreference;
    feeSpeedPreference: SignAccountOpFeeSpeedPreference;
    initialLoadPromise?: Promise<void>;
    constructor({ eventEmitterRegistry, storage }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        storage: IStorageController;
    });
    setFeeTokenPreference(feeTokenPreference: SignAccountOpFeeTokenPreference): Promise<void>;
    setFeeSpeedPreference(feeSpeedPreference: SignAccountOpFeeSpeedPreference): Promise<void>;
}
//# sourceMappingURL=signAccountOpPreference.d.ts.map