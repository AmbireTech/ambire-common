import { defaultFeatureFlags } from '../../consts/featureFlags';
import EventEmitter from '../eventEmitter/eventEmitter';
/**
 * Responsible for managing (enable/disable) feature flags within the app. The
 * long-term vision for this is to support dynamic management, currently it
 * enables or disables features only at runtime. Can be useful for feature
 * toggling, A/B testing, and gradual feature roll-outs.
 */
export class FeatureFlagsController extends EventEmitter {
    #flags;
    #storage;
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    constructor(featureFlags, storage, eventEmitterRegistry) {
        super(eventEmitterRegistry);
        this.#flags = { ...defaultFeatureFlags, ...(featureFlags || {}) };
        this.#storage = storage;
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    async #load() {
        const features = await this.#storage.get('flags', {});
        this.#flags = { ...this.#flags, ...(features || {}) };
        this.emitUpdate();
    }
    /** Syntactic sugar for checking if a feature flag is enabled */
    isFeatureEnabled(flag) {
        return this.#flags[flag];
    }
    async setFeatureFlag(flag, value) {
        this.#flags[flag] = value;
        await this.#storage.set('flags', this.#flags);
        this.emitUpdate();
    }
    get flags() {
        return this.#flags;
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            flags: this.#flags
        };
    }
}
//# sourceMappingURL=featureFlags.js.map