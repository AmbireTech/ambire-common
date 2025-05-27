import { Account, AccountOnchainState } from '../../interfaces/account';
import { Banner } from '../../interfaces/banner';
import { DappProviderRequest } from '../../interfaces/dapp';
import { Fetch } from '../../interfaces/fetch';
import { ExternalSignerControllers, Key, KeystoreSignerType } from '../../interfaces/keystore';
import { AddNetworkRequestParams, Network } from '../../interfaces/network';
import { NotificationManager } from '../../interfaces/notification';
import { Platform } from '../../interfaces/platform';
import { RPCProvider } from '../../interfaces/provider';
import { Storage } from '../../interfaces/storage';
import { SwapAndBridgeActiveRoute } from '../../interfaces/swapAndBridge';
import { UserRequest } from '../../interfaces/userRequest';
import { WindowManager } from '../../interfaces/window';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { TokenResult } from '../../libs/portfolio/interfaces';
import { AccountPickerController } from '../accountPicker/accountPicker';
import { AccountsController } from '../accounts/accounts';
import { AccountOpAction, ActionExecutionType, ActionPosition, ActionsController } from '../actions/actions';
import { ActivityController } from '../activity/activity';
import { AddressBookController } from '../addressBook/addressBook';
import { DappsController } from '../dapps/dapps';
import { DefiPositionsController } from '../defiPositions/defiPositions';
import { DomainsController } from '../domains/domains';
import { EmailVaultController } from '../emailVault/emailVault';
import EventEmitter, { ErrorRef, Statuses } from '../eventEmitter/eventEmitter';
import { FeatureFlagsController } from '../featureFlags/featureFlags';
import { InviteController } from '../invite/invite';
import { KeystoreController } from '../keystore/keystore';
import { NetworksController } from '../networks/networks';
import { PhishingController } from '../phishing/phishing';
import { PortfolioController } from '../portfolio/portfolio';
import { ProvidersController } from '../providers/providers';
import { SelectedAccountController } from '../selectedAccount/selectedAccount';
import { SignAccountOpType } from '../signAccountOp/helper';
import { SignAccountOpController } from '../signAccountOp/signAccountOp';
import { SignMessageController } from '../signMessage/signMessage';
import { StorageController } from '../storage/storage';
import { SwapAndBridgeController } from '../swapAndBridge/swapAndBridge';
declare const STATUS_WRAPPED_METHODS: {
    readonly removeAccount: "INITIAL";
    readonly handleAccountPickerInitLedger: "INITIAL";
    readonly handleAccountPickerInitTrezor: "INITIAL";
    readonly handleAccountPickerInitLattice: "INITIAL";
    readonly importSmartAccountFromDefaultSeed: "INITIAL";
    readonly buildSwapAndBridgeUserRequest: "INITIAL";
    readonly selectAccount: "INITIAL";
    readonly signAndBroadcastAccountOp: "INITIAL";
};
type CustomStatuses = {
    signAndBroadcastAccountOp: 'INITIAL' | 'SIGNING' | 'BROADCASTING' | 'SUCCESS' | 'ERROR';
};
export declare class MainController extends EventEmitter {
    #private;
    storage: StorageController;
    fetch: Fetch;
    callRelayer: Function;
    isReady: boolean;
    featureFlags: FeatureFlagsController;
    invite: InviteController;
    keystore: KeystoreController;
    networks: NetworksController;
    providers: ProvidersController;
    accountPicker: AccountPickerController;
    portfolio: PortfolioController;
    defiPositions: DefiPositionsController;
    dapps: DappsController;
    phishing: PhishingController;
    actions: ActionsController;
    emailVault: EmailVaultController;
    signMessage: SignMessageController;
    swapAndBridge: SwapAndBridgeController;
    signAccountOp: SignAccountOpController | null;
    signAccOpInitError: string | null;
    activity: ActivityController;
    addressBook: AddressBookController;
    domains: DomainsController;
    accounts: AccountsController;
    selectedAccount: SelectedAccountController;
    userRequests: UserRequest[];
    userRequestWaitingAccountSwitch: UserRequest[];
    accountOpsToBeConfirmed: {
        [key: string]: {
            [key: string]: AccountOp;
        };
    };
    feePayerKey: Key | null;
    lastUpdate: Date;
    isOffline: boolean;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS> & CustomStatuses;
    constructor({ platform, storageAPI, fetch, relayerUrl, velcroUrl, swapApiKey, keystoreSigners, externalSignerControllers, windowManager, notificationManager }: {
        platform: Platform;
        storageAPI: Storage;
        fetch: Fetch;
        relayerUrl: string;
        velcroUrl: string;
        swapApiKey?: string;
        keystoreSigners: Partial<{
            [key in Key['type']]: KeystoreSignerType;
        }>;
        externalSignerControllers: ExternalSignerControllers;
        windowManager: WindowManager;
        notificationManager: NotificationManager;
    });
    /**
     * - Updates the selected account's account state, portfolio and defi positions
     * - Calls batchReverseLookup for all accounts
     *
     * It's not a problem to call it many times consecutively as all methods have internal
     * caching mechanisms to prevent unnecessary calls.
     */
    onPopupOpen(): void;
    lock(): void;
    selectAccount(toAccountAddr: string): Promise<void>;
    initSignAccOp(actionId: AccountOpAction['id']): null | void;
    handleSignAndBroadcastAccountOp(type: SignAccountOpType): Promise<void>;
    resolveDappBroadcast(submittedAccountOp: SubmittedAccountOp, dappHandlers: {
        promise: {
            session: {
                name: string;
                origin: string;
                icon: string;
            };
            resolve: (data: any) => void;
            reject: (data: any) => void;
        };
        txnId?: string;
    }[]): Promise<void>;
    destroySignAccOp(): void;
    traceCall(signAccountOpCtrl: SignAccountOpController): Promise<void>;
    handleSignMessage(): Promise<void>;
    handleAccountPickerInitLedger(LedgerKeyIterator: any): Promise<void>;
    handleAccountPickerInitTrezor(TrezorKeyIterator: any): Promise<void>;
    handleAccountPickerInitLattice(LatticeKeyIterator: any): Promise<void>;
    updateAccountsOpsStatuses(): Promise<{
        newestOpTimestamp: number;
    }>;
    setContractsDeployedToTrueIfDeployed(network: Network): Promise<void>;
    removeAccount(address: Account['addr']): Promise<void>;
    reloadSelectedAccount(options?: {
        forceUpdate?: boolean;
        chainId?: bigint;
    }): Promise<void>;
    updateSelectedAccountPortfolio(forceUpdate?: boolean, network?: Network, maxDataAgeMs?: number): Promise<void>;
    buildUserRequestFromDAppRequest(request: DappProviderRequest, dappPromise: {
        session: {
            name: string;
            origin: string;
            icon: string;
        };
        resolve: (data: any) => void;
        reject: (data: any) => void;
    }): Promise<void>;
    buildTransferUserRequest(amount: string, recipientAddress: string, selectedToken: TokenResult, actionExecutionType?: ActionExecutionType): Promise<void>;
    buildSwapAndBridgeUserRequest(activeRouteId?: SwapAndBridgeActiveRoute['activeRouteId']): Promise<void>;
    buildClaimWalletUserRequest(token: TokenResult): void;
    buildMintVestingUserRequest(token: TokenResult): void;
    resolveUserRequest(data: any, requestId: UserRequest['id']): void;
    rejectUserRequest(err: string, requestId: UserRequest['id']): void;
    rejectSignAccountOpCall(callId: string): void;
    removeActiveRoute(activeRouteId: SwapAndBridgeActiveRoute['activeRouteId']): void;
    addUserRequest(req: UserRequest, actionPosition?: ActionPosition, actionExecutionType?: ActionExecutionType, allowAccountSwitch?: boolean): Promise<void>;
    removeUserRequest(id: UserRequest['id'], options?: {
        shouldRemoveSwapAndBridgeRoute: boolean;
        shouldUpdateAccount?: boolean;
        shouldOpenNextRequest?: boolean;
    }): void;
    addNetwork(network: AddNetworkRequestParams): Promise<void>;
    removeNetworkData(chainId: bigint): Promise<void>;
    resolveAccountOpAction(submittedAccountOp: SubmittedAccountOp, actionId: AccountOpAction['id'], isBasicAccountBroadcastingMultiple: boolean): Promise<void>;
    rejectAccountOpAction(err: string, actionId: AccountOpAction['id'], shouldOpenNextAction: boolean): void;
    onOneClickSwapClose(): void;
    get banners(): Banner[];
    protected throwBroadcastAccountOp({ signAccountOp, message: humanReadableMessage, error: _err, accountState, isRelayer, provider, network }: {
        signAccountOp: SignAccountOpController;
        message?: string;
        error?: Error;
        accountState?: AccountOnchainState;
        isRelayer?: boolean;
        provider?: RPCProvider;
        network?: Network;
    }): void;
    get isSignRequestStillActive(): boolean;
    toJSON(): this & {
        banners: Banner[];
        isSignRequestStillActive: boolean;
        emittedErrors: ErrorRef[];
    };
}
export {};
//# sourceMappingURL=main.d.ts.map