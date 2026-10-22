import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { PORTFOLIO_LIB_ERROR_NAMES } from './errorNames';
import { GetOptions, Hints, Limits, PortfolioLibGetResult, TokenDataCache, TokenError, TokenResult } from './interfaces';
export declare const LIMITS: Limits;
export { PORTFOLIO_LIB_ERROR_NAMES };
export declare const getEmptyHints: () => Hints;
export declare class Portfolio {
    network: Network;
    provider: RPCProvider;
    private batchedVelcroDiscovery;
    private batchedGecko;
    private isTokenPricesEnabled;
    private deploylessTokens;
    private deploylessNfts;
    constructor(fetch: Fetch, provider: RPCProvider, network: Network, velcroUrl?: string, customBatcher?: Function, isTokenPricesEnabled?: () => boolean);
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
    getTokensByAddresses(accountAddr: string, tokenAddrs: string[], opts: Pick<GetOptions, 'blockTag' | 'simulation' | 'specialErc20Hints' | 'deployless'>): Promise<[TokenError, TokenResult][]>;
    getTokenPrice(address: string, { baseCurrency, tokenDataCache, tokenDataRecency }?: {
        baseCurrency?: string;
        tokenDataCache?: TokenDataCache;
        tokenDataRecency?: number;
    }): Promise<number | undefined>;
}
//# sourceMappingURL=portfolio.d.ts.map