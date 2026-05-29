import { NetworkState, PortfolioProjectedRewardsResult, ProjectedRewardsStats, TokenResult } from '../libs/portfolio/interfaces';
export declare const calculateRewardsStats: (projectedRewardsResult: PortfolioProjectedRewardsResult | undefined, walletOrStkWalletTokenPrice: number | undefined, currentBalance: number | undefined, stkBalanceUsd: number | undefined, walletEthProvidedLiquidityInUsd: number | undefined) => ProjectedRewardsStats | null;
export declare const getProjectedRewardsStatsAndToken: (projectedRewards: NetworkState<PortfolioProjectedRewardsResult> | undefined, walletOrStkWalletTokenPrice: number | undefined, currentBalance: number | undefined, stkBalanceUsd: number | undefined, walletEthProvidedLiquidityInUsd: number | undefined) => {
    token: TokenResult;
    data: ProjectedRewardsStats;
} | undefined;
//# sourceMappingURL=rewards.d.ts.map