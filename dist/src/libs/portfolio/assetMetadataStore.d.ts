/**
 * The metadata the portfolio remembers for one kind of asset (tokens or NFT
 * collections), kept per network so the chain is only asked for what is missing or
 * has aged out. Lives in memory only, so a restart reads everything in full again,
 * and drops the entries read longest ago once a network is over the limit.
 */
export declare class AssetMetadataStore<T extends {
    fetchedAt: number;
}> {
    #private;
    constructor(limitPerChain: number);
    /**
     * The metadata held for a network, for the portfolio to pass to the library so it
     * can ask the chain for balances alone.
     */
    getKnown(chainId: bigint): Map<string, T>;
    /**
     * Keeps metadata the portfolio library read from the chain. Entries replace what is
     * already held, which is how aged-out metadata gets refreshed. Returns whether
     * anything was kept.
     */
    learn(chainId: bigint, entries: [string, T][]): boolean;
}
//# sourceMappingURL=assetMetadataStore.d.ts.map