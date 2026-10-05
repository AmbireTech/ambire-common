import { JsonRpcProvider } from 'ethers'

import type { Keystore, Network, Storage } from '@kohaku-eth/plugins'
import type { EthereumProvider } from '@kohaku-eth/provider'

import { Fetch } from '../../interfaces/fetch'
import { Hex } from '../../interfaces/hex'
import { IStorageController } from '../../interfaces/storage'

/**
 * Adapters for the `Host` every `@kohaku-eth/*` plugin binds against. Keep them protocol-agnostic;
 * protocol-specific code belongs in that protocol's lib.
 */

/**
 * Backs a plugin's key-value storage with one cached blob in the wallet's store, since
 * `StorageProps` is a closed map and plugins invent keys at runtime.
 *
 * Writes are awaited, not debounced: Privacy Pools persists once per sync, and a lost write would
 * cost a full rescan.
 */
export const createKohakuStorage = ({
  storage,
  storageKey,
  onError
}: {
  storage: IStorageController
  /** Which `StorageProps` entry holds this plugin's blob. */
  storageKey: 'privacyPoolsState'
  onError: (error: unknown, message?: string) => void
}): Storage => {
  let cache: Record<string, string> | null = null
  let hydratePromise: Promise<Record<string, string>> | null = null
  // Serializes writes: two chains can finish syncing at once, and `storage.set` must not overlap
  let writeQueue: Promise<void> = Promise.resolve()

  const hydrate = (): Promise<Record<string, string>> => {
    if (cache) return Promise.resolve(cache)

    if (!hydratePromise) {
      hydratePromise = storage
        .get(storageKey, {})
        .then((blob) => {
          // A concurrent hydrate may have set it already - keep that object, as writes mutate it
          cache = cache || blob
          return cache
        })
        .catch((error) => {
          // Cleared so the next caller retries, or one transient failure would poison every call
          hydratePromise = null
          throw error
        })
    }

    return hydratePromise
  }

  return {
    _brand: 'Storage',
    async get(key: string) {
      const blob = await hydrate()

      return blob[key] ?? null
    },
    async set(key: string, value: string) {
      const blob = await hydrate()

      // The SDK re-saves its whole store every sync; skip rewriting a multi-MB blob when unchanged
      if (blob[key] === value) return

      blob[key] = value

      writeQueue = writeQueue
        .then(() => storage.set(storageKey, blob))
        .catch((error) =>
          onError(error, 'Privacy Pools could not save its progress on this device.')
        )

      await writeQueue
    }
  }
}

/**
 * Derives plugin keys without giving the unaudited plugin the recovery phrase, unlike the SDK's
 * `MnemonicKeystore`. `deriveKey` must whitelist its paths - see
 * `KeystoreController.derivePrivacyPoolsKey`.
 *
 * Cached because every sync derives two keys per deposit index, each a pbkdf2 over the seed.
 * Dropped with the instance, so a lock or seed change clears it.
 */
export const createKohakuKeystore = (deriveKey: (path: string) => Promise<Hex>): Keystore => {
  const cache = new Map<string, Hex>()

  return {
    async deriveAt(path: string) {
      const cached = cache.get(path)
      if (cached) return cached

      const key = await deriveKey(path)
      cache.set(path, key)

      return key
    }
  }
}

/** Gives plugins the app's own fetch, so platform wiring and interception stay in one place. */
export const createKohakuNetwork = (fetch: Fetch): Network => ({
  fetch: (input, init) => fetch(input as any, init as any) as unknown as Promise<Response>
})

/**
 * Adapts an ethers `JsonRpcProvider` to the plugins' `EthereumProvider`. Reimplements
 * `@kohaku-eth/provider/ethers`, which the app's `moduleResolution: "node"` cannot resolve.
 */
export const createKohakuProvider = (
  provider: JsonRpcProvider
): EthereumProvider<JsonRpcProvider> => ({
  _internal: provider,

  getChainId: async () => (await provider.getNetwork()).chainId,

  async getLogs(filter) {
    const logs = await provider.getLogs({
      address: filter.address as string | undefined,
      topics: filter.topics as (string | null)[] | undefined,
      fromBlock: filter.fromBlock === undefined ? undefined : Number(filter.fromBlock),
      toBlock: filter.toBlock === undefined ? undefined : Number(filter.toBlock)
    })

    return logs.map((log) => ({
      blockNumber: BigInt(log.blockNumber),
      topics: [...log.topics],
      data: log.data,
      address: log.address
    }))
  },

  getBlockNumber: async () => BigInt(await provider.getBlockNumber()),

  async waitForTransaction(txHash: string) {
    await provider.waitForTransaction(txHash)
  },

  getBalance: (address: string) => provider.getBalance(address),

  getCode: (address: string) => provider.getCode(address),

  async getTransactionReceipt(txHash: string) {
    const receipt = await provider.getTransactionReceipt(txHash)
    if (!receipt) return null

    return {
      blockNumber: BigInt(receipt.blockNumber),
      status: BigInt(receipt.status ?? 0),
      gasUsed: receipt.gasUsed,
      logs: receipt.logs.map((log) => ({
        blockNumber: BigInt(log.blockNumber),
        topics: [...log.topics],
        data: log.data,
        address: log.address
      }))
    }
  },

  request: ({ method, params }) => provider.send(method, (params as unknown[]) ?? []),

  call: async (call) =>
    (await provider.call({
      to: call.to,
      from: call.from,
      data: call.input,
      value: call.value === undefined ? undefined : BigInt(call.value)
    })) as `0x${string}`,

  estimateGas: (call) =>
    provider.estimateGas({
      to: call.to,
      from: call.from,
      data: call.input,
      value: call.value === undefined ? undefined : BigInt(call.value)
    }),

  getGasPrice: async () => (await provider.getFeeData()).gasPrice ?? 0n,

  getTransactionCount: (address: string, block?: number) =>
    provider.getTransactionCount(address, block)
})
