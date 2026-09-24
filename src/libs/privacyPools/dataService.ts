import { createSagaLogSource, DataService } from '@kohaku-eth/privacy-pools'
import type { EthereumProvider } from '@kohaku-eth/provider'

import { createParallelLogSource } from './parallelLogSource'

/**
 * How the plugin reads the chain.
 *
 * Two sources, layered. The pools' history, which is the bulk of it, comes from the saga-sync CDN
 * when the chain has one published and has nothing stored yet - one verified file per pool instead
 * of thousands of `eth_getLogs` calls. Everything else goes to the provider through a reader that
 * runs several windows at once: the entrypoint, which nobody publishes, the blocks since the CDN
 * last indexed, and every chain without a CDN at all.
 *
 * The seam is the CDN reader's own `fallback`, which is why this composes `createSagaLogSource`
 * rather than the `createSagaDataService` shorthand - the shorthand hardwires the provider's
 * one-window-at-a-time reader, which is the thing worth replacing.
 */
export const createPrivacyPoolsDataService = async ({
  provider,
  saga,
  onSagaUnavailable
}: {
  provider: EthereumProvider
  /** Left out for a chain with nothing published, or one that already has a stored history. */
  saga?: { sourceUrl: string; chainId: bigint }
  onSagaUnavailable: (error: unknown) => void
}): Promise<{ dataService: DataService; isSagaHydrated: boolean }> => {
  const getLogs = createParallelLogSource({ provider })

  if (!saga) return { dataService: new DataService({ provider, getLogs }), isSagaHydrated: false }

  try {
    const sagaLogs = await createSagaLogSource({
      sourceUrl: saga.sourceUrl,
      chainId: Number(saga.chainId),
      fallback: getLogs
    })

    return { dataService: new DataService({ provider, getLogs: sagaLogs }), isSagaHydrated: true }
  } catch (error: any) {
    // Deliberately not fatal. An unreachable or unverifiable manifest means the same history is
    // read from the provider instead - the same state, only slower. Nothing for the user to do.
    onSagaUnavailable(error)

    return { dataService: new DataService({ provider, getLogs }), isSagaHydrated: false }
  }
}
