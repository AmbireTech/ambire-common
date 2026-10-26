import { createSagaLogSource, DataService } from '@kohaku-eth/privacy-pools'
import type { EthereumProvider } from '@kohaku-eth/provider'

import { createParallelLogSource } from './parallelLogSource'

/**
 * How the plugin reads the chain. The pools' history comes from the saga-sync CDN when given;
 * everything else (the entrypoint, blocks after the CDN's last index, chains without a CDN) goes
 * to the provider through `createParallelLogSource`.
 *
 * Composes `createSagaLogSource` rather than `createSagaDataService`, which hardwires the SDK's
 * sequential reader as the fallback.
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
    // Not fatal: the provider yields the same history, only slower
    onSagaUnavailable(error)

    return { dataService: new DataService({ provider, getLogs }), isSagaHydrated: false }
  }
}
