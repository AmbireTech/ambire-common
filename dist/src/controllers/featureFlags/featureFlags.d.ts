import { defaultFeatureFlags, FeatureFlags } from '../../consts/featureFlags';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { IStorageController } from '../../interfaces/storage';
import EventEmitter from '../eventEmitter/eventEmitter';
/**
 * Responsible for managing (enable/disable) feature flags within the app. The
 * long-term vision for this is to support dynamic management, currently it
 * enables or disables features only at runtime. Can be useful for feature
 * toggling, A/B testing, and gradual feature roll-outs.
 */
export declare class FeatureFlagsController extends EventEmitter implements IFeatureFlagsController {
    #private;
    initialLoadPromise?: Promise<void>;
    constructor(featureFlags: Partial<FeatureFlags>, storage: IStorageController, eventEmitterRegistry?: IEventEmitterRegistryController);
    /** Syntactic sugar for checking if a feature flag is enabled */
    isFeatureEnabled(flag: keyof FeatureFlags): boolean;
    setFeatureFlag(flag: keyof typeof defaultFeatureFlags, value: boolean): Promise<void>;
    get flags(): FeatureFlags;
    toJSON(): this & {
        flags: FeatureFlags;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=featureFlags.d.ts.map