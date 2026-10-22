import { IUiController } from '../../interfaces/ui';
import { Account, IAccountsController } from '../../interfaces/account';
import { AutoLoginPolicy, IAutoLoginController } from '../../interfaces/autoLogin';
import { Banner, IBannerController } from '../../interfaces/banner';
import { IDomainsController } from '../../interfaces/domains';
import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { INetworksController } from '../../interfaces/network';
import { IPortfolioController } from '../../interfaces/portfolio';
import { IProvidersController } from '../../interfaces/provider';
import { AccountSelection, ISelectedAccountController, SelectedAccountBalanceByAccount, SelectedAccountPortfolio, SelectedAccountType } from '../../interfaces/selectedAccount';
import { IStorageController } from '../../interfaces/storage';
import { SelectedAccountBalanceError } from '../../libs/selectedAccount/errors';
import EventEmitter from '../eventEmitter/eventEmitter';
export declare class SelectedAccountController extends EventEmitter implements ISelectedAccountController {
    #private;
    /**
     * The selected regular account. Also null while a Privacy Pools account is selected, so read
     * `selectedType` to tell that apart from being signed out.
     */
    account: Account | null;
    /**
     * Seed id of the selected Privacy Pools account, or null when a regular one is selected. Lives
     * here, not in the Privacy Pools controller, as it is part of "the selected account" to the UI
     * (signed in, dashboard) and this state reaches a view before its first paint.
     *
     * Exclusive with `account`, which is null meanwhile: the account has no address, and nothing that
     * reads `account` (portfolio, apps, signing) may act on it.
     */
    privacyPoolsAccountId: string | null;
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
    constructor({ eventEmitterRegistry, storage, accounts, autoLogin, banner, ui }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        storage: IStorageController;
        accounts: IAccountsController;
        autoLogin: IAutoLoginController;
        banner: IBannerController;
        ui: IUiController;
    });
    initControllers({ portfolio, networks, providers, domains }: {
        portfolio: IPortfolioController;
        networks: INetworksController;
        providers: IProvidersController;
        domains: IDomainsController;
    }): void;
    /** Selects a regular account or a Privacy Pools account in its place, never both. */
    select(selection: AccountSelection): Promise<void>;
    get selectedType(): SelectedAccountType;
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
    dismissEnsExpiryBannerForTheSelectedAccount(): Promise<void>;
    get banners(): Banner[];
    toJSON(): this & {
        selectedType: SelectedAccountType;
        banners: Banner[];
        deprecatedSmartAccountBanner: Banner[];
        autoLoginPolicies: AutoLoginPolicy[];
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=selectedAccount.d.ts.map