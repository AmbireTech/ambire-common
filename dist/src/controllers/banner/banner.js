import EventEmitter from '../eventEmitter/eventEmitter';
export class BannerController extends EventEmitter {
    #banners = [];
    #dismissedBanners = [];
    #storage;
    #survey;
    #appVersion;
    #getAccountData;
    // Used for testing
    maxBannerCount = 1;
    // Holds the initial load promise, so that one can wait until it completes
    initialLoadPromise;
    constructor(storage, getAccountData, survey, appVersion, eventEmitterRegistry) {
        super(eventEmitterRegistry);
        this.#storage = storage;
        this.#survey = survey;
        this.#getAccountData = getAccountData;
        this.#appVersion = appVersion;
        this.initialLoadPromise = this.#load().finally(() => {
            this.initialLoadPromise = undefined;
        });
    }
    #getValidBanners(banners) {
        return banners.filter(({ meta, id }) => {
            if (this.#dismissedBanners.includes(id))
                return false;
            const endTime = meta && meta.endTime;
            if (!endTime)
                return true;
            const isExpired = Date.now() > endTime;
            return !isExpired;
        });
    }
    async #load() {
        const dismissedBanners = await this.#storage.get('dismissedBanners', []);
        this.#dismissedBanners = dismissedBanners || [];
        this.emitUpdate();
    }
    #notSurveyOrValidSurvey(banner, accData) {
        if (!banner.actions || !banner.actions[0])
            return true;
        let action = banner.actions[0];
        // if not survey return it
        if (action.actionName !== 'survey')
            return true;
        const { minBalanceTotal, maxBalanceTotal, minTxnsTotal, maxTxnsTotal, minAppVersion, whitelistedAddresses } = action.meta.requirements;
        // do not display surveys when there is no selected acc
        if (accData.status === 'no-selected-account')
            return false;
        if (whitelistedAddresses && !whitelistedAddresses.includes(accData.address))
            return false;
        if (!accData.hasKeys)
            return false;
        if (minBalanceTotal !== undefined &&
            (accData.totalUsdBalance < minBalanceTotal || !accData.isBalanceReady))
            return false;
        // if the portfolio is not fully loaded we should not assume this is the balance of the user
        // and we should not yet display the banner.
        // This isBalanceReady requirement is more important for the maxBalance than the minBalance
        if (maxBalanceTotal !== undefined &&
            (accData.totalUsdBalance > maxBalanceTotal || !accData.isBalanceReady))
            return false;
        if (minTxnsTotal !== undefined && accData.numberOfTransactions < minTxnsTotal)
            return false;
        if (maxTxnsTotal !== undefined && accData.numberOfTransactions > maxTxnsTotal)
            return false;
        if (minAppVersion && this.#appVersion < minAppVersion)
            return false;
        if (!this.#survey.isReady)
            return false;
        if (this.#survey.isSurveyAnswered(action.meta.surveyId))
            return false;
        return true;
    }
    /**
     * Used when account is being switched, because we might want to display
     * different banners for different accounts.
     * The first and only (Apr 2026) such case is survey banners that have
     * to be filtered depending on balance, tx count and keys for acc
     */
    emitUpdateBanners() {
        this.emitUpdate();
    }
    get bannersData() {
        // Always return one banner at a time
        const accData = this.#getAccountData();
        return {
            banners: this.#getValidBanners(this.#banners)
                .filter((b) => this.#notSurveyOrValidSurvey(b, accData))
                .slice(0, this.maxBannerCount),
            account: accData.status === 'has-selected-account' ? accData.address : null
        };
    }
    async #saveDismissedToStorage() {
        await this.#storage.set('dismissedBanners', this.#dismissedBanners);
    }
    addBanner(banner) {
        if (this.#dismissedBanners.includes(banner.id))
            return;
        this.#banners = this.#getValidBanners([
            ...this.#banners.filter((b) => b.id !== banner.id),
            banner
        ]);
        this.emitUpdate();
    }
    async dismissBanner(bannerId) {
        const bannerExists = this.#banners.some((banner) => banner.id === bannerId);
        if (this.#dismissedBanners.includes(bannerId) || !bannerExists)
            return;
        this.#dismissedBanners.push(bannerId);
        this.emitUpdate();
        await this.#saveDismissedToStorage();
    }
    toJSON() {
        return {
            ...this,
            bannersData: this.bannersData
        };
    }
}
//# sourceMappingURL=banner.js.map