import { CircuitInputSignalsMap, CircuitName, CircuitPublicSignalsMap, Prover } from '@fatsolutions/privacy-pools-core-circuits';
type KohakuProver = Awaited<ReturnType<typeof Prover>>;
type KohakuProveResult = Awaited<ReturnType<KohakuProver['prove']>>;
/** What a platform prover may be given besides the circuit inputs. */
export type PrivacyPoolsProveOptions = {
    /** Aborted when the operation the proof is for is cancelled. A prover may ignore it. */
    signal?: AbortSignal;
};
/**
 * The only part of a prover the SDK calls, plus `options`, which the SDK never passes - see
 * `withCancellableProving`. Narrowed so a platform can prove elsewhere, e.g. in the extension's
 * offscreen document, on several threads.
 */
export type PrivacyPoolsProver = {
    prove: <C extends CircuitName>(circuit: C, signals: CircuitInputSignalsMap[C], options?: PrivacyPoolsProveOptions) => Promise<Omit<KohakuProveResult, 'mappedSignals'> & {
        mappedSignals: CircuitPublicSignalsMap[C];
    }>;
};
/** The error a cancelled proof fails with. */
export declare const PRIVACY_POOLS_PROOF_CANCELLED_MESSAGE = "privacyPools: the proof was cancelled";
/**
 * Lets a cancelled operation stop at its proofs, the slow part. The SDK has no way to cancel, so
 * `getSignal` is read on every proof, for the operation proving at that moment.
 *
 * Fails a proof asked for once cancelled. A prover that stops mid-proof (the offscreen one) fails
 * at once; one that cannot (the in-process one) is waited for and its result dropped, so a
 * cancelled proof never runs beside the next operation's.
 */
export declare const withCancellableProving: (proverFactory: PrivacyPoolsProverFactory, getSignal: () => AbortSignal | null) => PrivacyPoolsProverFactory;
/** Called by the SDK once per operation. Should reuse one prover rather than build a new one. */
export type PrivacyPoolsProverFactory = () => Promise<PrivacyPoolsProver>;
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
export declare const createProverFactory: (baseUrl: string) => (() => Promise<KohakuProver>);
export {};
//# sourceMappingURL=prover.d.ts.map