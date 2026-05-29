import { Account, IAccountsController } from '../../interfaces/account';
import { IActivityController } from '../../interfaces/activity';
import { IAutoLoginController } from '../../interfaces/autoLogin';
import { Banner } from '../../interfaces/banner';
import { Dapp, IDappsController } from '../../interfaces/dapp';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { Hex } from '../../interfaces/hex';
import { ExternalSignerController, IKeystoreController } from '../../interfaces/keystore';
import { INetworksController, Network } from '../../interfaces/network';
import { IPhishingController } from '../../interfaces/phishing';
import { IPortfolioController } from '../../interfaces/portfolio';
import { IProvidersController } from '../../interfaces/provider';
import { BuildRequest, IRequestsController } from '../../interfaces/requests';
import { ISafeController } from '../../interfaces/safe';
import { ISelectedAccountController } from '../../interfaces/selectedAccount';
import { ISwapAndBridgeController } from '../../interfaces/swapAndBridge';
import { ITransactionManagerController } from '../../interfaces/transactionManager';
import { ITransferController } from '../../interfaces/transfer';
import { FocusWindowParams, IUiController, WindowProps } from '../../interfaces/ui';
import { OpenRequestWindowParams, RequestExecutionType, RequestPosition, UserRequest } from '../../interfaces/userRequest';
import { Call } from '../../libs/accountOp/types';
import EventEmitter from '../eventEmitter/eventEmitter';
import { OnBroadcastFailed, OnBroadcastSuccess } from '../signAccountOp/signAccountOp';
declare const STATUS_WRAPPED_METHODS: {
    readonly buildSwapAndBridgeUserRequest: "INITIAL";
};
/**
 * The RequestsController is responsible for building and managing different user request types (within a request window).
 * Prior to v2.66.0, all request logic resided in the MainController. To improve scalability, readability,
 * and testability, this logic was encapsulated in this dedicated controller.
 *
 * After being opened, the request window will remain visible to the user until all requests are resolved or rejected,
 * or until the user forcefully closes the window using the system close icon (X).
 * After the request window is closed all pending/unresolved requests will be removed except for the requests of type 'calls' to allow batching to an already existing ones.
 */
export declare class RequestsController extends EventEmitter implements IRequestsController {
    #private;
    userRequests: UserRequest[];
    userRequestsWaitingAccountSwitch: UserRequest[];
    requestWindow: {
        windowProps: WindowProps;
        openWindowPromise?: Promise<WindowProps>;
        focusWindowPromise?: Promise<WindowProps>;
        closeWindowPromise?: Promise<void>;
        loaded: boolean;
        pendingMessage: {
            message: string;
            options?: {
                timeout?: number;
                type?: 'error' | 'success' | 'info' | 'warning';
                sticky?: boolean;
            };
        } | null;
    };
    private shouldSimulateAccountOps;
    get currentUserRequest(): UserRequest | null;
    set currentUserRequest(val: UserRequest | null);
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    initialLoadPromise?: Promise<void>;
    constructor({ eventEmitterRegistry, relayerUrl, callRelayer, portfolio, externalSignerControllers, activity, phishing, dapps, accounts, networks, providers, selectedAccount, keystore, transfer, swapAndBridge, transactionManager, safe, ui, autoLogin, getDapp, updateSelectedAccountPortfolio, addTokensToBeLearned, onSetCurrentUserRequest, onBroadcastSuccess, onBroadcastFailed, shouldSimulateAccountOps }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        relayerUrl: string;
        callRelayer: Function;
        portfolio: IPortfolioController;
        externalSignerControllers: Partial<{
            internal: ExternalSignerController;
            trezor: ExternalSignerController;
            ledger: ExternalSignerController;
            lattice: ExternalSignerController;
        }>;
        activity: IActivityController;
        phishing: IPhishingController;
        dapps: IDappsController;
        accounts: IAccountsController;
        networks: INetworksController;
        providers: IProvidersController;
        selectedAccount: ISelectedAccountController;
        keystore: IKeystoreController;
        transfer: ITransferController;
        swapAndBridge: ISwapAndBridgeController;
        transactionManager?: ITransactionManagerController;
        ui: IUiController;
        safe: ISafeController;
        autoLogin: IAutoLoginController;
        getDapp: (id: string) => Promise<Dapp | undefined>;
        updateSelectedAccountPortfolio: (networks?: Network[]) => Promise<void>;
        addTokensToBeLearned: (tokenAddresses: string[], chainId: bigint) => void;
        onSetCurrentUserRequest: (currentUserRequest: UserRequest | null) => void;
        onBroadcastSuccess: OnBroadcastSuccess;
        onBroadcastFailed: OnBroadcastFailed;
        shouldSimulateAccountOps?: boolean;
    });
    get visibleUserRequests(): UserRequest[];
    addUserRequests(reqs: UserRequest[], { position, executionType, allowAccountSwitch, skipFocus }?: {
        position?: RequestPosition;
        executionType?: RequestExecutionType;
        allowAccountSwitch?: boolean;
        skipFocus?: boolean;
    }): Promise<void>;
    openRequestWindow(params?: OpenRequestWindowParams): Promise<void>;
    focusRequestWindow(params?: FocusWindowParams): Promise<void>;
    closeRequestWindow(): Promise<void>;
    rejectCalls({ callIds, activeRouteIds: paramActiveRouteIds, errorMessage }: {
        callIds?: Call['id'][];
        activeRouteIds?: string[];
        errorMessage?: string;
    }): Promise<void>;
    removeUserRequests(ids: UserRequest['id'][], options?: {
        shouldRemoveSwapAndBridgeRoute?: boolean;
        shouldOpenNextRequest?: boolean;
        shouldRejectSafeRequests?: boolean;
    }): Promise<void>;
    resolveUserRequest(data: any, requestId: UserRequest['id']): Promise<void>;
    rejectUserRequests(err: string, requestIds: UserRequest['id'][], options?: {
        shouldRemoveSwapAndBridgeRoute?: boolean;
        shouldOpenNextRequest?: boolean;
    }): Promise<void>;
    build({ type, params }: BuildRequest): Promise<void>;
    get banners(): Banner[];
    setCurrentUserRequestById(requestId: UserRequest['id'], params?: OpenRequestWindowParams): Promise<void>;
    setCurrentUserRequestByIndex(requestIndex: number, params?: OpenRequestWindowParams): Promise<void>;
    sendNewRequestMessage(newRequest: UserRequest, type: 'queued' | 'updated'): void;
    setWindowLoaded(): void;
    removeAccountData(address: Account['addr']): void;
    getSameNonceSafeRequests(requestId: UserRequest['id']): UserRequest[];
    setPartiallyCompleteRequest(requestId: UserRequest['id'], meta?: {
        signed?: string[];
        hash?: Hex;
    }): void;
    toJSON(): this & {
        banners: Banner[];
        visibleUserRequests: UserRequest[];
        currentUserRequest: UserRequest;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=requests.d.ts.map