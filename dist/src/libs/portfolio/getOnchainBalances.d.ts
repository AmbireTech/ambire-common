import { Network } from '../../interfaces/network';
import { AccountOp } from '../accountOp/accountOp';
import { Deployless, DeploylessMode } from '../deployless/deployless';
import { CollectionMetadataFetchPlan, CollectionResult, DeploylessContractOptions, GetOptions, GetOptionsSimulation, LimitsOptions, MetaData, TokenError, TokenMetadataFetchPlan, TokenResult } from './interfaces';
export declare function getDeploylessOpts(accountAddr: string, network: Network, opts: {
    simulation?: GetOptionsSimulation<AccountOp[]>;
    blockTag?: GetOptions['blockTag'];
    deployless?: DeploylessContractOptions;
}): {
    blockTag: number | "latest" | "pending" | "both";
    from: string;
    mode: DeploylessMode;
    to: string;
    stateToOverride: any;
} | {
    blockTag: number | "latest" | "pending" | "both";
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
    to?: undefined;
};
/**
 * Turns the plan into what the contract takes and what the results are read back with,
 * for one page. `metaFlags` marks the assets whose metadata has to be read, one byte
 * per asset, because repeating those assets' addresses in a second array would cost a
 * whole word each while the caller usually knows most of them already. Trailing assets
 * are left out, as the contract reads a missing flag as no metadata.
 * `metaIndexByAddress` says where each flagged asset sits in the returned metadata,
 * which the contract packs in the same order.
 */
export declare function planMetaRequest(addresses: string[], needsMetadata: Set<string>): {
    metaFlags: string;
    metaIndexByAddress: Map<string, number>;
};
export declare function getNFTs(network: Network, deployless: Deployless, opts: Pick<GetOptions, 'simulation' | 'blockTag' | 'deployless'> & {
    metadataPlan: CollectionMetadataFetchPlan;
}, accountAddr: string, tokenAddrs: [string, bigint[]][], limits: LimitsOptions): Promise<[[TokenError, CollectionResult][], object][]>;
export declare function getTokens(network: Network, deployless: Deployless, opts: Pick<GetOptions, 'simulation' | 'blockTag' | 'specialErc20Hints' | 'deployless'> & {
    metadataPlan: TokenMetadataFetchPlan;
}, accountAddr: string, tokenAddrs: string[]): Promise<[[TokenError, TokenResult][], MetaData][]>;
//# sourceMappingURL=getOnchainBalances.d.ts.map