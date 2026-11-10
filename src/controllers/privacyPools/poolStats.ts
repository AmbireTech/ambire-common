import { getPrivacyPoolsStoreKey, PRIVACY_POOLS_COVER_WINDOW_DAYS } from '../../consts/privacyPools'
import { PrivacyPoolsPoolStats } from '../../interfaces/privacyPools'
import {
  buildPrivacyPoolsDepositIndex,
  getPrivacyPoolsCoverDeposits,
  getPrivacyPoolsPoolLabels,
  getPrivacyPoolsPoolStats,
  PrivacyPoolsDepositIndex,
  readPrivacyPoolsPoolHistory
} from '../../libs/privacyPools/poolStats'
import { getChainConfig, PrivacyPoolsContext } from './context'

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
  #depositIndexes: {
    [chainId: string]: { [tokenAddress: string]: PrivacyPoolsDepositIndex }
  } = {}

  constructor(ctx: PrivacyPoolsContext) {
    this.#ctx = ctx
  }

  /** Replaces a chain's deposit indexes with ones read after its latest sync. */
  setDepositIndexes(
    chainId: string,
    depositIndexes: { [tokenAddress: string]: PrivacyPoolsDepositIndex }
  ) {
    this.#depositIndexes[chainId] = depositIndexes
  }

  hasDepositIndexes(chainId: string): boolean {
    return !!this.#depositIndexes[chainId]
  }

  /** The deposits of a token's pool as of the chain's last sync. Null before the first one. */
  getDepositIndex(chainId: string, tokenAddress: string): PrivacyPoolsDepositIndex | null {
    return this.#depositIndexes[chainId]?.[tokenAddress.toLowerCase()] ?? null
  }

  /**
   * The numbers and the deposit index of a chain's pools by their token's address in lowercase, as
   * of the chain's last sync. Null before the first one.
   */
  async read(chainId: string): Promise<{
    statsByToken: { [tokenAddress: string]: PrivacyPoolsPoolStats }
    depositIndexes: { [tokenAddress: string]: PrivacyPoolsDepositIndex }
  } | null> {
    const config = getChainConfig(chainId)
    const storedState = await this.#ctx.kohakuStorage.get(getPrivacyPoolsStoreKey(config))
    if (!storedState) return null

    // Parsed once for all the chain's pools, as it holds the whole chain's history
    const state = JSON.parse(storedState)
    const statsByToken: { [tokenAddress: string]: PrivacyPoolsPoolStats } = {}
    const depositIndexes: { [tokenAddress: string]: PrivacyPoolsDepositIndex } = {}
    for (const [poolAddress, tokenAddress] of Object.entries(config.pools)) {
      const history = readPrivacyPoolsPoolHistory(state, poolAddress)
      if (!history) return null

      const poolLabels = this.#getLabels(
        `${chainId}:${poolAddress}`,
        history.scope,
        history.deposits.length
      )
      depositIndexes[tokenAddress.toLowerCase()] = buildPrivacyPoolsDepositIndex(
        getPrivacyPoolsCoverDeposits(history, poolLabels),
        history.lastSyncedBlock - PRIVACY_POOLS_COVER_WINDOW_DAYS * config.blocksPerDay,
        history.lastSyncedBlock - config.blocksPerDay
      )
      statsByToken[tokenAddress.toLowerCase()] = getPrivacyPoolsPoolStats({
        history,
        blocksPerDay: config.blocksPerDay,
        poolLabels
      })
    }

    return { statsByToken, depositIndexes }
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
