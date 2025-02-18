import { Network } from '../../interfaces/network';
import { Storage } from '../../interfaces/storage';
import { ActiveRoute, SocketAPIQuote, SocketAPIRoute, SocketAPISendTransactionRequest, SocketAPIToken, SwapAndBridgeToToken } from '../../interfaces/swapAndBridge';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { TokenResult } from '../../libs/portfolio';
import { SocketAPI } from '../../services/socket/api';
import { ActionsController } from '../actions/actions';
import { ActivityController } from '../activity/activity';
import EventEmitter, { Statuses } from '../eventEmitter/eventEmitter';
import { InviteController } from '../invite/invite';
import { NetworksController } from '../networks/networks';
import { SelectedAccountController } from '../selectedAccount/selectedAccount';
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
    ReadyToSubmit = "ready-to-submit"
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
    sessionIds: string[];
    fromChainId: number | null;
    fromSelectedToken: TokenResult | null;
    fromAmount: string;
    fromAmountInFiat: string;
    fromAmountFieldMode: 'fiat' | 'token';
    toChainId: number | null;
    toSelectedToken: SwapAndBridgeToToken | null;
    quote: SocketAPIQuote | null;
    quoteRoutesStatuses: {
        [key: string]: {
            status: string;
        };
    };
    portfolioTokenList: TokenResult[];
    isTokenListLoading: boolean;
    errors: SwapAndBridgeErrorType[];
    routePriority: 'output' | 'time';
    constructor({ selectedAccount, networks, activity, socketAPI, storage, actions, invite }: {
        selectedAccount: SelectedAccountController;
        networks: NetworksController;
        activity: ActivityController;
        socketAPI: SocketAPI;
        storage: Storage;
        actions: ActionsController;
        invite: InviteController;
    });
    get maxFromAmount(): string;
    get maxFromAmountInFiat(): string;
    get isFormEmpty(): boolean;
    get formStatus(): SwapAndBridgeFormStatus;
    get validateFromAmount(): {
        success: boolean;
        message: string;
    };
    get activeRoutesInProgress(): ActiveRoute[];
    get activeRoutes(): ActiveRoute[];
    set activeRoutes(value: ActiveRoute[]);
    get isSwitchFromAndToTokensEnabled(): boolean;
    get shouldEnableRoutesSelection(): boolean;
    initForm(sessionId: string): Promise<void>;
    get isHealthy(): boolean | null;
    get supportedChainIds(): Network['chainId'][];
    unloadScreen(sessionId: string): void;
    addOrUpdateError(error: SwapAndBridgeErrorType): void;
    removeError(id: SwapAndBridgeErrorType['id'], shouldEmit?: boolean): void;
    updateForm(props: {
        fromAmount?: string;
        fromAmountInFiat?: string;
        fromAmountFieldMode?: 'fiat' | 'token';
        fromSelectedToken?: TokenResult | null;
        toChainId?: bigint | number;
        toSelectedToken?: SocketAPIToken | null;
        routePriority?: 'output' | 'time';
    }): void;
    resetForm(shouldEmit?: boolean): void;
    updatePortfolioTokenList(nextPortfolioTokenList: TokenResult[]): void;
    updateToTokenList(shouldReset: boolean, addressToSelect?: string): Promise<void>;
    get toTokenList(): SwapAndBridgeToToken[];
    addToTokenByAddress: (address: string) => Promise<void>;
    switchFromAndToTokens(): Promise<void>;
    updateQuote(options?: {
        skipQuoteUpdateOnSameValues?: boolean;
        skipPreviousQuoteRemoval?: boolean;
        skipStatusUpdate?: boolean;
    }): Promise<void>;
    getRouteStartUserTx(): Promise<SocketAPISendTransactionRequest | undefined>;
    getNextRouteUserTx(activeRouteId: number): Promise<SocketAPISendTransactionRequest>;
    checkForNextUserTxForActiveRoutes(): Promise<void>;
    selectRoute(route: SocketAPIRoute): void;
    addActiveRoute(activeRoute: {
        activeRouteId: SocketAPISendTransactionRequest['activeRouteId'];
        userTxIndex: SocketAPISendTransactionRequest['userTxIndex'];
    }): Promise<void>;
    updateActiveRoute(activeRouteId: SocketAPISendTransactionRequest['activeRouteId'], activeRoute?: Partial<ActiveRoute>, forceUpdateRoute?: boolean): void;
    removeActiveRoute(activeRouteId: SocketAPISendTransactionRequest['activeRouteId']): void;
    handleUpdateActiveRouteOnSubmittedAccountOpStatusUpdate(op: SubmittedAccountOp): void;
    onAccountChange(): void;
    get banners(): import("../../interfaces/banner").Banner[];
    toJSON(): this & {
        toTokenList: SwapAndBridgeToToken[];
        maxFromAmount: string;
        maxFromAmountInFiat: string;
        validateFromAmount: {
            success: boolean;
            message: string;
        };
        isFormEmpty: boolean;
        formStatus: SwapAndBridgeFormStatus;
        activeRoutesInProgress: ActiveRoute[];
        activeRoutes: ActiveRoute[];
        isSwitchFromAndToTokensEnabled: boolean;
        banners: import("../../interfaces/banner").Banner[];
        isHealthy: boolean | null;
        shouldEnableRoutesSelection: boolean;
        supportedChainIds: bigint[];
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=swapAndBridge.d.ts.map