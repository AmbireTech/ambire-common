import { PrivacyPoolsAccountChainState, PrivacyPoolsChainState } from '../../interfaces/privacyPools';
import { PhraseScopedModule, PrivacyPoolsContext } from './context';
import { PrivacyPoolsProtocolRegistry } from './protocolRegistry';
/**
 * Syncing: every account syncs every chain in parallel, and asking again while a sync runs joins
 * it. Only a chain's shared state - the same for every account, and minutes to read the first
 * time - is read once: the other syncs of the chain wait for that read, then read only new blocks.
 */
export declare class PrivacyPoolsSync implements PhraseScopedModule {
    #private;
    constructor(ctx: PrivacyPoolsContext, registry: PrivacyPoolsProtocolRegistry);
    getAccountChainStates(seedId: string): {
        [chainId: string]: PrivacyPoolsAccountChainState;
    };
    /** The running sync of an account's chain, if any. */
    getRunningSync(seedId: string, chainId: string): Promise<void> | null;
    getEpoch(chainId: string, seedId: string): number;
    /** Per chain: an account's sync of it, with what this device knows of its shared state. */
    getChainStates(seedId: string | null, supportedChainIds: string[]): {
        [chainId: string]: PrivacyPoolsChainState;
    };
    /**
     * Reads a chain's notes for any account, beside the syncs of other accounts and chains, and
     * joins the running one if there is one. Which sync reads the chain's shared state is decided
     * here, with no await in between, so exactly one does.
     */
    queue(chainId: string, seedId: string): Promise<void>;
    hasPhraseDerivedState(): boolean;
    forgetSeed(seedId: string): void;
    /** Keeps what is known of each chain's shared state - see `InitialChainSync`. */
    clear(): void;
}
//# sourceMappingURL=sync.d.ts.map