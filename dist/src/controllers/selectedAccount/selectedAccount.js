"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SelectedAccountController = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const deploy_1 = require("../../consts/deploy");
const account_1 = require("../../libs/account/account");
const banners_1 = require("../../libs/banners/banners");
const errors_1 = require("../../libs/selectedAccount/errors");
const selectedAccount_1 = require("../../libs/selectedAccount/selectedAccount");
const eventEmitter_1 = tslib_1.__importDefault(require("../eventEmitter/eventEmitter"));
// Portfolio recalculations fire back-to-back as per-network results stream in.
// Throttle their UI emit so the state isn't serialized on every partial tick.
const PORTFOLIO_UPDATE_THROTTLE_MS = 100;
// The constant is already checksummed, so an address matches it when the two agree
// without regard to case - which needs no keccak hash of the address to find out.
const AMBIRE_ACCOUNT_FACTORY_LOWERCASED = deploy_1.AMBIRE_ACCOUNT_FACTORY.toLowerCase();
class SelectedAccountController extends eventEmitter_1.default {
    #storage;
    #accounts;
    #autoLogin;
    #portfolio = null;
    #networks = null;
    #providers = null;
    #banner = null;
    #domains = null;
    #ui = null;
    /**
     * The selected regular account. Also null while a Privacy Pools account is selected, so read
     * `selectedType` to tell that apart from being signed out.
     */
    account = null;
    /**
     * Seed id of the selected Privacy Pools account, or null when a regular one is selected. Lives
     * here, not in the Privacy Pools controller, as it is part of "the selected account" to the UI
     * (signed in, dashboard) and this state reaches a view before its first paint.
     *
     * Exclusive with `account`, which is null meanwhile: the account has no address, and nothing that
     * reads `account` (portfolio, apps, signing) may act on it.
     */
    privacyPoolsAccountId = null;
    /**
     * Holds the selected account portfolio that is used by the UI to display the portfolio.
     * It includes the portfolio and defi positions for the selected account.
     * It is updated when the portfolio or defi positions controllers are updated.
     */
    portfolio = selectedAccount_1.DEFAULT_SELECTED_ACCOUNT_PORTFOLIO;
    balanceByAccounts = {};
    #portfolioLoadingTimeout = null;
    #isManualUpdate = true;
    dashboardNetworkFilter = null;
    #shouldDebounceFlags = {};
    balanceAffectingErrors = [];
    isReady = false;
    areControllersInitialized = false;
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    dismissedBannerIds = {};
    constructor({ eventEmitterRegistry, storage, accounts, autoLogin, banner, ui }) {
        super(eventEmitterRegistry);
        this.#storage = storage;
        this.#accounts = accounts;
        this.#autoLogin = autoLogin;
        this.#banner = banner;
        this.#ui = ui;
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    async #load() {
        await this.#accounts.initialLoadPromise;
        const [selectedAccountAddress, selectedAccountDismissedBannerIds, privacyPoolsAccountId] = await Promise.all([
            this.#storage.get('selectedAccount', null),
            this.#storage.get('selectedAccountDismissedBannerIds', {}),
            this.#storage.get('selectedPrivacyPoolsAccount', null)
        ]);
        this.dismissedBannerIds = selectedAccountDismissedBannerIds;
        this.account = this.#accounts.accounts.find((a) => a.addr === selectedAccountAddress) || null;
        // Only when no regular account is selected, in case storage ever holds both
        this.privacyPoolsAccountId = this.account ? null : privacyPoolsAccountId;
        this.isReady = true;
        this.emitUpdate();
    }
    initControllers({ portfolio, networks, providers, domains }) {
        this.#portfolio = portfolio;
        this.#networks = networks;
        this.#providers = providers;
        this.#domains = domains;
        this.updateSelectedAccountPortfolio(true);
        this.#updatePortfolioErrors(true);
        this.#portfolio.onUpdate(async () => {
            this.#debounceFunctionCallsOnSameTick('updateSelectedAccountPortfolio', () => {
                this.updateSelectedAccountPortfolio();
            });
        }, 'selectedAccount');
        this.#domains.onUpdate(() => {
            this.#debounceFunctionCallsOnSameTick('updateDomainData', () => {
                if (this.account)
                    this.propagateUpdate();
            });
        });
        this.#providers.onUpdate(() => {
            this.#debounceFunctionCallsOnSameTick('updateErrors', () => {
                this.#updatePortfolioErrors();
            });
        });
        this.#accounts.onUpdate(() => {
            this.#debounceFunctionCallsOnSameTick('updateSelectedAccount', () => {
                this.#updateSelectedAccount(true);
                this.#updatePortfolioErrors();
            });
        });
        this.#autoLogin.onUpdate((forceEmit) => {
            if (this.account) {
                this.propagateUpdate(forceEmit);
            }
        });
        this.areControllersInitialized = true;
        this.emitUpdate();
    }
    /** Selects a regular account or a Privacy Pools account in its place, never both. */
    async select(selection) {
        // Both are set before the update goes out, so the UI never sees a mix of the two
        this.account = selection && 'account' in selection ? selection.account : null;
        this.privacyPoolsAccountId =
            selection && 'privacyPoolsSeedId' in selection ? selection.privacyPoolsSeedId : null;
        this.balanceAffectingErrors = [];
        this.resetSelectedAccountPortfolio({ skipUpdate: true });
        const isStateWithOutdatedNetworks = this.account &&
            this.#portfolio &&
            this.#portfolio.getIsStateWithOutdatedNetworks(this.account.addr);
        // Display the current portfolio state immediately only if the user hasn't
        // added/removed networks since the last time the portfolio was calculated.
        if (!isStateWithOutdatedNetworks) {
            this.updateSelectedAccountPortfolio(true);
        }
        this.dashboardNetworkFilter = null;
        if (this.#portfolioLoadingTimeout)
            clearTimeout(this.#portfolioLoadingTimeout);
        this.#portfolioLoadingTimeout = null;
        this.emitUpdate();
        await this.#persistSelection();
    }
    get selectedType() {
        if (this.account)
            return 'regular';
        if (this.privacyPoolsAccountId)
            return 'privacyPools';
        return null;
    }
    // The new key is written before the other is removed: an interrupted write leaves both, and
    // `#load` then prefers the regular account, instead of leaving neither and signing out.
    async #persistSelection() {
        if (this.account) {
            // @TODO: Persist in one key once we have other accounts (like Tornado)
            await this.#storage.set('selectedAccount', this.account.addr);
            await this.#storage.remove('selectedPrivacyPoolsAccount');
            return;
        }
        if (this.privacyPoolsAccountId) {
            await this.#storage.set('selectedPrivacyPoolsAccount', this.privacyPoolsAccountId);
            await this.#storage.remove('selectedAccount');
            return;
        }
        await this.#storage.remove('selectedAccount');
        await this.#storage.remove('selectedPrivacyPoolsAccount');
    }
    #updateSelectedAccount(skipUpdate = false) {
        if (!this.account)
            return;
        const updatedAccount = this.#accounts.accounts.find((a) => a.addr === this.account.addr);
        if (!updatedAccount)
            return;
        this.account = updatedAccount;
        if (!skipUpdate)
            this.emitUpdate();
    }
    resetSelectedAccountPortfolio({ isManualUpdate, skipUpdate } = {}) {
        // Also runs with no regular account, so the last one's portfolio doesn't outlive it
        if (!this.#portfolio)
            return;
        if (isManualUpdate) {
            this.#isManualUpdate = true;
        }
        this.portfolio = selectedAccount_1.DEFAULT_SELECTED_ACCOUNT_PORTFOLIO;
        this.balanceAffectingErrors = [];
        if (!skipUpdate) {
            this.emitUpdate();
        }
    }
    updateSelectedAccountPortfolio(skipUpdate) {
        if (!this.#portfolio || !this.account)
            return;
        const portfolioAccountState = this.#portfolio.getAccountPortfolioState(this.account.addr);
        const newSelectedAccountPortfolio = (0, selectedAccount_1.calculateSelectedAccountPortfolio)(portfolioAccountState, this.portfolio.shouldShowPartialResult, this.#isManualUpdate);
        newSelectedAccountPortfolio.mobileInviteKey = this.#portfolio.getMobileInviteKey(this.account.addr);
        let justLoaded = false;
        // Reset the loading timestamp if the portfolio is ready
        if (this.#portfolioLoadingTimeout && newSelectedAccountPortfolio.isAllReady) {
            justLoaded = true;
            clearTimeout(this.#portfolioLoadingTimeout);
            this.#portfolioLoadingTimeout = null;
        }
        // Set the loading timestamp when the portfolio starts loading
        if (!this.#portfolioLoadingTimeout &&
            !newSelectedAccountPortfolio.isAllReady &&
            // Don't start the timeout until the user is on the dashboard
            // to avoid showing the waiting too long warning on mobile when the
            // loading has started before the user has navigated to the dashboard
            this.#ui?.views.some((v) => v.currentRoute === 'dashboard')) {
            this.#portfolioLoadingTimeout = setTimeout(() => {
                this.portfolio.shouldShowPartialResult = true;
                this.updateSelectedAccountPortfolio();
                this.#portfolioLoadingTimeout = null;
            }, 5000);
        }
        // Reset isManualUpdate flag when the portfolio has finished the initial load
        if (this.#isManualUpdate && newSelectedAccountPortfolio.isAllReady) {
            this.#isManualUpdate = false;
            this.portfolio.shouldShowPartialResult = false;
        }
        // Update the balanceByAccount only when the portfolio is ready, because
        // the user may select an account, set a balance of 0 and then switch to another account.
        // (then the balance of the first account will remain 0 until it's selected again)
        if (newSelectedAccountPortfolio.isAllReady) {
            this.balanceByAccounts[this.account.addr] = this.portfolio.totalBalance;
        }
        this.portfolio = newSelectedAccountPortfolio;
        if (newSelectedAccountPortfolio.isAllReady) {
            // since we will have survey banner that are dependant on account balance
            // we need to make sure that the banners are updated are displayed after the balance is
            // fully loaded, if the balance satisfies the banners requirements
            this.#banner?.emitUpdateBanners();
        }
        this.#updatePortfolioErrors(true);
        if (!skipUpdate) {
            this.emitUpdate({ throttleMs: justLoaded ? 0 : PORTFOLIO_UPDATE_THROTTLE_MS });
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
                    level: 'silent',
                    message: `The execution of ${funcName} in SelectedAccountController failed`,
                    error
                });
            }
        }, 0);
    }
    #updatePortfolioErrors(skipUpdate) {
        if (!this.account ||
            !this.#networks ||
            !this.#providers ||
            !this.#portfolio ||
            (!this.portfolio.isAllReady && !this.portfolio.shouldShowPartialResult)) {
            this.balanceAffectingErrors = [];
            if (!skipUpdate) {
                this.emitUpdate();
            }
            return;
        }
        this.balanceAffectingErrors = [
            ...(0, errors_1.getNetworksWithErrors)({
                networks: this.#networks.networks,
                shouldShowPartialResult: this.portfolio.shouldShowPartialResult,
                selectedAccountPortfolioState: this.portfolio.portfolioState,
                isAllReady: this.portfolio.isAllReady,
                accountState: this.#accounts.accountStates[this.account.addr] || {},
                providers: this.#providers.providers,
                networksWithAssets: this.#portfolio.getNetworksWithAssets(this.account.addr)
            }),
            ...(0, errors_1.getNetworksWithDeFiPositionsErrorErrors)({
                networks: this.#networks.networks,
                portfolioState: this.portfolio.portfolioState,
                providers: this.#providers.providers,
                networksWithPositions: this.#portfolio.getNetworksWithDefiPositions(this.account.addr)
            }),
            ...(0, errors_1.getDefiAppsErrors)(this.portfolio.portfolioState)
        ].sort((a, b) => {
            const order = { error: 0, warning: 1 };
            return order[a.type] - order[b.type];
        });
        if (!skipUpdate) {
            this.emitUpdate();
        }
    }
    get deprecatedSmartAccountBanner() {
        if (!this.account || !(0, account_1.isSmartAccount)(this.account))
            return [];
        if (!this.#accounts.accountStates[this.account.addr]?.['1']?.isV2)
            return [];
        if (!this.account.creation ||
            this.account.creation.factoryAddr.toLowerCase() === AMBIRE_ACCOUNT_FACTORY_LOWERCASED)
            return [];
        return [
            {
                id: 'old-account',
                meta: {
                    accountAddr: this.account.addr
                },
                type: 'warning',
                category: 'old-account',
                title: 'Old Ambire Account',
                text: "The account you are using is an old Ambire Account that was intended for testing the extension only. Fee options aren't available on custom networks. It won't be supported in the future. Please migrate to another by creating a new smart account in the extension or contact the team for support",
                actions: []
            }
        ];
    }
    get autoLoginPolicies() {
        if (!this.account)
            return [];
        return this.#autoLogin.getAccountPolicies(this.account.addr, true);
    }
    setDashboardNetworkFilter(networkFilter) {
        this.dashboardNetworkFilter = networkFilter;
        this.emitUpdate();
    }
    removeNetworkData(chainId) {
        const stringChainId = chainId.toString();
        if (String(this.dashboardNetworkFilter) === stringChainId) {
            this.dashboardNetworkFilter = null;
        }
        this.updateSelectedAccountPortfolio();
    }
    async dismissDefiPositionsBannerForTheSelectedAccount() {
        if (!this.account)
            return;
        const defiBanner = this.banners.find((b) => b.id === banners_1.defiPositionsOnDisabledNetworksBannerId);
        if (!defiBanner)
            return;
        const action = defiBanner.actions[0]?.actionName === 'enable-networks' ? defiBanner.actions[0] : undefined;
        if (!action)
            return;
        if (!this.dismissedBannerIds[banners_1.defiPositionsOnDisabledNetworksBannerId])
            this.dismissedBannerIds[banners_1.defiPositionsOnDisabledNetworksBannerId] = [];
        action.meta.networkChainIds.forEach((chainId) => {
            if (this.dismissedBannerIds[banners_1.defiPositionsOnDisabledNetworksBannerId].includes(`${this.account.addr}-${chainId}`))
                return;
            this.dismissedBannerIds[banners_1.defiPositionsOnDisabledNetworksBannerId].push(`${this.account.addr}-${chainId}`);
        });
        await this.#storage.set('selectedAccountDismissedBannerIds', this.dismissedBannerIds);
        this.emitUpdate();
    }
    async dismissEnsExpiryBannerForTheSelectedAccount() {
        if (!this.account)
            return;
        const expiry = this.#domains?.domains[(0, ethers_1.getAddress)(this.account.addr)]?.expiry;
        if (!expiry)
            return;
        // Key the dismissal by expiry timestamp so a renewed name (new expiry) shows the banner again.
        const dismissKey = `${this.account.addr}-${expiry.expiresAt}`;
        if (!this.dismissedBannerIds[banners_1.ensExpiryBannerId])
            this.dismissedBannerIds[banners_1.ensExpiryBannerId] = [];
        if (!this.dismissedBannerIds[banners_1.ensExpiryBannerId].includes(dismissKey))
            this.dismissedBannerIds[banners_1.ensExpiryBannerId].push(dismissKey);
        await this.#storage.set('selectedAccountDismissedBannerIds', this.dismissedBannerIds);
        this.emitUpdate();
    }
    // ! IMPORTANT !
    // Banners that depend on async data from sub-controllers should be implemented
    // in the sub-controllers themselves. This is because updates in the sub-controllers
    // will not trigger emitUpdate in the MainController, therefore the banners will
    // remain the same until a subsequent update in the MainController.
    get banners() {
        if (!this.account)
            return [];
        const banners = [];
        // ENS expiry banner
        const ownDomainEntry = this.#domains?.domains[this.account.addr];
        const ensExpiry = ownDomainEntry?.expiry;
        const ensName = ownDomainEntry?.names?.ens;
        if (ensExpiry && ensName) {
            const dismissKey = `${this.account.addr}-${ensExpiry.expiresAt}`;
            const isDismissed = !!this.dismissedBannerIds[banners_1.ensExpiryBannerId]?.includes(dismissKey);
            const ensExpiryBanner = isDismissed
                ? null
                : (0, banners_1.getEnsExpiryBanner)({
                    accountAddr: this.account.addr,
                    ens: ensName,
                    expiresAt: ensExpiry.expiresAt,
                    gracePeriodEndsAt: ensExpiry.gracePeriodEndsAt
                });
            if (ensExpiryBanner)
                banners.push(ensExpiryBanner);
        }
        // DeFi positions banner
        if (this.#networks &&
            this.#portfolio &&
            this.#networks.isInitialized &&
            this.portfolio.isAllReady) {
            const defiPositionsCountOnDisabledNetworks = this.#portfolio.getDefiPositionsCountOnDisabledNetworks(this.account.addr);
            const notDismissedNetworks = this.dismissedBannerIds[banners_1.defiPositionsOnDisabledNetworksBannerId]
                ? this.#networks.allNetworks.filter((n) => !this.dismissedBannerIds[banners_1.defiPositionsOnDisabledNetworksBannerId]?.includes(`${this.account.addr}-${n.chainId}`))
                : this.#networks.allNetworks;
            banners.push(...(0, banners_1.getDefiPositionsOnDisabledNetworksForTheSelectedAccount)({
                defiPositionsCountOnDisabledNetworks,
                networks: notDismissedNetworks,
                accountAddr: this.account.addr
            }));
        }
        return banners;
    }
    toJSON() {
        return {
            ...this,
            ...super.toJSON(),
            selectedType: this.selectedType,
            banners: this.banners,
            deprecatedSmartAccountBanner: this.deprecatedSmartAccountBanner,
            autoLoginPolicies: this.autoLoginPolicies
        };
    }
}
exports.SelectedAccountController = SelectedAccountController;
//# sourceMappingURL=selectedAccount.js.map