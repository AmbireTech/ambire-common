import { DataService } from '@kohaku-eth/privacy-pools';
import type { EthereumProvider } from '@kohaku-eth/provider';
/**
 * How the plugin reads the chain. The pools' history comes from the saga-sync CDN when given;
 * everything else (the entrypoint, blocks after the CDN's last index, chains without a CDN) goes
 * to the provider through `createParallelLogSource`.
 *
 * Composes `createSagaLogSource` rather than `createSagaDataService`, which hardwires the SDK's
 * sequential reader as the fallback.
 */
export declare const createPrivacyPoolsDataService: ({ provider, saga, onSagaUnavailable }: {
    provider: EthereumProvider;
    /** Left out for a chain with nothing published, or one that already has a stored history. */
    saga?: {
        sourceUrl: string;
        chainId: bigint;
    };
    onSagaUnavailable: (error: unknown) => void;
}) => Promise<{
    dataService: DataService;
    isSagaHydrated: boolean;
}>;
//# sourceMappingURL=dataService.d.ts.map