import { Prover } from '@fatsolutions/privacy-pools-core-circuits'

import { PRIVACY_POOLS_CIRCUIT_PATHS } from '../../consts/privacyPools'

type KohakuProver = Awaited<ReturnType<typeof Prover>>

/**
 * Builds the prover the SDK uses for withdrawals and public reclaims, pointed at artifacts the app
 * serves itself.
 *
 * Two things are deliberately not the SDK's defaults:
 *
 * 1. `baseUrl`. Left alone, `Circuits` fetches from a pinned commit on raw.githubusercontent.com -
 *    a third-party host in the path of a withdrawal, needing a CSP entry and re-downloading ~23 MB
 *    every time a prover is constructed. The app passes a same-origin base instead (an extension
 *    URL, a bundled asset path), so proving works offline and nothing external is trusted.
 *
 * 2. Lifetime. `Prover()` eagerly loads both circuits and the SDK calls `proverFactory()` once per
 *    operation, so an unmemoized factory would re-read ~23 MB per withdrawal. One instance is
 *    built and shared; the artifacts stay resident, which is the trade for not re-reading them.
 *
 * The eager load is the SDK's, not ours: `Prover` awaits `initArtifacts` internally, and skipping
 * it would mean reimplementing the snarkjs call. Reading the extra ~3 MB commitment circuit once
 * costs far less than owning that code path.
 */
export const createProverFactory = (baseUrl: string): (() => Promise<KohakuProver>) => {
  let proverPromise: Promise<KohakuProver> | null = null

  return () => {
    // Platforms that do not ship the artifacts pass an empty base. Refusing here names the real
    // reason, instead of letting `Circuits` fail later on a nonsensical URL.
    if (!baseUrl)
      return Promise.reject(
        new Error('privacyPools: proving is not available on this platform (no circuit artifacts)')
      )

    if (!proverPromise) {
      proverPromise = Prover({
        // `Circuits` resolves each artifact with `new URL(path, baseUrl)`, so the base has to end
        // in a slash or its last segment is dropped.
        baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`,
        ...PRIVACY_POOLS_CIRCUIT_PATHS
      }).catch((error) => {
        // Cleared so a later withdrawal retries. Without this a single failed read - a transient
        // storage error, a worker torn down mid-fetch - would leave this promise rejected for the
        // lifetime of the controller and fail every subsequent proof with it.
        proverPromise = null

        throw error
      })
    }

    return proverPromise
  }
}
