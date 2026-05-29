"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeatureFlagsController = void 0;
const tslib_1 = require("tslib");
const featureFlags_1 = require("../../consts/featureFlags");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
/**
 * Responsible for managing (enable/disable) feature flags within the app. The
 * long-term vision for this is to support dynamic management, currently it
 * enables or disables features only at runtime. Can be useful for feature
 * toggling, A/B testing, and gradual feature roll-outs.
 */
class FeatureFlagsController extends eventEmitter_1.default {
    #flags;
    #storage;
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    constructor(featureFlags, storage, eventEmitterRegistry) {
        super(eventEmitterRegistry);
        this.#flags = { ...featureFlags_1.defaultFeatureFlags, ...(featureFlags || {}) };
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
exports.FeatureFlagsController = FeatureFlagsController;
//# sourceMappingURL=featureFlags.js.map