"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignAccountOpPreferenceController = exports.FEE_SPEED_PREFERENCE_STORAGE_KEY = exports.FEE_TOKEN_PREFERENCE_STORAGE_KEY = void 0;
const tslib_1 = require("tslib");
const signAccountOp_1 = require("../../interfaces/signAccountOp");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
exports.FEE_TOKEN_PREFERENCE_STORAGE_KEY = 'signAccountOpFeeTokenPreference';
exports.FEE_SPEED_PREFERENCE_STORAGE_KEY = 'signAccountOpFeeSpeedPreference';
/**
 * Keeps only valid per-chain fee speeds. Values stored before the preference
 * became per-network were a single FeeSpeed string and are dropped here, so
 * those users fall back to the default speed instead of a corrupt map.
 */
const sanitizeFeeSpeedPreference = (stored) => {
    if (typeof stored !== 'object' || stored === null || Array.isArray(stored))
        return {};
    const sanitized = {};
    Object.entries(stored).forEach(([chainId, speed]) => {
        if (Object.values(signAccountOp_1.FeeSpeed).includes(speed))
            sanitized[chainId] = speed;
    });
    return sanitized;
};
class SignAccountOpPreferenceController extends eventEmitter_1.default {
    #storage;
    #updateQueue = Promise.resolve();
    feeTokenPreference = {};
    feeSpeedPreference = {};
    initialLoadPromise;
    constructor({ eventEmitterRegistry, storage }) {
        super(eventEmitterRegistry);
        this.#storage = storage;
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    async #load() {
        try {
            this.feeTokenPreference = await this.#storage.get(exports.FEE_TOKEN_PREFERENCE_STORAGE_KEY, {});
            this.feeSpeedPreference = sanitizeFeeSpeedPreference(await this.#storage.get(exports.FEE_SPEED_PREFERENCE_STORAGE_KEY, {}));
            this.emitUpdate();
        }
        catch (error) {
            this.emitError({
                message: 'Error loading SignAccountOp fee token preference',
                error: error instanceof Error ? error : new Error(String(error)),
                level: 'silent'
            });
        }
    }
    async setFeeTokenPreference(feeTokenPreference) {
        const update = this.#updateQueue.then(async () => {
            try {
                await this.#storage.set(exports.FEE_TOKEN_PREFERENCE_STORAGE_KEY, feeTokenPreference);
                this.feeTokenPreference = feeTokenPreference;
                this.emitUpdate();
            }
            catch (error) {
                this.emitError({
                    message: 'Error saving SignAccountOp fee token preference',
                    error: error instanceof Error ? error : new Error(String(error)),
                    level: 'silent'
                });
                throw error;
            }
        });
        this.#updateQueue = update.catch(() => { });
        await update;
    }
    async setFeeSpeedPreference(feeSpeedPreference) {
        this.feeSpeedPreference = feeSpeedPreference;
        this.emitUpdate();
        const update = this.#updateQueue.then(async () => {
            try {
                await this.#storage.set(exports.FEE_SPEED_PREFERENCE_STORAGE_KEY, feeSpeedPreference);
            }
            catch (error) {
                this.emitError({
                    message: 'Error saving SignAccountOp fee speed preference',
                    error: error instanceof Error ? error : new Error(String(error)),
                    level: 'silent'
                });
            }
        });
        this.#updateQueue = update;
        await update;
    }
}
exports.SignAccountOpPreferenceController = SignAccountOpPreferenceController;
//# sourceMappingURL=signAccountOpPreference.js.map