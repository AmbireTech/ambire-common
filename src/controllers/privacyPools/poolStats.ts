import { getPrivacyPoolsStoreKey } from '../../consts/privacyPools'
import { PrivacyPoolsPoolStats } from '../../interfaces/privacyPools'
import {
  getPrivacyPoolsPoolLabels,
  getPrivacyPoolsPoolStats,
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

  constructor(ctx: PrivacyPoolsContext) {
    this.#ctx = ctx
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
    const state = JSON.parse(storedState)
    const statsByToken: { [tokenAddress: string]: PrivacyPoolsPoolStats } = {}
    for (const [poolAddress, tokenAddress] of Object.entries(config.pools)) {
      const history = readPrivacyPoolsPoolHistory(state, poolAddress)
      if (!history) return null

      statsByToken[tokenAddress.toLowerCase()] = getPrivacyPoolsPoolStats({
        history,
        blocksPerDay: config.blocksPerDay,
        poolLabels: this.#getLabels(
          `${chainId}:${poolAddress}`,
          history.scope,
          history.deposits.length
        )
      })
    }

    return statsByToken
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
