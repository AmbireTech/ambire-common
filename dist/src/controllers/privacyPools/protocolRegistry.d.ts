import { PrivacyPoolsV1Protocol } from '@kohaku-eth/privacy-pools';
import type { Host } from '@kohaku-eth/plugins';
import { PrivacyPoolsChainConfig } from '../../interfaces/privacyPools';
import { PrivacyPoolsProverFactory } from '../../libs/privacyPools/prover';
import { PhraseScopedModule, PrivacyPoolsContext } from './context';
/** The Privacy Pools plugins, one per chain and recovery phrase, and what they are built from. */
export declare class PrivacyPoolsProtocolRegistry implements PhraseScopedModule {
    #private;
    constructor(ctx: PrivacyPoolsContext, proverFactory: PrivacyPoolsProverFactory);
    getHost(chainId: string, seedId: string): Host;
    /** Rebuilt when another phrase's sync persisted newer history since, to start from that. */
    getProtocol(chainId: string, seedId: string): Promise<PrivacyPoolsV1Protocol>;
    /** Whether the plugin has stored nothing for this chain yet. */
    isChainCold(config: PrivacyPoolsChainConfig): Promise<boolean>;
    /**
     * After a sync persisted the chain's history: other phrases' plugins on the chain are now behind
     * the store, while this one is at it. Also drops the plugins that hydrated the chain from the
     * CDN, whose reader would re-download the whole history on every sync. Their replacements start
     * from the persisted store.
     */
    markChainSynced(chainId: string, seedId: string): void;
    /** Drops the plugins built against a provider that has since been replaced. */
    dropStaleProviders(): void;
    hasPhraseDerivedState(): boolean;
    forgetSeed(seedId: string): void;
    clear(): void;
}
//# sourceMappingURL=protocolRegistry.d.ts.map