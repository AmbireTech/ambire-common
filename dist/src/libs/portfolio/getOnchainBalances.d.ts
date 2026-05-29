import { Network } from '../../interfaces/network';
import { AccountOp } from '../accountOp/accountOp';
import { Deployless, DeploylessMode } from '../deployless/deployless';
import { CollectionResult, GetOptions, GetOptionsSimulation, LimitsOptions, MetaData, TokenError, TokenResult } from './interfaces';
export declare function getDeploylessOpts(accountAddr: string, network: Network, opts: {
    simulation?: GetOptionsSimulation<AccountOp[]>;
    blockTag?: GetOptions['blockTag'];
}): {
    blockTag: number | "pending" | "latest" | "both";
    from: string;
    mode: DeploylessMode;
    stateToOverride: {
        [accountAddr]: {
            code: string;
            stateDiff: {
                [x: string]: string;
            };
        };
    };
};
export declare function getNFTs(network: Network, deployless: Deployless, opts: Pick<GetOptions, 'simulation' | 'blockTag'>, accountAddr: string, tokenAddrs: [string, bigint[]][], limits: LimitsOptions): Promise<[[TokenError, CollectionResult][], {}][]>;
export declare function getTokens(network: Network, deployless: Deployless, opts: Pick<GetOptions, 'simulation' | 'blockTag' | 'specialErc20Hints'>, accountAddr: string, tokenAddrs: string[], pageIndex?: number): Promise<[[TokenError, TokenResult][], MetaData][]>;
//# sourceMappingURL=getOnchainBalances.d.ts.map