import { FeatureFlags, featureFlags } from '../../consts/featureFlags';
import EventEmitter from '../eventEmitter/eventEmitter';
import { NetworksController } from '../networks/networks';
/**
 * Responsible for managing (enable/disable) feature flags within the app. The
 * long-term vision for this is to support dynamic management, currently it
 * enables or disables features only at runtime. Can be useful for feature
 * toggling, A/B testing, and gradual feature roll-outs.
 */
export declare class FeatureFlagsController extends EventEmitter {
    #private;
    constructor(networks: NetworksController);
    /** Syntactic sugar for checking if a feature flag is enabled */
    isFeatureEnabled(flag: keyof FeatureFlags): boolean;
    setFeatureFlag(flag: keyof typeof featureFlags, value: boolean): void;
    get flags(): FeatureFlags;
    toJSON(): this & {
        flags: FeatureFlags;
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=featureFlags.d.ts.map