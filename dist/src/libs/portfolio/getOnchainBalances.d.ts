import { Network } from '../../interfaces/network';
import { Deployless, DeploylessMode } from '../deployless/deployless';
import { CollectionResult, GetOptions, LimitsOptions, MetaData, TokenError, TokenResult } from './interfaces';
export declare function getDeploylessOpts(accountAddr: string, supportsStateOverride: boolean, opts: Partial<GetOptions>): {
    blockTag: string | number | undefined;
    from: string;
    mode: DeploylessMode;
    stateToOverride: {
        [x: string]: {
            code: string;
            stateDiff: {
                [x: string]: string;
            };
        };
    } | null;
};
export declare function getNFTs(network: Network, deployless: Deployless, opts: Partial<GetOptions>, accountAddr: string, tokenAddrs: [string, any][], limits: LimitsOptions): Promise<[[TokenError, CollectionResult][], {}][]>;
export declare function getTokens(network: Network, deployless: Deployless, opts: Partial<GetOptions>, accountAddr: string, tokenAddrs: string[]): Promise<[[TokenError, TokenResult][], MetaData][]>;
//# sourceMappingURL=getOnchainBalances.d.ts.map