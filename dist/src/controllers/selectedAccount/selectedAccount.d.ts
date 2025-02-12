import { Account } from '../../interfaces/account';
import { Banner } from '../../interfaces/banner';
import { NetworkId } from '../../interfaces/network';
import { SelectedAccountPortfolio } from '../../interfaces/selectedAccount';
import { Storage } from '../../interfaces/storage';
import { PositionsByProvider } from '../../libs/defiPositions/types';
import { SelectedAccountBalanceError } from '../../libs/selectedAccount/errors';
import { AccountsController } from '../accounts/accounts';
import { ActionsController } from '../actions/actions';
import { DefiPositionsController } from '../defiPositions/defiPositions';
import EventEmitter from '../eventEmitter/eventEmitter';
import { NetworksController } from '../networks/networks';
import { PortfolioController } from '../portfolio/portfolio';
import { ProvidersController } from '../providers/providers';
export declare const DEFAULT_SELECTED_ACCOUNT_PORTFOLIO: {
    tokens: never[];
    collections: never[];
    tokenAmounts: never[];
    totalBalance: number;
    isReadyToVisualize: boolean;
    isAllReady: boolean;
    networkSimulatedAccountOp: {};
    latest: {};
    pending: {};
};
export declare class SelectedAccountController extends EventEmitter {
    #private;
    account: Account | null;
    portfolio: SelectedAccountPortfolio;
    portfolioStartedLoadingAtTimestamp: number | null;
    dashboardNetworkFilter: NetworkId | null;
    defiPositions: PositionsByProvider[];
    isReady: boolean;
    areControllersInitialized: boolean;
    initialLoadPromise: Promise<void>;
    constructor({ storage, accounts }: {
        storage: Storage;
        accounts: AccountsController;
    });
    initControllers({ portfolio, defiPositions, actions, networks, providers }: {
        portfolio: PortfolioController;
        defiPositions: DefiPositionsController;
        actions: ActionsController;
        networks: NetworksController;
        providers: ProvidersController;
    }): void;
    setAccount(account: Account | null): Promise<void>;
    resetSelectedAccountPortfolio(skipUpdate?: boolean): void;
    get areDefiPositionsLoading(): boolean;
    get balanceAffectingErrors(): SelectedAccountBalanceError[];
    get deprecatedSmartAccountBanner(): Banner[];
    setDashboardNetworkFilter(networkFilter: NetworkId | null): void;
    toJSON(): this & {
        deprecatedSmartAccountBanner: Banner[];
        areDefiPositionsLoading: boolean;
        balanceAffectingErrors: SelectedAccountBalanceError[];
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=selectedAccount.d.ts.map