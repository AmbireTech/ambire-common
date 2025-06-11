"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelectedAccountController = exports.DEFAULT_SELECTED_ACCOUNT_PORTFOLIO = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const deploy_1 = require("../../consts/deploy");
const account_1 = require("../../libs/account/account");
const banners_1 = require("../../libs/banners/banners");
const helpers_1 = require("../../libs/defiPositions/helpers");
// eslint-disable-next-line import/no-cycle
const errors_1 = require("../../libs/selectedAccount/errors");
const selectedAccount_1 = require("../../libs/selectedAccount/selectedAccount");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
exports.DEFAULT_SELECTED_ACCOUNT_PORTFOLIO = {
    tokens: [],
    collections: [],
    tokenAmounts: [],
    totalBalance: 0,
    isReadyToVisualize: false,
    isAllReady: false,
    networkSimulatedAccountOp: {},
    latest: {},
    pending: {}
};
class SelectedAccountController extends eventEmitter_1.default {
    #storage;
    #accounts;
    #portfolio = null;
    #defiPositions = null;
    #actions = null;
    #networks = null;
    #providers = null;
    account = null;
    portfolio = exports.DEFAULT_SELECTED_ACCOUNT_PORTFOLIO;
    portfolioStartedLoadingAtTimestamp = null;
    #isPortfolioLoadingFromScratch = true;
    dashboardNetworkFilter = null;
    #shouldDebounceFlags = {};
    defiPositions = [];
    #portfolioErrors = [];
    #defiPositionsErrors = [];
    isReady = false;
    areControllersInitialized = false;
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    #cashbackStatusByAccount = {};
    constructor({ storage, accounts }) {
        super();
        this.#storage = storage;
        this.#accounts = accounts;
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.initialLoadPromise = this.#load();
    }
    async #load() {
        await this.#accounts.initialLoadPromise;
        const selectedAccountAddress = await this.#storage.get('selectedAccount', null);
        this.#cashbackStatusByAccount = await this.#storage.get('cashbackStatusByAccount', {});
        this.account = this.#accounts.accounts.find((a) => a.addr === selectedAccountAddress) || null;
        this.isReady = true;
        this.emitUpdate();
    }
    initControllers({ portfolio, defiPositions, actions, networks, providers }) {
        this.#portfolio = portfolio;
        this.#defiPositions = defiPositions;
        this.#actions = actions;
        this.#networks = networks;
        this.#providers = providers;
        this.#updateSelectedAccountPortfolio(true);
        this.#updatePortfolioErrors(true);
        this.#updateSelectedAccountDefiPositions(true);
        this.#updateDefiPositionsErrors(true);
        this.#portfolio.onUpdate(async () => {
            this.#debounceFunctionCallsOnSameTick('updateSelectedAccountPortfolio', () => {
                this.#updateSelectedAccountPortfolio();
            });
        }, 'selectedAccount');
        this.#defiPositions.onUpdate(() => {
            this.#debounceFunctionCallsOnSameTick('updateSelectedAccountDefiPositions', () => {
                this.#updateSelectedAccountDefiPositions();
                if (!this.areDefiPositionsLoading) {
                    this.#updateSelectedAccountPortfolio(true);
                    this.#updateDefiPositionsErrors();
                }
            });
        });
        this.#providers.onUpdate(() => {
            this.#debounceFunctionCallsOnSameTick('updateDefiPositionsErrors', () => {
                this.#updatePortfolioErrors(true);
                this.#updateDefiPositionsErrors();
            });
        });
        this.#networks.onUpdate(() => {
            this.#debounceFunctionCallsOnSameTick('resetDashboardNetworkFilterIfNeeded', () => {
                if (!this.dashboardNetworkFilter)
                    return;
                const dashboardFilteredNetwork = this.#networks.networks.find((n) => n.chainId === this.dashboardNetworkFilter);
                // reset the dashboardNetworkFilter if the network is removed
                if (!dashboardFilteredNetwork)
                    this.setDashboardNetworkFilter(null);
            });
        });
        this.#accounts.onUpdate(() => {
            this.#debounceFunctionCallsOnSameTick('updateSelectedAccount', () => {
                this.#updateSelectedAccount();
                this.#updatePortfolioErrors(true);
                this.#updateDefiPositionsErrors();
            });
        });
        this.areControllersInitialized = true;
        this.emitUpdate();
    }
    async setAccount(account) {
        this.account = account;
        this.#portfolioErrors = [];
        this.#defiPositionsErrors = [];
        this.resetSelectedAccountPortfolio(true);
        this.dashboardNetworkFilter = null;
        this.portfolioStartedLoadingAtTimestamp = null;
        if (!account) {
            await this.#storage.remove('selectedAccount');
        }
        else {
            await this.#storage.set('selectedAccount', account.addr);
        }
        this.emitUpdate();
    }
    #updateSelectedAccount() {
        if (!this.account)
            return;
        const updatedAccount = this.#accounts.accounts.find((a) => a.addr === this.account.addr);
        if (!updatedAccount)
            return;
        this.account = updatedAccount;
        this.emitUpdate();
    }
    resetSelectedAccountPortfolio(skipUpdate) {
        this.portfolio = exports.DEFAULT_SELECTED_ACCOUNT_PORTFOLIO;
        this.#portfolioErrors = [];
        this.#isPortfolioLoadingFromScratch = true;
        if (!skipUpdate) {
            this.emitUpdate();
        }
    }
    #updateSelectedAccountPortfolio(skipUpdate) {
        if (!this.#portfolio || !this.#defiPositions || !this.account)
            return;
        const defiPositionsAccountState = this.#defiPositions.getDefiPositionsState(this.account.addr);
        const latestStateSelectedAccount = structuredClone(this.#portfolio.getLatestPortfolioState(this.account.addr));
        const pendingStateSelectedAccount = structuredClone(this.#portfolio.getPendingPortfolioState(this.account.addr));
        const latestStateSelectedAccountWithDefiPositions = (0, selectedAccount_1.updatePortfolioStateWithDefiPositions)(latestStateSelectedAccount, defiPositionsAccountState, this.areDefiPositionsLoading);
        const pendingStateSelectedAccountWithDefiPositions = (0, selectedAccount_1.updatePortfolioStateWithDefiPositions)(pendingStateSelectedAccount, defiPositionsAccountState, this.areDefiPositionsLoading);
        const hasSignAccountOp = !!this.#actions?.visibleActionsQueue.filter((action) => action.type === 'accountOp');
        const newSelectedAccountPortfolio = (0, selectedAccount_1.calculateSelectedAccountPortfolio)(latestStateSelectedAccountWithDefiPositions, pendingStateSelectedAccountWithDefiPositions, this.portfolio, this.portfolioStartedLoadingAtTimestamp, defiPositionsAccountState, hasSignAccountOp, this.#isPortfolioLoadingFromScratch);
        // Reset the loading timestamp if the portfolio is ready
        if (this.portfolioStartedLoadingAtTimestamp && newSelectedAccountPortfolio.isAllReady) {
            this.portfolioStartedLoadingAtTimestamp = null;
        }
        // Set the loading timestamp when the portfolio starts loading
        if (!this.portfolioStartedLoadingAtTimestamp && !newSelectedAccountPortfolio.isAllReady) {
            this.portfolioStartedLoadingAtTimestamp = Date.now();
        }
        // Reset isPortfolioLoadingFromScratch flag when the portfolio has finished the initial load
        if (this.#isPortfolioLoadingFromScratch && newSelectedAccountPortfolio.isAllReady) {
            this.#isPortfolioLoadingFromScratch = false;
        }
        this.portfolio = newSelectedAccountPortfolio;
        this.#updatePortfolioErrors(true);
        this.updateCashbackStatus(skipUpdate);
        if (!skipUpdate) {
            this.emitUpdate();
        }
    }
    async updateCashbackStatus(skipUpdate) {
        if (!this.#portfolio || !this.account || !this.portfolio.latest.gasTank?.result)
            return;
        const accountId = this.account.addr;
        const gasTankResult = this.portfolio.latest.gasTank.result;
        const isCashbackZero = gasTankResult.gasTankTokens?.[0]?.cashback === 0n;
        const cashbackWasZeroBefore = this.#cashbackStatusByAccount[accountId] === 'no-cashback';
        const notReceivedFirstCashbackBefore = this.#cashbackStatusByAccount[accountId] !== 'unseen-cashback';
        if (isCashbackZero) {
            await this.changeCashbackStatus('no-cashback', skipUpdate);
        }
        else if (!isCashbackZero && cashbackWasZeroBefore && notReceivedFirstCashbackBefore) {
            await this.changeCashbackStatus('unseen-cashback', skipUpdate);
        }
    }
    async changeCashbackStatus(newStatus, skipUpdate) {
        if (!this.account)
            return;
        const accountId = this.account.addr;
        this.#cashbackStatusByAccount = {
            ...this.#cashbackStatusByAccount,
            [accountId]: newStatus
        };
        await this.#storage.set('cashbackStatusByAccount', this.#cashbackStatusByAccount);
        if (!skipUpdate) {
            this.emitUpdate();
        }
    }
    get areDefiPositionsLoading() {
        if (!this.account || !this.#defiPositions)
            return false;
        const defiPositionsAccountState = this.#defiPositions.getDefiPositionsState(this.account.addr);
        return Object.values(defiPositionsAccountState).some((n) => n.isLoading);
    }
    #updateSelectedAccountDefiPositions(skipUpdate) {
        if (!this.#defiPositions || !this.account)
            return;
        const defiPositionsAccountState = this.#defiPositions.getDefiPositionsState(this.account.addr);
        const positionsByProvider = Object.values(defiPositionsAccountState).flatMap((n) => n.positionsByProvider);
        const positionsByProviderWithSortedAssets = positionsByProvider.map((provider) => {
            const positions = provider.positions
                .map((position) => {
                const assets = position.assets.sort((a, b) => (0, helpers_1.sortByValue)(a.value, b.value));
                return { ...position, assets };
            })
                .sort((a, b) => (0, helpers_1.sortByValue)(a.additionalData.positionInUSD, b.additionalData.positionInUSD));
            return { ...provider, positions };
        });
        const sortedPositionsByProvider = positionsByProviderWithSortedAssets.sort((a, b) => (0, helpers_1.sortByValue)(a.positionInUSD, b.positionInUSD));
        this.defiPositions = sortedPositionsByProvider;
        if (!skipUpdate) {
            this.emitUpdate();
        }
    }
    #debounceFunctionCallsOnSameTick(funcName, func) {
        if (this.#shouldDebounceFlags[funcName])
            return;
        this.#shouldDebounceFlags[funcName] = true;
        // Debounce multiple calls in the same tick and only execute one of them
        setTimeout(() => {
            this.#shouldDebounceFlags[funcName] = false;
            try {
                func();
            }
            catch (error) {
                this.emitError({
                    level: 'minor',
                    message: `The execution of ${funcName} in SelectedAccountController failed`,
                    error
                });
            }
        }, 0);
    }
    #updateDefiPositionsErrors(skipUpdate) {
        if (!this.account ||
            !this.#networks ||
            !this.#providers ||
            !this.#defiPositions ||
            this.areDefiPositionsLoading) {
            this.#defiPositionsErrors = [];
            if (!skipUpdate) {
                this.emitUpdate();
            }
            return;
        }
        const defiPositionsAccountState = this.#defiPositions.getDefiPositionsState(this.account.addr);
        const errorBanners = (0, errors_1.getNetworksWithDeFiPositionsErrorErrors)({
            networks: this.#networks.networks,
            currentAccountState: defiPositionsAccountState,
            providers: this.#providers.providers,
            networksWithPositions: this.#defiPositions.getNetworksWithPositions(this.account.addr)
        });
        this.#defiPositionsErrors = errorBanners;
        if (!skipUpdate) {
            this.emitUpdate();
        }
    }
    #updatePortfolioErrors(skipUpdate) {
        if (!this.account ||
            !this.#networks ||
            !this.#providers ||
            !this.#portfolio ||
            !this.portfolio.isReadyToVisualize) {
            this.#portfolioErrors = [];
            if (!skipUpdate) {
                this.emitUpdate();
            }
            return;
        }
        const networksWithFailedRPCBanners = (0, errors_1.getNetworksWithFailedRPCErrors)({
            providers: this.#providers.providers,
            networks: this.#networks.networks,
            networksWithAssets: this.#portfolio.getNetworksWithAssets(this.account.addr)
        });
        const errorBanners = (0, errors_1.getNetworksWithPortfolioErrorErrors)({
            networks: this.#networks.networks,
            selectedAccountLatest: this.portfolio.latest,
            providers: this.#providers.providers,
            isAllReady: this.portfolio.isAllReady
        });
        this.#portfolioErrors = [...networksWithFailedRPCBanners, ...errorBanners];
        if (!skipUpdate) {
            this.emitUpdate();
        }
    }
    get balanceAffectingErrors() {
        return [...this.#portfolioErrors, ...this.#defiPositionsErrors];
    }
    get deprecatedSmartAccountBanner() {
        if (!this.account || !(0, account_1.isSmartAccount)(this.account))
            return [];
        if (!this.#accounts.accountStates[this.account.addr] ||
            !this.#accounts.accountStates[this.account.addr]['1'] ||
            !this.#accounts.accountStates[this.account.addr]['1'].isV2)
            return [];
        if (!this.account.creation ||
            (0, ethers_1.getAddress)(this.account.creation.factoryAddr) === deploy_1.AMBIRE_ACCOUNT_FACTORY)
            return [];
        return [
            {
                id: 'old-account',
                accountAddr: this.account.addr,
                type: 'warning',
                category: 'old-account',
                title: 'Old Ambire Account',
                text: "The account you are using is an old Ambire Account that was intended for testing the extension only. Fee options aren't available on custom networks. It won't be supported in the future. Please migrate to another by creating a new smart account in the extension or contact the team for support",
                actions: []
            }
        ];
    }
    get firstCashbackBanner() {
        if (!this.account || !(0, account_1.isSmartAccount)(this.account) || !this.#portfolio)
            return [];
        return (0, banners_1.getFirstCashbackBanners)({
            selectedAccountAddr: this.account.addr,
            cashbackStatusByAccount: this.#cashbackStatusByAccount
        });
    }
    get cashbackStatus() {
        if (!this.account)
            return undefined;
        return this.#cashbackStatusByAccount[this.account.addr];
    }
    setDashboardNetworkFilter(networkFilter) {
        this.dashboardNetworkFilter = networkFilter;
        this.emitUpdate();
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            firstCashbackBanner: this.firstCashbackBanner,
            cashbackStatus: this.cashbackStatus,
            deprecatedSmartAccountBanner: this.deprecatedSmartAccountBanner,
            areDefiPositionsLoading: this.areDefiPositionsLoading,
            balanceAffectingErrors: this.balanceAffectingErrors
        };
    }
}
exports.SelectedAccountController = SelectedAccountController;
//# sourceMappingURL=selectedAccount.js.map