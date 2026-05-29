import { ExtendedAddressState } from '../../interfaces/interop';
import { Network } from '../../interfaces/network';
import { FromToken, SwapAndBridgeActiveRoute, SwapAndBridgeQuote, SwapAndBridgeToToken } from '../../interfaces/swapAndBridge';
import { TokenResult } from '../../libs/portfolio';
import EventEmitter from '../eventEmitter/eventEmitter';
import { ControllersTransactionDependencies } from './dependencies';
type SwapAndBridgeErrorType = {
    id: 'to-token-list-fetch-failed';
    title: string;
    text?: string;
    level: 'error' | 'warning';
};
export declare class TransactionFormState extends EventEmitter {
    #private;
    private readonly dependencies;
    sessionIds: string[];
    fromAmount: string;
    fromAmountInFiat: string;
    fromAmountFieldMode: 'fiat' | 'token';
    toAmount: string;
    toAmountInFiat: string;
    toAmountFieldMode: 'fiat' | 'token';
    fromChainId: number | null;
    toChainId: number | null;
    addressState: ExtendedAddressState;
    isRecipientAddressUnknown: boolean;
    isRecipientAddressUnknownAgreed: boolean;
    isRecipientHumanizerKnownTokenOrSmartContract: boolean;
    fromSelectedToken: FromToken | null;
    toSelectedToken: SwapAndBridgeToToken | null;
    portfolioTokenList: FromToken[];
    routePriority: 'output' | 'time';
    quote: SwapAndBridgeQuote | null;
    quoteRoutesStatuses: {
        [key: string]: {
            status: string;
        };
    };
    activeRoutes: SwapAndBridgeActiveRoute[];
    updateToTokenListStatus: 'INITIAL' | 'LOADING';
    switchTokensStatus: 'INITIAL' | 'LOADING';
    errors: SwapAndBridgeErrorType[];
    isTokenListLoading: boolean;
    supportedChainIds: Network['chainId'][];
    constructor(dependencies: ControllersTransactionDependencies);
    update(params: any, updateProps?: {
        emitUpdate?: boolean;
        updateQuote?: boolean;
    }): Promise<void>;
    unloadScreen(sessionId: string, forceUnload?: boolean): void;
    checkIsRecipientAddressUnknown(): void;
    updateToTokenList(shouldReset: boolean, addressToSelect?: string): Promise<void>;
    switchFromAndToTokens(): Promise<void>;
    addOrUpdateError(error: SwapAndBridgeErrorType): void;
    removeError(id: SwapAndBridgeErrorType['id'], shouldEmit?: boolean): void;
    resetForm(shouldEmit?: boolean): void;
    reset(shouldEmit?: boolean): void;
    initForm(sessionId: string): Promise<void>;
    updatePortfolioTokenList(nextPortfolioTokenList: TokenResult[]): Promise<void>;
    updateActiveRoute(activeRouteId: SwapAndBridgeActiveRoute['activeRouteId'], activeRoute?: Partial<SwapAndBridgeActiveRoute>, forceUpdateRoute?: boolean): void;
    get isInitialized(): boolean;
    get validationFormMsgs(): {
        amount: {
            severity: string;
            message: string;
        };
        recipientAddress: {
            severity: string;
            message: string;
        };
    };
    get recipientAddress(): string;
    get maxFromAmount(): string;
    get isFormEmpty(): boolean;
    get state(): {
        fromChainId: number;
        fromSelectedToken: FromToken;
        toChainId: number;
        toSelectedToken: SwapAndBridgeToToken;
        fromAmount: string;
        fromAmountInFiat: string;
        fromAmountFieldMode: "token" | "fiat";
        toAmount: string;
        toAmountInFiat: string;
        toAmountFieldMode: "token" | "fiat";
        addressState: ExtendedAddressState;
    };
    toJSON(): this & {
        name: string;
        supportedChainIds: bigint[];
        maxFromAmount: string;
        recipientAddress: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=transactionFormState.d.ts.map