import { Network, NetworkId } from '../../interfaces/network';
import { RPCProviders } from '../../interfaces/provider';
import { SelectedAccountPortfolioState } from '../../interfaces/selectedAccount';
import { AccountState as DefiPositionsAccountState, NetworksWithPositions } from '../defiPositions/types';
import { AccountAssetsState } from '../portfolio/interfaces';
export type Action = {
    label: 'Select';
    actionName: 'select-rpc-url';
    meta: {
        network: Network;
    };
};
export type SelectedAccountBalanceError = {
    id: string;
    networkIds: NetworkId[];
    type: 'error' | 'warning';
    title: string;
    text?: string;
    actions?: Action[];
};
export declare const getNetworksWithFailedRPCErrors: ({ providers, networks, networksWithAssets }: {
    providers: RPCProviders;
    networks: Network[];
    networksWithAssets: AccountAssetsState;
}) => SelectedAccountBalanceError[];
export declare const getNetworksWithPortfolioErrorErrors: ({ networks, selectedAccountLatest, providers }: {
    networks: Network[];
    selectedAccountLatest: SelectedAccountPortfolioState;
    providers: RPCProviders;
}) => SelectedAccountBalanceError[];
export declare const getNetworksWithDeFiPositionsErrorErrors: ({ networks, currentAccountState, providers, networksWithPositions }: {
    networks: Network[];
    currentAccountState: DefiPositionsAccountState;
    providers: RPCProviders;
    networksWithPositions: NetworksWithPositions;
}) => SelectedAccountBalanceError[];
//# sourceMappingURL=errors.d.ts.map