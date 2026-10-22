import { BindedRelayerCall } from '../../libs/relayerCall/relayerCall';
import { SwapAndBridgeFormStatus } from '../../libs/swapAndBridge/constants';
import { RecurringTimeout } from '../../classes/recurringTimeout/recurringTimeout';
import { IAccountsController } from '../../interfaces/account';
import { IActivityController } from '../../interfaces/activity';
import { IContractInfoController } from '../../interfaces/contractInfo';
import { IDappsController } from '../../interfaces/dapp';
import { IErc7730Controller } from '../../interfaces/erc7730';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Fetch } from '../../interfaces/fetch';
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore';
import { INetworksController, Network } from '../../interfaces/network';
import { IPhishingController } from '../../interfaces/phishing';
import { Platform } from '../../interfaces/platform';
import { IPortfolioController } from '../../interfaces/portfolio';
import { IProvidersController } from '../../interfaces/provider';
import { ISelectedAccountController } from '../../interfaces/selectedAccount';
import { ISignAccountOpController, SignAccountOpError } from '../../interfaces/signAccountOp';
import { IStorageController } from '../../interfaces/storage';
import { CachedTokenListKey, FromToken, ISwapAndBridgeController, SwapAndBridgeActiveRoute, SwapAndBridgeQuote, SwapAndBridgeRoute, SwapAndBridgeSendTxRequest, SwapAndBridgeToToken, SwapProviderExecutor, SwapProviderInfo, ToTokenMarketDataByToken } from '../../interfaces/swapAndBridge';
import { IUiController } from '../../interfaces/ui';
import { UserRequest } from '../../interfaces/userRequest';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { TokenResult } from '../../libs/portfolio';
import { Validation } from '../../services/validations/validate';
import EventEmitter from '../eventEmitter/eventEmitter';
import { OnBroadcastFailed, OnBroadcastSuccess, SignAccountOpController } from '../signAccountOp/signAccountOp';
import { SignAccountOpPreferenceController } from '../signAccountOp/signAccountOpPreference';
import type { FeeExemptionReason } from '../../libs/swapAndBridge/fee';
type SwapAndBridgeErrorType = {
    id: 'to-token-list-fetch-failed' | 'no-routes' | 'all-routes-failed';
    title: string;
    text?: string;
    level: 'error' | 'warning';
};
declare const STATUS_WRAPPED_METHODS: {
    readonly addToTokenByAddress: "INITIAL";
};
export declare const sortSwapAndBridgeRoutes: (r1: SwapAndBridgeRoute, r2: SwapAndBridgeRoute, outputTokenPriceUSD?: number | null) => 0 | 1 | -1;
type SignAccountOpControllerMethods = {
    [K in keyof SignAccountOpController as SignAccountOpController[K] extends (...args: any) => any ? K : never]: SignAccountOpController[K];
};
/**
 * The Swap and Bridge controller is responsible for managing the state and
 * logic related to swapping and bridging tokens across different networks.
 * Key responsibilities:
 *  - Initially setting up the swap and bridge form with the necessary data.
 *  - Managing form state for token swap and bridge operations (including user preferences).
 *  - Fetching and updating token lists (from and to).
 *  - Fetching and updating quotes for token swaps and bridges.
 *  - Manages token active routes
 */
export declare class SwapAndBridgeController extends EventEmitter implements ISwapAndBridgeController {
    #private;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    updateQuoteStatus: 'INITIAL' | 'LOADING';
    switchTokensStatus: 'INITIAL' | 'LOADING';
    sessionIds: string[];
    fromChainId: number | null;
    fromSelectedToken: FromToken | null;
    fromAmount: string;
    fromAmountInFiat: string;
    /**
     * A counter used to trigger UI updates when the amount is changed programmatically
     * by the controller.
     */
    fromAmountUpdateCounter: number;
    fromAmountFieldMode: 'fiat' | 'token';
    toChainId: number | null;
    toSelectedToken: SwapAndBridgeToToken | null;
    toTokenSearchTerm: string;
    toTokenSearchResults: SwapAndBridgeToToken[];
    quote: SwapAndBridgeQuote | null;
    feePercent: number;
    quoteRoutesStatuses: {
        [key: string]: {
            status: string;
        };
    };
    portfolioTokenList: FromToken[];
    isTokenListLoading: boolean;
    errors: SwapAndBridgeErrorType[];
    routePriority: 'output' | 'time';
    disabledSwapProviderIds: string[];
    hasProceeded: boolean;
    get updateQuoteInterval(): RecurringTimeout;
    get updateActiveRoutesInterval(): RecurringTimeout;
    constructor({ eventEmitterRegistry, callRelayer, fetch, accounts, keystore, portfolio, externalSignerControllers, providers, selectedAccount, networks, activity, storage, signAccountOpPreference, featureFlags, platform, phishing, dapps, erc7730, contractInfo, portfolioUpdate, relayerUrl, isCurrentSignAccountOpThrowingAnEstimationError, getUserRequests, getVisibleUserRequests, swapProvider, onBroadcastSuccess, onBroadcastFailed, ui }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        callRelayer: BindedRelayerCall;
        fetch: Fetch;
        accounts: IAccountsController;
        keystore: IKeystoreController;
        portfolio: IPortfolioController;
        externalSignerControllers: ExternalSignerControllers;
        providers: IProvidersController;
        selectedAccount: ISelectedAccountController;
        networks: INetworksController;
        activity: IActivityController;
        storage: IStorageController;
        signAccountOpPreference: SignAccountOpPreferenceController;
        featureFlags: IFeatureFlagsController;
        platform: Platform;
        phishing: IPhishingController;
        dapps: IDappsController;
        erc7730: IErc7730Controller;
        contractInfo: IContractInfoController;
        relayerUrl: string;
        portfolioUpdate?: (chainsToUpdate: Network['chainId'][]) => void;
        isCurrentSignAccountOpThrowingAnEstimationError?: Function;
        getUserRequests: () => UserRequest[];
        getVisibleUserRequests: () => UserRequest[];
        swapProvider: SwapProviderExecutor;
        onBroadcastSuccess: OnBroadcastSuccess;
        onBroadcastFailed: OnBroadcastFailed;
        ui: IUiController;
    });
    get maxFromAmount(): string;
    get maxFromAmountInFiat(): string;
    get isFormEmpty(): boolean;
    /**
     * Returns an instance of the SignAccountOpController that is ALWAYS up-to-date with the current
     * quote and the current form state.
     */
    get signAccountOpController(): ISignAccountOpController;
    /**
     * Whether the swap is being signed or broadcast right now, e.g. waiting for a hardware wallet.
     * Reads the private controller on purpose, as the public getter may return null for it.
     */
    get isSignAndBroadcastInProgress(): boolean;
    get formStatus(): SwapAndBridgeFormStatus;
    get validateFromAmount(): Validation;
    get activeRoutesInProgress(): SwapAndBridgeActiveRoute[];
    get activeRoutes(): SwapAndBridgeActiveRoute[];
    set activeRoutes(value: SwapAndBridgeActiveRoute[]);
    get shouldEnableRoutesSelection(): boolean;
    /** Why the currently selected operation is exempt from the Swap & Bridge fee. */
    get feeExemptionReason(): FeeExemptionReason | undefined;
    initForm(sessionId: string, params?: {
        preselectedFromToken?: Pick<TokenResult, 'address' | 'chainId'>;
        preselectedToToken?: Pick<TokenResult, 'address' | 'chainId'>;
        fromAmount?: string;
        activeRouteIdToDelete?: SwapAndBridgeSendTxRequest['activeRouteId'];
    }): Promise<void>;
    get isHealthy(): boolean;
    /** Returns serializable metadata for all available swap providers. */
    get swapProviders(): SwapProviderInfo[];
    /** Returns a copy of the provider ids the user has switched off. */
    getDisabledSwapProviderIds(): string[];
    /** Enables or disables a provider for future route and supported-chain discovery. */
    setSwapProviderEnabled(providerId: string, isEnabled: boolean): Promise<void>;
    /** Restricts routes to CoW Swap or restores all available swap providers. */
    setMevProtectionEnabled(isEnabled: boolean): Promise<void>;
    /**
     * Replaces the providers the user has switched off (used by app data sync). Ids of
     * providers this product does not offer are dropped.
     */
    setDisabledSwapProviderIds(disabledSwapProviderIds: string[]): Promise<void>;
    get supportedChainIds(): Network['chainId'][];
    static getToTokenListKey(fromChainId: number | null, toChainId: number | null): CachedTokenListKey | null;
    unloadScreen(sessionId: string, forceUnload?: boolean): void;
    addOrUpdateError(error: SwapAndBridgeErrorType): void;
    removeError(id: SwapAndBridgeErrorType['id'], shouldEmit?: boolean): void;
    updateForm(props: {
        fromAmount?: string;
        fromAmountInFiat?: string;
        shouldSetMaxAmount?: boolean;
        fromAmountFieldMode?: 'fiat' | 'token';
        fromSelectedToken?: TokenResult | null;
        toChainId?: bigint | number;
        toSelectedTokenAddr?: SwapAndBridgeToToken['address'] | null;
        routePriority?: 'output' | 'time';
        activeRouteIdToDelete?: SwapAndBridgeSendTxRequest['activeRouteId'];
    }, updateProps?: {
        emitUpdate?: boolean;
        updateQuote?: boolean;
        shouldIncrementFromAmountUpdateCounter?: boolean;
        /**
         * Set it when the user changes the "to" token or network from the UI, so a "to" token
         * preselected from outside Swap & Bridge stops being restored on "from" network changes.
         */
        isToSelectionByUser?: boolean;
    }): Promise<void>;
    resetForm(shouldEmit?: boolean): void;
    reset(shouldEmit?: boolean): void;
    updatePortfolioTokenList(nextPortfolioTokenList: TokenResult[], params?: {
        preselectedToken?: Pick<TokenResult, 'address' | 'chainId'>;
        preselectedToToken?: Pick<TokenResult, 'address' | 'chainId'>;
        fromAmount?: string;
    }): Promise<void>;
    updateToTokenList(shouldReset: boolean, addressToSelect?: string): Promise<void>;
    /**
     * The market data of the currently visible "to" tokens only, because the whole
     * `#toTokenMarketData` is far too large to be sent to the UI on every update.
     * Records that went stale are reported as loading - they are hidden until the
     * refresh triggered alongside this list completes, so that the UI never displays
     * an outdated exchange list.
     */
    get toTokenMarketData(): ToTokenMarketDataByToken;
    /**
     * Returns the short list of tokens for the "to" token list, because the full
     * list (stored in #toTokenList) could be HUGE, causing the controller to be
     * HUGE as well, that leads to performance problems.
     */
    get toTokenShortList(): SwapAndBridgeToToken[];
    get updateToTokenListStatus(): "INITIAL" | "LOADING";
    /** Providers that haven't returned their tokens for the current "to" list yet. */
    get toTokenListLoadingProviderNames(): string[];
    /** Whether a requested "to" token (e.g. a trending one) is waiting for its list. */
    get isToTokenSelectionPending(): boolean;
    addToTokenByAddress: (address: string) => Promise<void>;
    searchToToken(searchTerm: string): Promise<void>;
    switchFromAndToTokens(): Promise<void>;
    updateQuote(options?: {
        skipQuoteUpdateOnSameValues?: boolean;
        skipPreviousQuoteRemoval?: boolean;
        skipStatusUpdate?: boolean;
        debounce?: boolean;
    }): Promise<void>;
    getRouteStartUserTx(): Promise<((SwapAndBridgeSendTxRequest & {
        success: true;
    }) | (SwapAndBridgeErrorType & {
        success: false;
    })) | null>;
    recordIntentActivity(txnId: string, activeRoute: SwapAndBridgeActiveRoute, status: 'completed' | 'refunded'): Promise<void>;
    checkForActiveRoutesStatusUpdate(): Promise<void>;
    selectRoute(route: SwapAndBridgeRoute, opts?: {
        isManualSelection?: boolean;
    }): Promise<void>;
    addActiveRoute({ userTxIndex, quote, routeStatus }: {
        userTxIndex: SwapAndBridgeSendTxRequest['userTxIndex'];
        quote?: SwapAndBridgeQuote;
        routeStatus?: 'waiting-approval-to-resolve' | 'in-progress' | 'ready' | 'completed' | 'failed' | 'refunded';
    }): void;
    updateActiveRoute(activeRouteId: SwapAndBridgeActiveRoute['activeRouteId'], activeRoute?: Partial<SwapAndBridgeActiveRoute>, forceUpdateRoute?: boolean): void;
    removeActiveRoute(activeRouteId: SwapAndBridgeSendTxRequest['activeRouteId'], shouldEmitUpdate?: boolean): void;
    /**
     * Removes failed active routes and hides the failed txn banner
     */
    removeFailedRouteAndHideBanner(activeRouteId: SwapAndBridgeSendTxRequest['activeRouteId']): Promise<void>;
    /**
     * Find the next route in line and try to re-estimate with it
     */
    onEstimationFailure(activeRouteId?: SwapAndBridgeSendTxRequest['activeRouteId']): Promise<void>;
    /**
     * We need this as a separate method as it's called from the UI as well
     */
    markSelectedRouteAsFailed(disabledReason: string): Promise<void>;
    handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(op: SubmittedAccountOp): void;
    destroySignAccountOp(): void;
    /**
     * This method might be called multiple times due to async updates (e.g., tokens, routes, etc.).
     * The `quoteIdGuard` acts as a guard to ensure we only proceed with data that matches
     * the latest active quote in `this.#updateQuoteId`.
     *
     * If the component re-renders or receives stale async events (e.g., an old estimation result),
     * this check prevents applying outdated data to the current form state.
     *
     * ⚠️ IMPORTANT: If you make changes here and they involve async operations,
     * make sure to check `isQuoteIdObsoleteAfterAsyncOperation` afterwards
     * to ensure you’re not acting on obsolete data.
     */
    initSignAccountOpIfNeeded(quoteIdGuard: string): Promise<void>;
    callSignAccountOpMethod<M extends keyof SignAccountOpControllerMethods>(method: M, args: Parameters<SignAccountOpControllerMethods[M]>): Promise<void>;
    setUserProceeded(hasProceeded: boolean): void;
    get swapSignErrors(): SignAccountOpError[];
    get banners(): import("../../interfaces/banner").Banner[];
    continuouslyUpdateQuote(): Promise<void>;
    continuouslyUpdateActiveRoutes(): Promise<void>;
    /**
     * Unbrick mechanism.
     * Use this only when you are sure there's no way to continue, or
     * a promise waiting to resolve that might change the state
     */
    cancelSignReq(): void;
    toJSON(): this & {
        toTokenShortList: SwapAndBridgeToToken[];
        toTokenMarketData: ToTokenMarketDataByToken;
        updateToTokenListStatus: "INITIAL" | "LOADING";
        toTokenListLoadingProviderNames: string[];
        isToTokenSelectionPending: boolean;
        maxFromAmount: string;
        validateFromAmount: Validation;
        isFormEmpty: boolean;
        formStatus: SwapAndBridgeFormStatus;
        activeRoutesInProgress: SwapAndBridgeActiveRoute[];
        activeRoutes: SwapAndBridgeActiveRoute[];
        isHealthy: boolean;
        shouldEnableRoutesSelection: boolean;
        feeExemptionReason: FeeExemptionReason;
        supportedChainIds: bigint[];
        swapProviders: SwapProviderInfo[];
        swapSignErrors: SignAccountOpError[];
        signAccountOpController: ISignAccountOpController;
        banners: import("../../interfaces/banner").Banner[];
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=swapAndBridge.d.ts.map