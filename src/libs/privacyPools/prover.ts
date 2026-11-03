import {
  CircuitInputSignalsMap,
  CircuitName,
  CircuitPublicSignalsMap,
  Prover
} from '@fatsolutions/privacy-pools-core-circuits'

import { PRIVACY_POOLS_CIRCUIT_PATHS } from '../../consts/privacyPools'

type KohakuProver = Awaited<ReturnType<typeof Prover>>

type KohakuProveResult = Awaited<ReturnType<KohakuProver['prove']>>

/** What a platform prover may be given besides the circuit inputs. */
export type PrivacyPoolsProveOptions = {
  /** Aborted when the operation the proof is for is cancelled. A prover may ignore it. */
  signal?: AbortSignal
}

/**
 * The only part of a prover the SDK calls, plus `options`, which the SDK never passes - see
 * `withCancellableProving`. Narrowed so a platform can prove elsewhere, e.g. in the extension's
 * offscreen document, on several threads.
 */
export type PrivacyPoolsProver = {
  prove: <C extends CircuitName>(
    circuit: C,
    signals: CircuitInputSignalsMap[C],
    options?: PrivacyPoolsProveOptions
  ) => Promise<
    Omit<KohakuProveResult, 'mappedSignals'> & { mappedSignals: CircuitPublicSignalsMap[C] }
  >
}

/** The error a cancelled proof fails with. */
export const PRIVACY_POOLS_PROOF_CANCELLED_MESSAGE = 'privacyPools: the proof was cancelled'

const throwIfCancelled = (signal: AbortSignal | undefined) => {
  if (signal?.aborted) throw new Error(PRIVACY_POOLS_PROOF_CANCELLED_MESSAGE)
}

/**
 * Lets a cancelled operation stop at its proofs, the slow part. The SDK has no way to cancel, so
 * `getSignal` is read on every proof, for the operation proving that circuit at that moment. By
 * circuit, so cancelling a withdrawal never fails a ragequit's proof running beside it.
 *
 * Fails a proof asked for once cancelled. A prover that stops mid-proof (the offscreen one) fails
 * at once; one that cannot (the in-process one) is waited for and its result dropped, so a
 * cancelled proof never runs beside the next operation's.
 */
export const withCancellableProving =
  (
    proverFactory: PrivacyPoolsProverFactory,
    getSignal: (circuit: CircuitName) => AbortSignal | null
  ): PrivacyPoolsProverFactory =>
  async () => {
    const prover = await proverFactory()

    const prove: PrivacyPoolsProver['prove'] = async (circuit, signals) => {
      const signal = getSignal(circuit) ?? undefined
      throwIfCancelled(signal)

      const result = await prover.prove(circuit, signals, { signal })
      throwIfCancelled(signal)

      return result
    }

    return { prove }
  }

/** Called by the SDK once per operation. Should reuse one prover rather than build a new one. */
export type PrivacyPoolsProverFactory = () => Promise<PrivacyPoolsProver>

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
export const createProverFactory = (baseUrl: string): (() => Promise<KohakuProver>) => {
  let proverPromise: Promise<KohakuProver> | null = null

  return () => {
    // Platforms without the artifacts pass an empty base; fail with the real reason, not a bad URL
    if (!baseUrl)
      return Promise.reject(
        new Error('privacyPools: proving is not available on this platform (no circuit artifacts)')
      )

    if (!proverPromise) {
      proverPromise = Prover({
        // `new URL(path, baseUrl)` drops the base's last segment unless it ends in a slash
        baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
        ...PRIVACY_POOLS_CIRCUIT_PATHS
      }).catch((error) => {
        // Cleared so a later withdrawal retries, or one transient failure would fail every proof
        proverPromise = null

        throw error
      })
    }

    return proverPromise
  }
}
