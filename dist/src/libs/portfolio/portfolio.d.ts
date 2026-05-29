import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { GetOptions, Hints, Limits, PortfolioLibGetResult, TokenError, TokenResult } from './interfaces';
export declare const LIMITS: Limits;
export declare const PORTFOLIO_LIB_ERROR_NAMES: {
    /** External hints API (Velcro) request failed but fallback is sufficient */
    NonCriticalApiHintsError: string;
    /** External API (Velcro) hints are older than X minutes */
    StaleApiHintsError: string;
    /** No external API (Velcro) hints are available- the request failed without fallback */
    NoApiHintsError: string;
    /** One or more cena request has failed */
    PriceFetchError: string;
    /** Defi discovery failed */
    DefiDiscoveryError: string;
};
export declare const getEmptyHints: () => Hints;
export declare class Portfolio {
    network: Network;
    provider: RPCProvider;
    private batchedVelcroDiscovery;
    private batchedGecko;
    private deploylessTokens;
    private deploylessNfts;
    constructor(fetch: Fetch, provider: RPCProvider, network: Network, velcroUrl?: string, customBatcher?: Function);
    /**
     * Fetch the hints from the external API (Velcro).
     * Main return cases:
     * - hints with `externalApi` property set if the hints are coming from the external API (and not from storage)
     * - empty hints if the hints are static and were learned less than X minutes ago. The goal is to reduce
     * unnecessary requests to deployless. Once every X minutes we make a call to Velcro, get the static hints and
     * learn the tokens with amount. In subsequent calls, we return empty hints and the portfolio lib uses the previously learned tokens.
     */
    protected externalHintsAPIDiscovery(options?: {
        disableAutoDiscovery?: boolean;
        chainId: bigint;
        accountAddr: string;
        baseCurrency: string;
    }): Promise<{
        hints: Hints;
        error?: PortfolioLibGetResult['errors'][number];
    }>;
    get(accountAddr: string, opts?: Partial<GetOptions>): Promise<PortfolioLibGetResult>;
    getTokensByAddresses(accountAddr: string, tokenAddrs: string[], opts: Pick<GetOptions, 'blockTag' | 'simulation' | 'specialErc20Hints'>): Promise<[TokenError, TokenResult][]>;
}
//# sourceMappingURL=portfolio.d.ts.map