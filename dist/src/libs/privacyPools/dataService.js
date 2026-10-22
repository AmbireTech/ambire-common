"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPrivacyPoolsDataService = void 0;
const privacy_pools_1 = require("@kohaku-eth/privacy-pools");
const parallelLogSource_1 = require("./parallelLogSource");
/**
 * How the plugin reads the chain. The pools' history comes from the saga-sync CDN when given;
 * everything else (the entrypoint, blocks after the CDN's last index, chains without a CDN) goes
 * to the provider through `createParallelLogSource`.
 *
 * Composes `createSagaLogSource` rather than `createSagaDataService`, which hardwires the SDK's
 * sequential reader as the fallback.
 */
const createPrivacyPoolsDataService = async ({ provider, saga, onSagaUnavailable }) => {
    const getLogs = (0, parallelLogSource_1.createParallelLogSource)({ provider });
    if (!saga)
        return { dataService: new privacy_pools_1.DataService({ provider, getLogs }), isSagaHydrated: false };
    try {
        const sagaLogs = await (0, privacy_pools_1.createSagaLogSource)({
            sourceUrl: saga.sourceUrl,
            chainId: Number(saga.chainId),
            fallback: getLogs
        });
        return { dataService: new privacy_pools_1.DataService({ provider, getLogs: sagaLogs }), isSagaHydrated: true };
    }
    catch (error) {
        // Not fatal: the provider yields the same history, only slower
        onSagaUnavailable(error);
        return { dataService: new privacy_pools_1.DataService({ provider, getLogs }), isSagaHydrated: false };
    }
};
exports.createPrivacyPoolsDataService = createPrivacyPoolsDataService;
//# sourceMappingURL=dataService.js.map