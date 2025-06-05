import { ExternalSignerControllers } from '../../interfaces/keystore';
import { Network } from '../../interfaces/network';
import { SignAccountOpError } from '../../interfaces/signAccountOp';
import { FromToken, SwapAndBridgeActiveRoute, SwapAndBridgeQuote, SwapAndBridgeRoute, SwapAndBridgeSendTxRequest, SwapAndBridgeToToken } from '../../interfaces/swapAndBridge';
import { UserRequest } from '../../interfaces/userRequest';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { TokenResult } from '../../libs/portfolio';
import { LiFiAPI } from '../../services/lifi/api';
import { SocketAPI } from '../../services/socket/api';
import { AccountsController } from '../accounts/accounts';
import { ActionsController } from '../actions/actions';
import { ActivityController } from '../activity/activity';
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter';
import { InviteController } from '../invite/invite';
import { KeystoreController } from '../keystore/keystore';
import { NetworksController } from '../networks/networks';
import { PortfolioController } from '../portfolio/portfolio';
import { ProvidersController } from '../providers/providers';
import { SelectedAccountController } from '../selectedAccount/selectedAccount';
import { SignAccountOpController } from '../signAccountOp/signAccountOp';
import { StorageController } from '../storage/storage';
type SwapAndBridgeErrorType = {
    id: 'to-token-list-fetch-failed';
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
export declare class SwapAndBridgeController extends EventEmitter {
    #private;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    updateQuoteStatus: 'INITIAL' | 'LOADING';
    updateToTokenListStatus: 'INITIAL' | 'LOADING';
    switchTokensStatus: 'INITIAL' | 'LOADING';
    sessionIds: string[];
    fromChainId: number | null;
    fromSelectedToken: FromToken | null;
    fromAmount: string;
    fromAmountInFiat: string;
    fromAmountFieldMode: 'fiat' | 'token';
    toChainId: number | null;
    toSelectedToken: SwapAndBridgeToToken | null;
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
    signAccountOpController: SignAccountOpController | null;
    hasProceeded: boolean;
    /**
     * Describes whether quote refetch should happen at a given interval.
     * We forbid it:
     * - when the user has chosen a custom route by himself
     */
    isAutoSelectRouteDisabled: boolean;
    constructor({ accounts, keystore, portfolio, externalSignerControllers, providers, selectedAccount, networks, activity, serviceProviderAPI, storage, actions, invite, portfolioUpdate, userRequests, relayerUrl, isMainSignAccountOpThrowingAnEstimationError }: {
        accounts: AccountsController;
        keystore: KeystoreController;
        portfolio: PortfolioController;
        externalSignerControllers: ExternalSignerControllers;
        providers: ProvidersController;
        selectedAccount: SelectedAccountController;
        networks: NetworksController;
        activity: ActivityController;
        serviceProviderAPI: SocketAPI | LiFiAPI;
        storage: StorageController;
        actions: ActionsController;
        invite: InviteController;
        userRequests: UserRequest[];
        relayerUrl: string;
        portfolioUpdate?: Function;
        isMainSignAccountOpThrowingAnEstimationError?: Function;
    });
    get maxFromAmount(): string;
    get maxFromAmountInFiat(): string;
    get isFormEmpty(): boolean;
    get formStatus(): SwapAndBridgeFormStatus;
    get validateFromAmount(): {
        success: boolean;
        message: string;
    };
    get activeRoutesInProgress(): SwapAndBridgeActiveRoute[];
    get activeRoutes(): SwapAndBridgeActiveRoute[];
    set activeRoutes(value: SwapAndBridgeActiveRoute[]);
    get shouldEnableRoutesSelection(): boolean;
    initForm(sessionId: string, params?: {
        preselectedFromToken?: Pick<TokenResult, 'address' | 'chainId'>;
    }): Promise<void>;
    get isHealthy(): boolean | null;
    get supportedChainIds(): Network['chainId'][];
    unloadScreen(sessionId: string, forceUnload?: boolean): void;
    addOrUpdateError(error: SwapAndBridgeErrorType): void;
    removeError(id: SwapAndBridgeErrorType['id'], shouldEmit?: boolean): void;
    updateForm(props: {
        fromAmount?: string;
        fromAmountInFiat?: string;
        fromAmountFieldMode?: 'fiat' | 'token';
        fromSelectedToken?: TokenResult | null;
        toChainId?: bigint | number;
        toSelectedToken?: SwapAndBridgeToToken | null;
        routePriority?: 'output' | 'time';
    }, updateProps?: {
        emitUpdate?: boolean;
        updateQuote?: boolean;
    }): Promise<void>;
    resetForm(shouldEmit?: boolean): void;
    reset(shouldEmit?: boolean): void;
    updatePortfolioTokenList(nextPortfolioTokenList: TokenResult[], params?: {
        preselectedToken?: Pick<TokenResult, 'address' | 'chainId'>;
    }): Promise<void>;
    updateToTokenList(shouldReset: boolean, addressToSelect?: string): Promise<void>;
    get toTokenList(): SwapAndBridgeToToken[];
    addToTokenByAddress: (address: string) => Promise<void>;
    switchFromAndToTokens(): Promise<void>;
    updateQuote(options?: {
        skipQuoteUpdateOnSameValues?: boolean;
        skipPreviousQuoteRemoval?: boolean;
        skipStatusUpdate?: boolean;
        debounce?: boolean;
    }): Promise<void>;
    getRouteStartUserTx(shouldThrowOnError?: boolean): Promise<SwapAndBridgeSendTxRequest | null>;
    getNextRouteUserTx({ activeRouteId, activeRoute: { route } }: {
        activeRouteId: SwapAndBridgeActiveRoute['activeRouteId'];
        activeRoute: SwapAndBridgeActiveRoute;
    }): Promise<SwapAndBridgeSendTxRequest>;
    checkForNextUserTxForActiveRoutes(): Promise<void>;
    selectRoute(route: SwapAndBridgeRoute, isAutoSelectDisabled?: boolean): Promise<void>;
    addActiveRoute({ activeRouteId, userTxIndex }: {
        activeRouteId: SwapAndBridgeActiveRoute['activeRouteId'];
        userTxIndex: SwapAndBridgeSendTxRequest['userTxIndex'];
    }): Promise<void>;
    updateActiveRoute(activeRouteId: SwapAndBridgeActiveRoute['activeRouteId'], activeRoute?: Partial<SwapAndBridgeActiveRoute>, forceUpdateRoute?: boolean): void;
    removeActiveRoute(activeRouteId: SwapAndBridgeSendTxRequest['activeRouteId']): void;
    /**
     * Find the next route in line and try to re-estimate with it
     */
    onEstimationFailure(): Promise<void>;
    markSelectedRouteAsFailed(): Promise<void>;
    handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(op: SubmittedAccountOp): void;
    get banners(): import("../../interfaces/banner").Banner[];
    destroySignAccountOp(): void;
    initSignAccountOpIfNeeded(): Promise<void>;
    /**
     * Reestimate the signAccountOp request periodically.
     * Encapsulate it here instead of creating an interval in the background
     * as intervals are tricky and harder to control
     */
    reestimate(userTxn: SwapAndBridgeSendTxRequest): Promise<void>;
    setUserProceeded(hasProceeded: boolean): void;
    setIsAutoSelectRouteDisabled(isDisabled: boolean): void;
    get swapSignErrors(): SignAccountOpError[];
    toJSON(): this & {
        toTokenList: SwapAndBridgeToToken[];
        maxFromAmount: string;
        validateFromAmount: {
            success: boolean;
            message: string;
        };
        isFormEmpty: boolean;
        formStatus: SwapAndBridgeFormStatus;
        activeRoutesInProgress: SwapAndBridgeActiveRoute[];
        activeRoutes: SwapAndBridgeActiveRoute[];
        banners: import("../../interfaces/banner").Banner[];
        isHealthy: boolean | null;
        shouldEnableRoutesSelection: boolean;
        supportedChainIds: bigint[];
        swapSignErrors: SignAccountOpError[];
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=swapAndBridge.d.ts.map