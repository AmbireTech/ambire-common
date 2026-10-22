"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const consts_1 = require("../../libs/humanizer/erc7730/consts");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
class HumanizationController extends eventEmitter_1.default {
    #humanizationSeq = 0;
    #fallbackTimeout;
    createHumanizationId() {
        this.#humanizationSeq += 1;
        return this.#humanizationSeq;
    }
    isCurrentHumanization(humanizationId) {
        return this.#humanizationSeq === humanizationId;
    }
    /**
     * Makes every humanization still in progress stale, so none of them is applied, and clears the
     * pending fallback. For a controller that is being destroyed.
     */
    stopHumanization() {
        this.#humanizationSeq += 1;
        clearTimeout(this.#fallbackTimeout);
        this.#fallbackTimeout = undefined;
    }
    startHumanization(onStart) {
        const humanizationId = this.createHumanizationId();
        onStart(humanizationId);
        this.emitUpdate();
        return humanizationId;
    }
    #clearFallbackTimeout(fallbackTimeout) {
        clearTimeout(fallbackTimeout);
        if (this.#fallbackTimeout === fallbackTimeout)
            this.#fallbackTimeout = undefined;
    }
    async applyDescriptorFirstHumanization({ humanizationId, fetchDescriptor, applyDescriptorHumanization, applyFallbackHumanization }) {
        let hasResolvedBeforeFallback = false;
        let hasDisplayedFallback = false;
        // Only the latest humanization can be applied, so an older pending fallback is cleared
        clearTimeout(this.#fallbackTimeout);
        const fallbackTimeout = setTimeout(() => {
            this.#clearFallbackTimeout(fallbackTimeout);
            if (hasResolvedBeforeFallback || !this.isCurrentHumanization(humanizationId))
                return;
            hasDisplayedFallback = applyFallbackHumanization(humanizationId);
        }, consts_1.ERC7730_DESCRIPTOR_WAIT_MS);
        this.#fallbackTimeout = fallbackTimeout;
        try {
            const descriptor = await fetchDescriptor();
            hasResolvedBeforeFallback = true;
            this.#clearFallbackTimeout(fallbackTimeout);
            if (this.isCurrentHumanization(humanizationId) &&
                applyDescriptorHumanization(descriptor, humanizationId)) {
                return;
            }
            if (!hasDisplayedFallback)
                applyFallbackHumanization(humanizationId);
        }
        catch (error) {
            console.error(error);
            hasResolvedBeforeFallback = true;
            this.#clearFallbackTimeout(fallbackTimeout);
            if (!hasDisplayedFallback)
                applyFallbackHumanization(humanizationId);
        }
    }
}
exports.default = HumanizationController;
//# sourceMappingURL=humanization.js.map