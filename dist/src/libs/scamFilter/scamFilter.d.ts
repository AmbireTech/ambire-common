import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
type ScamFilterOptions = {
    fetch: Fetch;
    network: Network;
    timeout?: number;
};
export declare class ScamFilter {
    #private;
    constructor({ fetch, network, timeout }: ScamFilterOptions);
    filterTokensWithoutAPrice(tokenAddresses: string[]): Promise<string[]>;
}
export {};
//# sourceMappingURL=scamFilter.d.ts.map