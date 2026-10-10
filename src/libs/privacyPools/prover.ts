import { Prover } from '@fatsolutions/privacy-pools-core-circuits'

import { PRIVACY_POOLS_CIRCUIT_PATHS } from '../../consts/privacyPools'

type KohakuProver = Awaited<ReturnType<typeof Prover>>

/**
 * The only part of a prover the SDK calls. Narrowed so a platform can prove elsewhere, e.g. in the
 * extension's offscreen document, on several threads.
 */
export type PrivacyPoolsProver = Pick<KohakuProver, 'prove'>

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
