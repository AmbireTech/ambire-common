import { JsonRpcProvider } from 'ethers'

import type { Keystore, Network, Storage } from '@kohaku-eth/plugins'
import type { EthereumProvider } from '@kohaku-eth/provider'

import { Fetch } from '../../interfaces/fetch'
import { Hex } from '../../interfaces/hex'
import { IStorageController } from '../../interfaces/storage'

/**
 * Adapters for the `Host` contract every `@kohaku-eth/*` plugin binds against.
 *
 * Protocol-agnostic on purpose: Railgun and Privacy Pools ask for the same four things, so these
 * live under `kohaku/` rather than beside either protocol. Anything specific to one pool belongs in
 * that pool's own lib.
 *
 * The provider adapter is at the bottom of this file.
 */

/**
 * Backs a plugin's key-value storage with one blob in the wallet's own store.
 *
 * A single blob rather than a key each, because `StorageProps` is a closed, typed map and plugins
 * invent their keys at runtime. The blob is hydrated once and cached, so reads after the first are
 * free and a read always reflects the last write.
 *
 * Writes are awaited, unlike the Railgun adapter's debounced ones: Privacy Pools persists once at
 * the end of a sync rather than per commitment, so there is no burst to coalesce and losing the
 * write on a torn-down worker would cost a full rescan.
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
  // Serializes writes: the controller must never have two `storage.set` calls in flight, and a
  // sync can finish on two chains at once.
  let writeQueue: Promise<void> = Promise.resolve()

  const hydrate = (): Promise<Record<string, string>> => {
    if (cache) return Promise.resolve(cache)

    if (!hydratePromise) {
      hydratePromise = storage
        .get(storageKey, {})
        .then((blob) => {
          // A concurrent hydrate may have populated it already - keep the same object identity,
          // since pending writes mutate whatever `cache` pointed at.
          cache = cache || blob
          return cache
        })
        .catch((error) => {
          // Cleared so the next caller retries. Left rejected, one transient read failure would
          // poison every later get and set for the lifetime of the controller.
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

      // The SDK re-serializes its whole store on every sync, changed or not. Comparing is cheap;
      // persisting rewrites a blob that reaches several megabytes on mainnet.
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
 * Derives plugin keys without handing the plugin a recovery phrase.
 *
 * Deliberately not the SDK's bundled `MnemonicKeystore`, which holds the phrase: that would put it
 * inside an unaudited alpha for as long as the plugin lives. `deriveKey` is expected to whitelist
 * the paths it will answer for - see `KeystoreController.derivePrivacyPoolsKey`.
 *
 * The cache is what makes repeated derivation viable: Privacy Pools derives two keys per deposit
 * index on every sync while it scans for the user's notes, and each one is a fresh pbkdf2 over the
 * seed otherwise. It is dropped with the instance, so a lock or a seed change clears it.
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
 * Adapts an ethers `JsonRpcProvider` to the `EthereumProvider` plugins bind against.
 *
 * `@kohaku-eth/provider` ships this adapter as `@kohaku-eth/provider/ethers`, but that subpath
 * export cannot be resolved under the app's `moduleResolution: "node"`, which predates the
 * `exports` field. Reimplementing the surface over ethers is smaller and safer than moving the
 * whole app to `node16`.
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
