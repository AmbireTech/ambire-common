/**
 * The metadata the portfolio remembers for one kind of asset (tokens or NFT
 * collections), kept per network so the chain is only asked for what is missing or
 * has aged out. Lives in memory only, so a restart reads everything in full again,
 * and drops the entries read longest ago once a network is over the limit.
 */
export class AssetMetadataStore<T extends { fetchedAt: number }> {
  #byChainId: { [chainId: string]: Map<string, T> } = {}

  #limitPerChain: number

  constructor(limitPerChain: number) {
    this.#limitPerChain = limitPerChain
  }

  /**
   * The metadata held for a network, for the portfolio to pass to the library so it
   * can ask the chain for balances alone.
   */
  getKnown(chainId: bigint): Map<string, T> {
    const chainIdStr = chainId.toString()

    if (!this.#byChainId[chainIdStr]) this.#byChainId[chainIdStr] = new Map()

    return this.#byChainId[chainIdStr]
  }

  /**
   * Keeps metadata the portfolio library read from the chain. Entries replace what is
   * already held, which is how aged-out metadata gets refreshed. Returns whether
   * anything was kept.
   */
  learn(chainId: bigint, entries: [string, T][]): boolean {
    // A result carrying no metadata at all comes from a portfolio update that ran
    // before this was tracked, so there is nothing to keep
    if (!entries?.length) return false

    const metadata = this.getKnown(chainId)

    entries.forEach(([address, entry]) => metadata.set(address, entry))

    // Drop the assets read longest ago once the network is over the limit
    if (metadata.size > this.#limitPerChain) {
      const oldestFirst = [...metadata.entries()].sort(([, a], [, b]) => a.fetchedAt - b.fetchedAt)

      oldestFirst
        .slice(0, metadata.size - this.#limitPerChain)
        .forEach(([address]) => metadata.delete(address))
    }

    return true
  }
}
