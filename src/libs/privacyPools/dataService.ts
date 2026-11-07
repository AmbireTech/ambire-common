import { createSagaLogSource, DataService } from '@kohaku-eth/privacy-pools'
import type { EthereumProvider } from '@kohaku-eth/provider'

import {
  PRIVACY_POOLS_SAGA_READ_TIMEOUT,
  PRIVACY_POOLS_SAGA_SYNC_PUBLIC_KEY
} from '../../consts/privacyPools'
import { withTimeout } from '../../utils/with-timeout'
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

  // The CDN reader asks the provider for the blocks it has not indexed yet. A failure there is the
  // provider's, so it must not move the next reads off the CDN.
  const providerErrors = new WeakSet<object>()
  const getLogsFromProvider: typeof getLogs = async (params) => {
    try {
      return await getLogs(params)
    } catch (error: unknown) {
      if (error instanceof Object) providerErrors.add(error)
      throw error
    }
  }

  try {
    // The CDN is read with the global fetch inside the SDK, so a timeout can only race it
    const sagaLogs = await withTimeout(
      () =>
        createSagaLogSource({
          sourceUrl: saga.sourceUrl,
          chainId: Number(saga.chainId),
          fallback: getLogsFromProvider,
          publicKey: PRIVACY_POOLS_SAGA_SYNC_PUBLIC_KEY
        }),
      { timeoutMs: PRIVACY_POOLS_SAGA_READ_TIMEOUT }
    )

    let hasSagaFailed = false
    const getLogsFromSaga: typeof getLogs = async (params) => {
      if (hasSagaFailed) return getLogs(params)

      try {
        return await withTimeout(() => sagaLogs(params), {
          timeoutMs: PRIVACY_POOLS_SAGA_READ_TIMEOUT
        })
      } catch (error: any) {
        if (providerErrors.has(error)) throw error

        hasSagaFailed = true
        onSagaUnavailable(error)

        return getLogs(params)
      }
    }

    return {
      dataService: new DataService({ provider, getLogs: getLogsFromSaga }),
      isSagaHydrated: true
    }
  } catch (error: any) {
    // Not fatal: the provider yields the same history, only slower
    onSagaUnavailable(error)

    return { dataService: new DataService({ provider, getLogs }), isSagaHydrated: false }
  }
}
