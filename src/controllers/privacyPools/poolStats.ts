import { getPrivacyPoolsStoreKey, PRIVACY_POOLS_COVER_WINDOW_DAYS } from '../../consts/privacyPools'
import { PrivacyPoolsPoolStats } from '../../interfaces/privacyPools'
import {
  getPrivacyPoolsCoverDeposits,
  getPrivacyPoolsPoolLabels,
  getPrivacyPoolsPoolStats,
  PrivacyPoolsPoolCover,
  readPrivacyPoolsPoolHistory
} from '../../libs/privacyPools/poolStats'
import { getChainConfig, PrivacyPoolsContext } from './context'

/** A chain's pool covers by token address in lowercase. */
export type PrivacyPoolsPoolCoversByToken = { [tokenAddress: string]: PrivacyPoolsPoolCover }

/** What `PrivacyPoolsPoolStatsReader.read` gives for a chain's pools, by token address in lowercase. */
export type PrivacyPoolsChainPools = {
  statsByToken: { [tokenAddress: string]: PrivacyPoolsPoolStats }
  poolCovers: PrivacyPoolsPoolCoversByToken
}

/**
 * The numbers of the pools, the same for every account, from this device's copy of the pools'
 * history. Nothing is asked of the network, so they are as fresh as the last sync and nobody
 * learns which pool the user looks at.
 */
export class PrivacyPoolsPoolStatsReader {
  #ctx: PrivacyPoolsContext

  /** Per pool (`chainId:poolAddress`), its deposits' labels by nonce. Grown as deposits come. */
  #labels = new Map<string, bigint[]>()

  /**
   * Per chain, each pool's deposits by its token's address in lowercase. Public data, the same for
   * every account, so it outlives a lock.
   */
  #poolCovers: { [chainId: string]: PrivacyPoolsPoolCoversByToken } = {}

  /**
   * Per chain, whether each depositor checked so far has a Kohaku client fingerprint, by its
   * address in lowercase. Kept after the wallet locks, as it is public data. Each sync checks only
   * the depositors that are new, so it grows only as the pools grow.
   */
  #fingerprints: { [chainId: string]: Map<string, boolean> } = {}

  constructor(ctx: PrivacyPoolsContext) {
    this.#ctx = ctx
  }

  /** Replaces a chain's pool covers with ones read after its latest sync. */
  setPoolCovers(chainId: string, poolCovers: PrivacyPoolsPoolCoversByToken) {
    this.#poolCovers[chainId] = poolCovers
  }

  hasPoolCovers(chainId: string): boolean {
    return !!this.#poolCovers[chainId]
  }

  /** The deposits of a token's pool as of the chain's last sync. Null before the first one. */
  getPoolCover(chainId: string, tokenAddress: string): PrivacyPoolsPoolCover | null {
    return this.#poolCovers[chainId]?.[tokenAddress.toLowerCase()] ?? null
  }

  /**
   * Whether each depositor of a chain checked so far has a Kohaku client fingerprint, by its
   * address in lowercase. Null before any check of the chain succeeds.
   */
  getFingerprints(chainId: string): ReadonlyMap<string, boolean> | null {
    return this.#fingerprints[chainId] ?? null
  }

  /** Adds a check's results to the chain's depositors checked so far. */
  addFingerprints(chainId: string, checked: ReadonlyMap<string, boolean>) {
    const fingerprints = this.#fingerprints[chainId] ?? new Map<string, boolean>()
    this.#fingerprints[chainId] = fingerprints
    // A slower check of an older sync must not replace what a newer one already found
    checked.forEach((hasFingerprint, depositor) => {
      if (!fingerprints.has(depositor)) fingerprints.set(depositor, hasFingerprint)
    })
  }

  /**
   * The numbers and the cover of a chain's pools by their token's address in lowercase, as
   * of the chain's last sync. Null before the first one.
   */
  async read(chainId: string): Promise<PrivacyPoolsChainPools | null> {
    const config = getChainConfig(chainId)
    const storedState = await this.#ctx.kohakuStorage.get(getPrivacyPoolsStoreKey(config))
    if (!storedState) return null

    // Parsed once for all the chain's pools, as it holds the whole chain's history
    const state = JSON.parse(storedState)
    const pools: PrivacyPoolsChainPools = { statsByToken: {}, poolCovers: {} }
    for (const [poolAddress, tokenAddress] of Object.entries(config.pools)) {
      const history = readPrivacyPoolsPoolHistory(state, poolAddress)
      if (!history) return null

      const poolLabels = this.#getLabels(
        `${chainId}:${poolAddress}`,
        history.scope,
        history.deposits.length
      )
      const tokenKey = tokenAddress.toLowerCase()
      pools.poolCovers[tokenKey] = {
        deposits: getPrivacyPoolsCoverDeposits(history, poolLabels),
        recentAfterBlock:
          history.lastSyncedBlock - PRIVACY_POOLS_COVER_WINDOW_DAYS * config.blocksPerDay,
        freshAfterBlock: history.lastSyncedBlock - config.blocksPerDay
      }
      pools.statsByToken[tokenKey] = getPrivacyPoolsPoolStats({
        history,
        blocksPerDay: config.blocksPerDay,
        poolLabels
      })
    }

    return pools
  }

  /** Labels never change, so only the new deposits' are derived. */
  #getLabels(poolKey: string, scope: bigint, depositsCount: number): bigint[] {
    const labels = this.#labels.get(poolKey) || []
    if (labels.length >= depositsCount) return labels

    const allLabels = [
      ...labels,
      ...getPrivacyPoolsPoolLabels(scope, BigInt(labels.length) + 1n, BigInt(depositsCount))
    ]
    this.#labels.set(poolKey, allLabels)

    return allLabels
  }
}
