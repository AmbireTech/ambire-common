import { Client, HttpStore } from '@saga-sync/client'

import type { ExternalSyncProvider } from '@kohaku-eth/plugins'

const toHex = (value: bigint): `0x${string}` => `0x${value.toString(16)}`

/**
 * Serves a plugin's cold sync from fatlabs' saga CDN: each pool's history as signed,
 * content-addressed files, verified chunk by chunk by the client. The plugin reads the blocks after
 * the CDN's last one from the chain itself.
 *
 * The manifest is read once, so `lastCoveredBlock` stays fixed for this provider's life; build a
 * new one per sync session. A pool the CDN does not publish throws, which the SDK reads as "sync
 * this one from the chain".
 */
export const createSagaExternalSyncProvider = (sourceUrl: string): ExternalSyncProvider => {
  const client = new Client({ source: new HttpStore(sourceUrl) })
  let manifestPromise: ReturnType<Client['fetchManifest']> | null = null

  const getManifest = () => {
    if (!manifestPromise) {
      manifestPromise = client.fetchManifest().catch((error: unknown) => {
        // Cleared so the next call retries, or one transient failure would disable the CDN
        manifestPromise = null
        throw error
      })
    }

    return manifestPromise
  }

  const getCoverage = async ({ chainId, address }: { chainId: `0x${string}`; address: string }) => {
    const [manifest, protocolId] = await Promise.all([
      getManifest(),
      client.resolveProtocolId({ chainId, address: address as `0x${string}` })
    ])
    const firstBlock = manifest.firstCoveredBlock(protocolId)
    const lastBlock = manifest.lastCoveredBlock(protocolId)
    if (firstBlock === null || lastBlock === null)
      throw new Error(`saga: no history for ${address} on chain ${chainId}`)

    return { protocolId, firstBlock, lastBlock }
  }

  return {
    async *streamEvents({ chainId, address, fromBlock, toBlock }) {
      const { protocolId } = await getCoverage({ chainId, address })

      yield* client.streamEvents(protocolId, {
        fromBlock: BigInt(fromBlock),
        toBlock: BigInt(toBlock)
      })
    },
    async firstCoveredBlock({ chainId, address }) {
      return toHex((await getCoverage({ chainId, address })).firstBlock)
    },
    async lastCoveredBlock({ chainId, address }) {
      return toHex((await getCoverage({ chainId, address })).lastBlock)
    }
  }
}
