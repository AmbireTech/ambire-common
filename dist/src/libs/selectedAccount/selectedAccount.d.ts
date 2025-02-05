import { SelectedAccountPortfolio } from '../../interfaces/selectedAccount';
import { AccountState as DefiPositionsAccountState } from '../defiPositions/types';
import { AccountState, NetworkState } from '../portfolio/interfaces';
export declare const updatePortfolioStateWithDefiPositions: (portfolioAccountState: AccountState, defiPositionsAccountState: DefiPositionsAccountState, areDefiPositionsLoading: boolean) => AccountState;
export declare const isNetworkReady: (networkData: NetworkState | undefined) => boolean | undefined;
export declare function calculateSelectedAccountPortfolio(latestStateSelectedAccount: AccountState, pendingStateSelectedAccount: AccountState, accountPortfolio: SelectedAccountPortfolio | null, hasSignAccountOp?: boolean): SelectedAccountPortfolio;
//# sourceMappingURL=selectedAccount.d.ts.map