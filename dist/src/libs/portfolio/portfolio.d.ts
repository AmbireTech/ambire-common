import { JsonRpcProvider, Provider } from 'ethers';
import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
import { GetOptions, Hints, Limits, PortfolioLibGetResult } from './interfaces';
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
};
export declare const getEmptyHints: () => Hints;
export declare class Portfolio {
    network: Network;
    private batchedVelcroDiscovery;
    private batchedGecko;
    private deploylessTokens;
    private deploylessNfts;
    constructor(fetch: Fetch, provider: Provider | JsonRpcProvider, network: Network, velcroUrl?: string);
    get(accountAddr: string, opts?: Partial<GetOptions>): Promise<PortfolioLibGetResult>;
}
//# sourceMappingURL=portfolio.d.ts.map