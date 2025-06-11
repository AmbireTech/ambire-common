import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
export declare class FailedPaymasters {
    failedSponsorshipIds: number[];
    insufficientFundsNetworks: {
        [chainId: number]: {
            lastSeenBalance: bigint;
        };
    };
    addFailedSponsorship(id: number): void;
    hasFailedSponsorship(id: number): boolean;
    addInsufficientFunds(provider: RPCProvider, network: Network): Promise<void>;
    hasInsufficientFunds(network: Network): boolean;
    removeInsufficientFunds(network: Network): void;
}
export declare const failedPaymasters: FailedPaymasters;
//# sourceMappingURL=FailedPaymasters.d.ts.map