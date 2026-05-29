import { Account, IAccountsController } from '../../interfaces/account';
import { AutoLoginPolicy, IAutoLoginController } from '../../interfaces/autoLogin';
import { Banner, IBannerController } from '../../interfaces/banner';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { INetworksController } from '../../interfaces/network';
import { IPortfolioController } from '../../interfaces/portfolio';
import { IProvidersController } from '../../interfaces/provider';
import { ISelectedAccountController, SelectedAccountBalanceByAccount, SelectedAccountPortfolio } from '../../interfaces/selectedAccount';
import { IStorageController } from '../../interfaces/storage';
import { SelectedAccountBalanceError } from '../../libs/selectedAccount/errors';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare class SelectedAccountController extends EventEmitter implements ISelectedAccountController {
    #private;
    account: Account | null;
    /**
     * Holds the selected account portfolio that is used by the UI to display the portfolio.
     * It includes the portfolio and defi positions for the selected account.
     * It is updated when the portfolio or defi positions controllers are updated.
     */
    portfolio: SelectedAccountPortfolio;
    balanceByAccounts: SelectedAccountBalanceByAccount;
    dashboardNetworkFilter: bigint | string | null;
    balanceAffectingErrors: SelectedAccountBalanceError[];
    isReady: boolean;
    areControllersInitialized: boolean;
    initialLoadPromise?: Promise<void>;
    dismissedBannerIds: {
        [key: string]: string[];
    };
    constructor({ eventEmitterRegistry, storage, accounts, autoLogin, banner }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        storage: IStorageController;
        accounts: IAccountsController;
        autoLogin: IAutoLoginController;
        banner: IBannerController;
    });
    initControllers({ portfolio, networks, providers }: {
        portfolio: IPortfolioController;
        networks: INetworksController;
        providers: IProvidersController;
    }): void;
    setAccount(account: Account | null): Promise<void>;
    resetSelectedAccountPortfolio({ isManualUpdate, skipUpdate }?: {
        isManualUpdate?: boolean;
        skipUpdate?: boolean;
    }): void;
    updateSelectedAccountPortfolio(skipUpdate?: boolean): void;
    get deprecatedSmartAccountBanner(): Banner[];
    get autoLoginPolicies(): AutoLoginPolicy[];
    setDashboardNetworkFilter(networkFilter: bigint | string | null): void;
    removeNetworkData(chainId: bigint): void;
    dismissDefiPositionsBannerForTheSelectedAccount(): Promise<void>;
    get banners(): Banner[];
    toJSON(): this & {
        banners: Banner[];
        deprecatedSmartAccountBanner: Banner[];
        autoLoginPolicies: AutoLoginPolicy[];
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=selectedAccount.d.ts.map