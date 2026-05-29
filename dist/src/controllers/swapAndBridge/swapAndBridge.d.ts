import { RecurringTimeout } from '../../classes/recurringTimeout/recurringTimeout';
import { IAccountsController } from '../../interfaces/account';
import { IActivityController } from '../../interfaces/activity';
import { IDappsController } from '../../interfaces/dapp';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore';
import { INetworksController, Network } from '../../interfaces/network';
import { IPhishingController } from '../../interfaces/phishing';
import { IPortfolioController } from '../../interfaces/portfolio';
import { IProvidersController } from '../../interfaces/provider';
import { ISelectedAccountController } from '../../interfaces/selectedAccount';
import { ISignAccountOpController, SignAccountOpError } from '../../interfaces/signAccountOp';
import { IStorageController } from '../../interfaces/storage';
import { CachedTokenListKey, FromToken, ISwapAndBridgeController, SwapAndBridgeActiveRoute, SwapAndBridgeQuote, SwapAndBridgeRoute, SwapAndBridgeSendTxRequest, SwapAndBridgeToToken, SwapProvider } from '../../interfaces/swapAndBridge';
import { IUiController } from '../../interfaces/ui';
import { UserRequest } from '../../interfaces/userRequest';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { TokenResult } from '../../libs/portfolio';
import { Validation } from '../../services/validations/validate';
import EventEmitter from '../eventEmitter/eventEmitter';
import { OnBroadcastFailed, OnBroadcastSuccess, SignAccountOpController } from '../signAccountOp/signAccountOp';
type SwapAndBridgeErrorType = {
    id: 'to-token-list-fetch-failed' | 'no-routes' | 'all-routes-failed';
    title: string;
    text?: string;
    level: 'error' | 'warning';
};
export declare enum SwapAndBridgeFormStatus {
    Empty = "empty",
    Invalid = "invalid",
    FetchingRoutes = "fetching-routes",
    NoRoutesFound = "no-routes-found",
    InvalidRouteSelected = "invalid-route-selected",
    ReadyToEstimate = "ready-to-estimate",
    ReadyToSubmit = "ready-to-submit",
    Proceeded = "proceeded"
}
declare const STATUS_WRAPPED_METHODS: {
    readonly addToTokenByAddress: "INITIAL";
};
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
    quoteRoutesStatuses: {
        [key: string]: {
            status: string;
        };
    };
    portfolioTokenList: FromToken[];
    isTokenListLoading: boolean;
    errors: SwapAndBridgeErrorType[];
    routePriority: 'output' | 'time';
    hasProceeded: boolean;
    get updateQuoteInterval(): RecurringTimeout;
    get updateActiveRoutesInterval(): RecurringTimeout;
    constructor({ eventEmitterRegistry, callRelayer, accounts, keystore, portfolio, externalSignerControllers, providers, selectedAccount, networks, activity, storage, phishing, dapps, portfolioUpdate, relayerUrl, isCurrentSignAccountOpThrowingAnEstimationError, getUserRequests, getVisibleUserRequests, swapProvider, onBroadcastSuccess, onBroadcastFailed, ui }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        callRelayer: Function;
        accounts: IAccountsController;
        keystore: IKeystoreController;
        portfolio: IPortfolioController;
        externalSignerControllers: ExternalSignerControllers;
        providers: IProvidersController;
        selectedAccount: ISelectedAccountController;
        networks: INetworksController;
        activity: IActivityController;
        storage: IStorageController;
        phishing: IPhishingController;
        dapps: IDappsController;
        relayerUrl: string;
        portfolioUpdate?: (chainsToUpdate: Network['chainId'][]) => void;
        isCurrentSignAccountOpThrowingAnEstimationError?: Function;
        getUserRequests: () => UserRequest[];
        getVisibleUserRequests: () => UserRequest[];
        swapProvider: SwapProvider;
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
    get formStatus(): SwapAndBridgeFormStatus;
    get validateFromAmount(): Validation;
    get activeRoutesInProgress(): SwapAndBridgeActiveRoute[];
    get activeRoutes(): SwapAndBridgeActiveRoute[];
    set activeRoutes(value: SwapAndBridgeActiveRoute[]);
    get shouldEnableRoutesSelection(): boolean;
    initForm(sessionId: string, params?: {
        preselectedFromToken?: Pick<TokenResult, 'address' | 'chainId'>;
        preselectedToToken?: Pick<TokenResult, 'address' | 'chainId'>;
        fromAmount?: string;
        activeRouteIdToDelete?: SwapAndBridgeSendTxRequest['activeRouteId'];
    }): Promise<void>;
    get isHealthy(): boolean;
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
    }, updateProps?: {
        emitUpdate?: boolean;
        updateQuote?: boolean;
        shouldIncrementFromAmountUpdateCounter?: boolean;
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
     * Returns the short list of tokens for the "to" token list, because the full
     * list (stored in #toTokenList) could be HUGE, causing the controller to be
     * HUGE as well, that leads to performance problems.
     */
    get toTokenShortList(): SwapAndBridgeToToken[];
    get updateToTokenListStatus(): "INITIAL" | "LOADING";
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
    recordBridgeActivity(txnId: string, activeRoute: SwapAndBridgeActiveRoute, status: 'completed' | 'refunded'): Promise<void>;
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
        updateToTokenListStatus: "INITIAL" | "LOADING";
        maxFromAmount: string;
        validateFromAmount: Validation;
        isFormEmpty: boolean;
        formStatus: SwapAndBridgeFormStatus;
        activeRoutesInProgress: SwapAndBridgeActiveRoute[];
        activeRoutes: SwapAndBridgeActiveRoute[];
        isHealthy: boolean;
        shouldEnableRoutesSelection: boolean;
        supportedChainIds: bigint[];
        swapSignErrors: SignAccountOpError[];
        signAccountOpController: ISignAccountOpController;
        banners: import("../../interfaces/banner").Banner[];
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=swapAndBridge.d.ts.map