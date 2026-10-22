import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
import { PrivacyPoolsTokenBalance } from '../../interfaces/privacyPools';
/** How a price is keyed: `${chainId}:${tokenAddress}`, the address lowercase, native as zero. */
export declare const getPrivacyPoolsPriceKey: (chainId: string | bigint, tokenAddress: string) => string;
/**
 * USD value per chain of the balances, the pending part included, as the account holds it. An
 * unpriced token adds nothing rather than making the chain's value unknown.
 */
export declare const getPrivacyPoolsValuePerChain: (balances: {
    [chainId: string]: PrivacyPoolsTokenBalance[];
}, prices: {
    [priceKey: string]: number;
}) => {
    [chainId: string]: number;
};
/**
 * USD prices of every asset the pools accept on the given networks. Asks for all of them, not only
 * the held ones, so the request reveals nothing about the account. Unpriced assets are left out.
 */
export declare const fetchPrivacyPoolsPrices: ({ fetch, networks }: {
    fetch: Fetch;
    networks: Network[];
}) => Promise<{
    [priceKey: string]: number;
}>;
//# sourceMappingURL=prices.d.ts.map