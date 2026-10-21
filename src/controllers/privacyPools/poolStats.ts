import { getPrivacyPoolsStoreKey, isPrivacyPoolsNativeAsset } from '../../consts/privacyPools'
import { PrivacyPoolsPoolStats } from '../../interfaces/privacyPools'
import {
  getPrivacyPoolsPoolLabels,
  getPrivacyPoolsPoolStats,
  PrivacyPoolsPoolOnchainState,
  readPrivacyPoolsPoolHistory,
  readPrivacyPoolsPoolOnchainState
} from '../../libs/privacyPools/poolStats'
import { getChainConfig, getChainProvider, PrivacyPoolsContext } from './context'

/**
 * The numbers of the pools, the same for every account. Mostly from this device's copy of the
 * pools' history; what it holds and the verified deposits from the chain, as that copy misses
 * deposits (see `readPrivacyPoolsPoolHistory`). The chain is read once per sync of the history,
 * so the numbers stay as fresh as the rest, and only the pool is asked about, nothing of the user.
 */
export class PrivacyPoolsPoolStatsReader {
  #ctx: PrivacyPoolsContext

  /** Per pool (`chainId:poolAddress`), the chain's state as of a sync of the history. */
  #onchainStates = new Map<
    string,
    { lastSyncedBlock: bigint; state: Promise<PrivacyPoolsPoolOnchainState> }
  >()

  /** Per pool, its deposits' labels by nonce. Grown as deposits come, as they never change. */
  #labels = new Map<string, bigint[]>()

  constructor(ctx: PrivacyPoolsContext) {
    this.#ctx = ctx
  }

  /** A token's pool's numbers, as of the chain's last sync. Null before the first one. */
  async get(chainId: string, tokenAddress: string): Promise<PrivacyPoolsPoolStats | null> {
    const config = getChainConfig(chainId)
    const [poolAddress, assetAddress] =
      Object.entries(config.pools).find(
        ([, asset]) => asset.toLowerCase() === tokenAddress.toLowerCase()
      ) || []
    if (!poolAddress || !assetAddress)
      throw new Error(`privacyPools: no pool for ${tokenAddress} on ${chainId}`)

    const storedState = await this.#ctx.kohakuStorage.get(getPrivacyPoolsStoreKey(config))
    const history = readPrivacyPoolsPoolHistory(storedState, poolAddress)
    if (!history) return null

    const poolKey = `${chainId}:${poolAddress}`
    const onchainState = await this.#readOnchainState({
      chainId,
      poolKey,
      poolAddress,
      assetAddress,
      lastSyncedBlock: history.lastSyncedBlock
    })

    return getPrivacyPoolsPoolStats({
      history,
      blocksPerDay: config.blocksPerDay,
      poolBalance: onchainState.balance,
      poolLabels: this.#getLabels(poolKey, onchainState)
    })
  }

  #readOnchainState({
    chainId,
    poolKey,
    poolAddress,
    assetAddress,
    lastSyncedBlock
  }: {
    chainId: string
    poolKey: string
    poolAddress: string
    assetAddress: string
    lastSyncedBlock: bigint
  }): Promise<PrivacyPoolsPoolOnchainState> {
    const cached = this.#onchainStates.get(poolKey)
    if (cached && cached.lastSyncedBlock === lastSyncedBlock) return cached.state

    const state = readPrivacyPoolsPoolOnchainState({
      provider: getChainProvider(this.#ctx.providers, chainId),
      poolAddress,
      assetAddress,
      isNative: isPrivacyPoolsNativeAsset(assetAddress)
    })
    this.#onchainStates.set(poolKey, { lastSyncedBlock, state })
    // A failed read is not kept, so the next look tries again
    state.catch(() => {
      if (this.#onchainStates.get(poolKey)?.state === state) this.#onchainStates.delete(poolKey)
    })

    return state
  }

  #getLabels(poolKey: string, { scope, depositsCount }: PrivacyPoolsPoolOnchainState): bigint[] {
    const labels = this.#labels.get(poolKey) || []
    if (BigInt(labels.length) >= depositsCount) return labels

    const allLabels = [
      ...labels,
      ...getPrivacyPoolsPoolLabels(scope, BigInt(labels.length) + 1n, depositsCount)
    ]
    this.#labels.set(poolKey, allLabels)

    return allLabels
  }
}
