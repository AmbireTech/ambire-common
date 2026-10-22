import { BindedRelayerCall } from '../../libs/relayerCall/relayerCall';
import { Account, IAccountsController } from '../../interfaces/account';
import { IActivityController } from '../../interfaces/activity';
import { IAutoLoginController } from '../../interfaces/autoLogin';
import { Banner } from '../../interfaces/banner';
import { IContractInfoController } from '../../interfaces/contractInfo';
import { Dapp, IDappsController } from '../../interfaces/dapp';
import { IErc7730Controller } from '../../interfaces/erc7730';
import { IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Hex } from '../../interfaces/hex';
import { ExternalSignerController, IKeystoreController } from '../../interfaces/keystore';
import { INetworksController, Network } from '../../interfaces/network';
import { IPhishingController } from '../../interfaces/phishing';
import { Platform } from '../../interfaces/platform';
import { IPortfolioController } from '../../interfaces/portfolio';
import { IProvidersController } from '../../interfaces/provider';
import { BuildRequest, IRequestsController } from '../../interfaces/requests';
import { ISafeController } from '../../interfaces/safe';
import { ISelectedAccountController } from '../../interfaces/selectedAccount';
import { IStorageController } from '../../interfaces/storage';
import { ISwapAndBridgeController } from '../../interfaces/swapAndBridge';
import { ITransactionManagerController } from '../../interfaces/transactionManager';
import { ITransferController } from '../../interfaces/transfer';
import { FocusWindowParams, IUiController, WindowProps } from '../../interfaces/ui';
import { OpenRequestWindowParams, RequestExecutionType, RequestPosition, UserRequest, UserRequestWaitingAccountSwitch } from '../../interfaces/userRequest';
import EventEmitter from '../eventEmitter/eventEmitter';
import { SignAccountOpPreferenceController } from '../signAccountOp/signAccountOpPreference';
import type { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import type { Call } from '../../libs/accountOp/types';
import type { OnBroadcastFailed, OnBroadcastSuccess } from '../signAccountOp/signAccountOp';
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
    userRequestsWaitingAccountSwitch: UserRequestWaitingAccountSwitch[];
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
    constructor({ eventEmitterRegistry, relayerUrl, callRelayer, portfolio, featureFlags, platform, externalSignerControllers, activity, phishing, dapps, erc7730, contractInfo, accounts, networks, providers, storage, signAccountOpPreference, selectedAccount, keystore, transfer, swapAndBridge, transactionManager, safe, ui, autoLogin, getDapp, updateSelectedAccountPortfolio, addTokensToBeLearned, onSetCurrentUserRequest, onBroadcastSuccess, onBroadcastFailed, shouldSimulateAccountOps }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        relayerUrl: string;
        callRelayer: BindedRelayerCall;
        portfolio: IPortfolioController;
        featureFlags: IFeatureFlagsController;
        platform: Platform;
        externalSignerControllers: Partial<{
            internal: ExternalSignerController;
            trezor: ExternalSignerController;
            ledger: ExternalSignerController;
            lattice: ExternalSignerController;
        }>;
        activity: IActivityController;
        phishing: IPhishingController;
        dapps: IDappsController;
        erc7730: IErc7730Controller;
        contractInfo: IContractInfoController;
        accounts: IAccountsController;
        networks: INetworksController;
        providers: IProvidersController;
        storage: IStorageController;
        signAccountOpPreference: SignAccountOpPreferenceController;
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
    /**
     * The requests that belong to the selected account, which is what the UI lists and what the
     * user can open by picking one. It includes signed Safe transactions waiting in the Safe
     * queue, so use `#autoTriggerUserRequests` to decide what the wallet opens (automatically) or keeps the
     * request window open for on its own.
     */
    get visibleUserRequests(): UserRequest[];
    addUserRequests(reqs: UserRequest[], { position, executionType, skipFocus }?: {
        position?: RequestPosition;
        executionType?: RequestExecutionType;
        skipFocus?: boolean;
    }): Promise<void>;
    openRequestWindow(params?: OpenRequestWindowParams): Promise<void>;
    focusRequestWindow(params?: FocusWindowParams): Promise<void>;
    /**
     * Closes the request view and refuses whatever was still waiting in it. Pass
     * `isUserInitiated: false` when the wallet is the one closing it (switching accounts, for
     * example) so the apps that lose their requests are not treated as having been refused.
     */
    closeRequestWindow({ isUserInitiated }?: {
        isUserInitiated?: boolean;
    }): Promise<void>;
    rejectCalls({ callIds, activeRouteIds: paramActiveRouteIds, errorMessage, isUserInitiated }: {
        callIds?: Call['id'][];
        activeRouteIds?: string[];
        errorMessage?: string;
        /**
         * Whether the user is removing the calls. False when the wallet tears them down itself,
         * such as when a swap and bridge route is cleaned up.
         */
        isUserInitiated?: boolean;
    }): Promise<void>;
    removeUserRequests(ids: UserRequest['id'][], options?: {
        shouldRemoveSwapAndBridgeRoute?: boolean;
        shouldOpenNextRequest?: boolean;
        shouldSkipSafeQueueRequests?: boolean;
    }): Promise<void>;
    resolveUserRequest(data: any, requestId: UserRequest['id']): Promise<void>;
    /**
     * What the user can do about the app behind the open request, beyond refusing it: how many
     * of its requests are queued, and whether it has been refused enough to be worth silencing.
     * Null when the request didn't come from an app.
     */
    get currentRequestRejectOptions(): {
        dappRequestsCount: number;
        canSilenceDapp: boolean;
    } | null;
    /**
     * Clears everything the app behind the open request is waiting on, and optionally ignores
     * whatever it sends for the next minute. A transaction batch that also holds calls from
     * another app keeps those - only this app's are dropped.
     */
    rejectAllRequestsFromCurrentDapp(err: string, { shouldSilenceDapp }?: {
        shouldSilenceDapp?: boolean;
    }): Promise<void>;
    rejectUserRequests(err: string, requestIds: UserRequest['id'][], options?: {
        shouldRemoveSwapAndBridgeRoute?: boolean;
        shouldOpenNextRequest?: boolean;
        /**
         * Whether the user is the one refusing, which is what counts against the app as spam.
         * On by default because nearly every caller is a Reject button. Pass false wherever the
         * wallet rejects on its own behalf - those must never make a legitimate app look hostile.
         */
        isUserInitiated?: boolean;
    }): Promise<void>;
    /** Rejects every not-yet-signed transaction and message request of the specified Safe on the specified chain. */
    rejectSameChainNotSignedSafeRequest(accountAddr: string, chainId: bigint, errorMessage: string): Promise<void>;
    /**
     * Rejects the not-yet-signed requests of a Safe that were waiting for its deployment
     * once the deployment op is finalized without a success.
     *
     * `Failure` and `Rejected` mean the Safe was definitely not deployed. `UnknownButPastNonce`
     * (the op was replaced - by a cancel or by a speed-up that may have succeeded) and
     * `BroadcastButStuck` (no receipt in time, but it may still get mined) don't tell us that,
     * so for them the on-chain state is checked first and the requests are kept if the Safe is deployed.
     */
    handleSafeDeployStatusUpdate(op: SubmittedAccountOp): Promise<void>;
    build({ type, params }: BuildRequest): Promise<void>;
    /**
     * Builds a standalone Safe deployment request from the account's saved creation data.
     * Replies to the requesting UI so Deploy settings can show preparation failures in the
     * affected network row instead of closing without an explanation.
     */
    buildSafeDeploymentRequest(accountAddr: Account['addr'], chainId: bigint, uiRequestId?: string): Promise<boolean>;
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
        currentRequestRejectOptions: {
            dappRequestsCount: number;
            canSilenceDapp: boolean;
        };
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
export {};
//# sourceMappingURL=requests.d.ts.map