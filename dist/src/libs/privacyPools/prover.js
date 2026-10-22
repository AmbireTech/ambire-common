"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createProverFactory = exports.withCancellableProving = exports.PRIVACY_POOLS_PROOF_CANCELLED_MESSAGE = void 0;
const privacy_pools_core_circuits_1 = require("@fatsolutions/privacy-pools-core-circuits");
const privacyPools_1 = require("../../consts/privacyPools");
/** The error a cancelled proof fails with. */
exports.PRIVACY_POOLS_PROOF_CANCELLED_MESSAGE = 'privacyPools: the proof was cancelled';
const throwIfCancelled = (signal) => {
    if (signal?.aborted)
        throw new Error(exports.PRIVACY_POOLS_PROOF_CANCELLED_MESSAGE);
};
/**
 * Lets a cancelled operation stop at its proofs, the slow part. The SDK has no way to cancel, so
 * `getSignal` is read on every proof, for the operation proving at that moment.
 *
 * Fails a proof asked for once cancelled. A prover that stops mid-proof (the offscreen one) fails
 * at once; one that cannot (the in-process one) is waited for and its result dropped, so a
 * cancelled proof never runs beside the next operation's.
 */
const withCancellableProving = (proverFactory, getSignal) => async () => {
    const prover = await proverFactory();
    const prove = async (circuit, signals) => {
        const signal = getSignal() ?? undefined;
        throwIfCancelled(signal);
        const result = await prover.prove(circuit, signals, { signal });
        throwIfCancelled(signal);
        return result;
    };
    return { prove };
};
exports.withCancellableProving = withCancellableProving;
/**
 * Builds the SDK's prover, differing from its defaults in two ways:
 *
 * 1. Same-origin `baseUrl`. The default is a pinned commit on raw.githubusercontent.com: a
 *    third-party host in the withdrawal path, needing a CSP entry, re-downloading ~23 MB per
 *    prover. Same-origin works offline and trusts nothing external.
 *
 * 2. Memoized. `Prover()` eagerly loads both circuits (including the unused ~3 MB commitment one,
 *    cheaper than reimplementing its snarkjs call) and the SDK calls the factory per operation.
 */
const createProverFactory = (baseUrl) => {
    let proverPromise = null;
    return () => {
        // Platforms without the artifacts pass an empty base; fail with the real reason, not a bad URL
        if (!baseUrl)
            return Promise.reject(new Error('privacyPools: proving is not available on this platform (no circuit artifacts)'));
        if (!proverPromise) {
            proverPromise = (0, privacy_pools_core_circuits_1.Prover)({
                // `new URL(path, baseUrl)` drops the base's last segment unless it ends in a slash
                baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
                ...privacyPools_1.PRIVACY_POOLS_CIRCUIT_PATHS
            }).catch((error) => {
                // Cleared so a later withdrawal retries, or one transient failure would fail every proof
                proverPromise = null;
                throw error;
            });
        }
        return proverPromise;
    };
};
exports.createProverFactory = createProverFactory;
//# sourceMappingURL=prover.js.map