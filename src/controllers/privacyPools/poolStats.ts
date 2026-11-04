import { toBeHex } from 'ethers'

import {
  getPrivacyPoolsStoreKey,
  PRIVACY_POOLS_POOL_LABELS_STORAGE_KEY
} from '../../consts/privacyPools'
import { PrivacyPoolsPoolStats, PrivacyPoolsStoredPoolLabels } from '../../interfaces/privacyPools'
import { IStorageController } from '../../interfaces/storage'
import {
  decodePrivacyPoolsPoolLabels,
  encodePrivacyPoolsPoolLabels,
  getPrivacyPoolsPoolLabels,
  getPrivacyPoolsPoolStats,
  readPrivacyPoolsPoolHistory
} from '../../libs/privacyPools/poolStats'
import { getChainConfig, PrivacyPoolsContext } from './context'

/** The labels of a pool's deposits, in nonce order, with the scope they were derived from. */
type PoolLabels = { scope: bigint; labels: bigint[] }

/**
 * The numbers of the pools, the same for every account, from this device's copy of the pools'
 * history. Nothing is asked of the network, so they are as fresh as the last sync and nobody
 * learns which pool the user looks at.
 */
export class PrivacyPoolsPoolStatsReader {
  #ctx: PrivacyPoolsContext

  #storage: IStorageController

  /** Per pool (`chainId:poolAddress`), its deposits' labels by nonce. Grown as deposits come. */
  #labels = new Map<string, PoolLabels>()

  /** What is in storage for the labels, read once and kept in step with every write. */
  #storedLabels: PrivacyPoolsStoredPoolLabels | null = null

  /** Runs the label work of one `read` at a time, so two reads never derive the same labels. */
  #labelsQueue: Promise<unknown> = Promise.resolve()

  /** Runs the storage writes one at a time, as `storage.set` must not overlap. */
  #storageWriteQueue: Promise<void> = Promise.resolve()

  constructor(ctx: PrivacyPoolsContext, storage: IStorageController) {
    this.#ctx = ctx
    this.#storage = storage
  }

  /**
   * The numbers of a chain's pools by their token's address in lowercase, as of the chain's last
   * sync. Null before the first one.
   */
  async read(chainId: string): Promise<{ [tokenAddress: string]: PrivacyPoolsPoolStats } | null> {
    const config = getChainConfig(chainId)
    const storedState = await this.#ctx.kohakuStorage.get(getPrivacyPoolsStoreKey(config))
    if (!storedState) return null

    // Parsed once for all the chain's pools, as it holds the whole chain's history
    let t = Date.now() // PP_TIMING
    const state = JSON.parse(storedState)
    console.log(`PP_TIMING stats JSON.parse ${Date.now() - t} ms`) // PP_TIMING
    const statsByToken: { [tokenAddress: string]: PrivacyPoolsPoolStats } = {}
    for (const [poolAddress, tokenAddress] of Object.entries(config.pools)) {
      t = Date.now() // PP_TIMING
      const history = readPrivacyPoolsPoolHistory(state, poolAddress)
      console.log(
        `PP_TIMING stats history ${poolAddress} ${Date.now() - t} ms, ${history?.deposits.length} deposits`
      ) // PP_TIMING
      t = Date.now() // PP_TIMING
      if (!history) return null

      statsByToken[tokenAddress.toLowerCase()] = getPrivacyPoolsPoolStats({
        history,
        blocksPerDay: config.blocksPerDay,

        poolLabels: await this.#getLabels(
          `${chainId}:${poolAddress}`,
          history.scope,
          history.deposits.length
        )
      })
      console.log(`PP_TIMING stats labels and numbers ${Date.now() - t} ms`) // PP_TIMING
    }

    return statsByToken
  }

  /** Waits for the label work of the reads before it, but not for its failures. */
  #getLabels(poolKey: string, scope: bigint, depositsCount: number): Promise<bigint[]> {
    const labels = this.#labelsQueue.then(() => this.#loadLabels(poolKey, scope, depositsCount))
    // The failure reaches the caller through `labels`; the queue only needs to move on
    this.#labelsQueue = labels.catch(() => {})

    return labels
  }

  /**
   * Labels never change, so they are derived once per deposit: those already known, from memory or
   * from storage, are reused and only the new deposits' are derived. A stored value that does not
   * fit the pool is dropped and derived again.
   */
  async #loadLabels(poolKey: string, scope: bigint, depositsCount: number): Promise<bigint[]> {
    const startedAt = Date.now() // PP_TIMING
    let poolLabels = this.#labels.get(poolKey)

    if (!poolLabels || poolLabels.scope !== scope || poolLabels.labels.length > depositsCount) {
      poolLabels = await this.#readStoredLabels(poolKey, scope, depositsCount)
      this.#labels.set(poolKey, poolLabels)
    }

    const loadedCount = poolLabels.labels.length
    if (loadedCount === depositsCount) {
      console.log(
        `PP_TIMING labels ${poolKey} loaded ${loadedCount}, derived 0, ${Date.now() - startedAt} ms`
      ) // PP_TIMING
      return poolLabels.labels
    }

    const derivedLabels = await getPrivacyPoolsPoolLabels(
      scope,
      BigInt(loadedCount) + 1n,
      BigInt(depositsCount)
    )
    const allLabels = [...poolLabels.labels, ...derivedLabels]
    this.#labels.set(poolKey, { scope, labels: allLabels })
    console.log(
      `PP_TIMING labels ${poolKey} loaded ${loadedCount}, derived ${derivedLabels.length}, ${Date.now() - startedAt} ms`
    ) // PP_TIMING
    this.#storeLabels(poolKey, scope, allLabels)

    return allLabels
  }

  /** What storage holds for a pool, or none of it if it does not fit the pool. */
  async #readStoredLabels(
    poolKey: string,
    scope: bigint,
    depositsCount: number
  ): Promise<PoolLabels> {
    const stored = (await this.#getStoredLabels())[poolKey]
    if (!stored) return { scope, labels: [] }

    const labels = decodePrivacyPoolsPoolLabels(stored.labels)
    if (stored.scope === toBeHex(scope) && labels && labels.length <= depositsCount)
      return { scope, labels }

    this.#ctx.emitError({
      message: 'Could not read the saved Privacy Pools data of a pool. It will be rebuilt.',
      level: 'silent',
      error: new Error(`privacyPools: the stored labels of pool ${poolKey} do not fit it`)
    })

    return { scope, labels: [] }
  }

  async #getStoredLabels(): Promise<PrivacyPoolsStoredPoolLabels> {
    if (this.#storedLabels) return this.#storedLabels

    const stored = await this.#storage.get(PRIVACY_POOLS_POOL_LABELS_STORAGE_KEY, {})
    // Anything but a map is as good as nothing stored
    this.#storedLabels =
      stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}

    return this.#storedLabels
  }

  /**
   * Saves a pool's labels once memory has them, and not awaited, so the numbers do not wait for
   * the write. Losing it only means deriving them again.
   */
  #storeLabels(poolKey: string, scope: bigint, labels: bigint[]) {
    this.#storedLabels = {
      ...this.#storedLabels,
      [poolKey]: { scope: toBeHex(scope), labels: encodePrivacyPoolsPoolLabels(labels) }
    }

    this.#storageWriteQueue = this.#storageWriteQueue
      .then(() => this.#storage.set(PRIVACY_POOLS_POOL_LABELS_STORAGE_KEY, this.#storedLabels!))
      .catch((error) =>
        this.#ctx.emitError({
          message: 'Privacy Pools could not save its progress on this device.',
          level: 'silent',
          error: error instanceof Error ? error : new Error('privacyPools: labels write failed')
        })
      )
  }
}
