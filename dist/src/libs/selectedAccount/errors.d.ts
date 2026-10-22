import { AccountOnchainState } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
import { RPCProviders } from '../../interfaces/provider';
import { SelectedAccountPortfolioState } from '../../interfaces/selectedAccount';
import { NetworksWithPositions } from '../defiPositions/types';
import { AccountAssetsState } from '../portfolio/interfaces';
import { PORTFOLIO_LIB_ERROR_NAMES } from '../portfolio/portfolio';
export type Action = {
    label: 'Select';
    actionName: 'select-rpc-url';
    meta: {
        network: Network;
    };
};
export type SelectedAccountBalanceError = {
    id: `custom-rpcs-down-${string}` | 'rpcs-down' | 'portfolio-critical' | 'portfolio-stale-block' | `stale-block-${string}` | 'loading-too-long' | 'defi-critical' | 'defi-apps' | 'defi-prices' | `${string}-defi-positions-error` | keyof typeof PORTFOLIO_LIB_ERROR_NAMES;
    networkNames: string[];
    type: 'error' | 'warning';
    title: string;
    text?: string;
    actions?: Action[];
};
export declare const addRPCError: (errors: SelectedAccountBalanceError[], chainId: string, networks: Network[]) => SelectedAccountBalanceError[];
/**
 * Tells the user that the network data we are getting is behind, so the displayed balances
 * are the last ones we could trust. Offers switching the RPC when there is another one.
 */
export declare const addStaleBlockError: (errors: SelectedAccountBalanceError[], network: Network) => SelectedAccountBalanceError[];
export declare const addPortfolioError: (errors: SelectedAccountBalanceError[], networkName: string, newError: keyof typeof PORTFOLIO_LIB_ERROR_NAMES | "portfolio-critical" | "loading-too-long") => SelectedAccountBalanceError[];
/**
 * Cases:
 * - All providers are not working - the user is offline and an error should not be displayed
 * - Critical RPC error on Ethereum (displayed immediately, because many things depend on it)
 * - Critical RPC error on other network - displayed after 10 mins of stale account state or portfolio state
 * - Critical portfolio error on any network - displayed after 10 mins of stale portfolio state
 * - Non-critical portfolio error on any network - displayed after 10 mins of stale portfolio state
 */
export declare const getNetworksWithErrors: ({ networks, selectedAccountPortfolioState, providers, accountState, shouldShowPartialResult, isAllReady, networksWithAssets }: {
    networks: Network[];
    selectedAccountPortfolioState: SelectedAccountPortfolioState;
    providers: RPCProviders;
    accountState: {
        [chainId: string]: AccountOnchainState;
    };
    isAllReady: boolean;
    shouldShowPartialResult: boolean;
    networksWithAssets: AccountAssetsState;
}) => SelectedAccountBalanceError[];
/**
 * The DeFi apps (`defiApps`) live outside of the per-network state, so they are missed by the
 * network loops above. Their failure silently lowers the total balance, hence the dedicated check.
 */
export declare const getDefiAppsErrors: (portfolioState: SelectedAccountPortfolioState) => SelectedAccountBalanceError[];
export declare const getNetworksWithDeFiPositionsErrorErrors: ({ networks, portfolioState, providers, networksWithPositions }: {
    networks: Network[];
    portfolioState: SelectedAccountPortfolioState;
    providers: RPCProviders;
    networksWithPositions: NetworksWithPositions;
}) => SelectedAccountBalanceError[];
//# sourceMappingURL=errors.d.ts.map