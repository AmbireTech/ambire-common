import { BUNDLER } from '../../consts/bundlers';
import { Account, AccountOnchainState } from '../../interfaces/account';
import { Banner } from '../../interfaces/banner';
import { DappProviderRequest } from '../../interfaces/dapp';
import { Fetch } from '../../interfaces/fetch';
import { ExternalSignerControllers, Key, KeystoreSignerType } from '../../interfaces/keystore';
import { AddNetworkRequestParams, Network, NetworkId } from '../../interfaces/network';
import { NotificationManager } from '../../interfaces/notification';
import { RPCProvider } from '../../interfaces/provider';
import { Storage } from '../../interfaces/storage';
import { UserRequest } from '../../interfaces/userRequest';
import { WindowManager } from '../../interfaces/window';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { EstimateResult } from '../../libs/estimate/interfaces';
import { GasRecommendation } from '../../libs/gasPrice/gasPrice';
import { TokenResult } from '../../libs/portfolio/interfaces';
import { GasSpeeds } from '../../services/bundlers/types';
import { AccountAdderController } from '../accountAdder/accountAdder';
import { AccountsController } from '../accounts/accounts';
import { AccountOpAction, ActionExecutionType, ActionPosition, ActionsController } from '../actions/actions';
import { ActivityController } from '../activity/activity';
import { AddressBookController } from '../addressBook/addressBook';
import { DappsController } from '../dapps/dapps';
import { DefiPositionsController } from '../defiPositions/defiPositions';
import { DomainsController } from '../domains/domains';
import { EmailVaultController } from '../emailVault/emailVault';
import EventEmitter, { ErrorRef, Statuses } from '../eventEmitter/eventEmitter';
import { InviteController } from '../invite/invite';
import { KeystoreController } from '../keystore/keystore';
import { NetworksController } from '../networks/networks';
import { PortfolioController } from '../portfolio/portfolio';
import { ProvidersController } from '../providers/providers';
import { SelectedAccountController } from '../selectedAccount/selectedAccount';
import { SignAccountOpController } from '../signAccountOp/signAccountOp';
import { SignMessageController } from '../signMessage/signMessage';
import { SwapAndBridgeController } from '../swapAndBridge/swapAndBridge';
declare const STATUS_WRAPPED_METHODS: {
    readonly onAccountAdderSuccess: "INITIAL";
    readonly signAccountOp: "INITIAL";
    readonly broadcastSignedAccountOp: "INITIAL";
    readonly removeAccount: "INITIAL";
    readonly handleAccountAdderInitLedger: "INITIAL";
    readonly handleAccountAdderInitLattice: "INITIAL";
    readonly importSmartAccountFromDefaultSeed: "INITIAL";
    readonly buildSwapAndBridgeUserRequest: "INITIAL";
    readonly importSmartAccountFromSavedSeed: "INITIAL";
    readonly selectAccount: "INITIAL";
};
export declare class MainController extends EventEmitter {
    #private;
    fetch: Fetch;
    callRelayer: Function;
    isReady: boolean;
    invite: InviteController;
    keystore: KeystoreController;
    networks: NetworksController;
    providers: ProvidersController;
    accountAdder: AccountAdderController;
    portfolio: PortfolioController;
    defiPositions: DefiPositionsController;
    dapps: DappsController;
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
    gasPrices: {
        [key: string]: GasRecommendation[];
    };
    bundlerGasPrices: {
        [key: string]: {
            speeds: GasSpeeds;
            bundler: BUNDLER;
        };
    };
    accountOpsToBeConfirmed: {
        [key: string]: {
            [key: string]: AccountOp;
        };
    };
    feePayerKey: Key | null;
    lastUpdate: Date;
    isOffline: boolean;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    constructor({ storage, fetch, relayerUrl, velcroUrl, socketApiKey, keystoreSigners, externalSignerControllers, windowManager, notificationManager }: {
        storage: Storage;
        fetch: Fetch;
        relayerUrl: string;
        velcroUrl: string;
        socketApiKey: string;
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
    onLoad(isFirstLoad?: boolean): void;
    lock(): void;
    selectAccount(toAccountAddr: string): Promise<void>;
    importSmartAccountFromSavedSeed(seed?: string): Promise<void>;
    initSignAccOp(actionId: AccountOpAction['id']): null | void;
    handleSignAndBroadcastAccountOp(): Promise<void>;
    destroySignAccOp(): void;
    traceCall(estimation: EstimateResult): Promise<void>;
    handleSignMessage(): Promise<void>;
    handleAccountAdderInitLedger(LedgerKeyIterator: any): Promise<void>;
    handleAccountAdderInitLattice(LatticeKeyIterator: any): Promise<void>;
    updateAccountsOpsStatuses(): Promise<{
        newestOpTimestamp: number;
    }>;
    setContractsDeployedToTrueIfDeployed(network: Network): Promise<void>;
    removeAccount(address: Account['addr']): Promise<void>;
    reloadSelectedAccount(options?: {
        forceUpdate?: boolean;
        networkId?: NetworkId;
    }): Promise<void>;
    updateSelectedAccountPortfolio(forceUpdate?: boolean, network?: Network): Promise<void>;
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
    buildSwapAndBridgeUserRequest(activeRouteId?: number): Promise<void>;
    buildClaimWalletUserRequest(token: TokenResult): void;
    buildMintVestingUserRequest(token: TokenResult): void;
    resolveUserRequest(data: any, requestId: UserRequest['id']): void;
    rejectUserRequest(err: string, requestId: UserRequest['id']): void;
    rejectSignAccountOpCall(callId: string): void;
    removeActiveRoute(activeRouteId: number): void;
    addUserRequest(req: UserRequest, actionPosition?: ActionPosition, actionExecutionType?: ActionExecutionType): Promise<void>;
    removeUserRequest(id: UserRequest['id'], options?: {
        shouldRemoveSwapAndBridgeRoute: boolean;
        shouldUpdateAccount?: boolean;
        shouldOpenNextRequest?: boolean;
    }): void;
    addEntryPointAuthorization(req: UserRequest, network: Network, accountState: AccountOnchainState, actionExecutionType?: ActionExecutionType): Promise<void>;
    addNetwork(network: AddNetworkRequestParams): Promise<void>;
    removeNetwork(id: NetworkId): Promise<void>;
    resolveAccountOpAction(data: any, actionId: AccountOpAction['id']): Promise<void>;
    rejectAccountOpAction(err: string, actionId: AccountOpAction['id'], shouldOpenNextAction: boolean): void;
    updateSignAccountOpGasPrice(): Promise<void>;
    estimateSignAccountOp(): Promise<void>;
    get banners(): Banner[];
    protected throwBroadcastAccountOp({ message: humanReadableMessage, error: _err, accountState, isRelayer, provider, network }: {
        message?: string;
        error?: Error;
        accountState?: AccountOnchainState;
        isRelayer?: boolean;
        provider?: RPCProvider;
        network?: Network;
    }): Promise<never>;
    get isSignRequestStillActive(): boolean;
    toJSON(): this & {
        banners: Banner[];
        isSignRequestStillActive: boolean;
        emittedErrors: ErrorRef[];
    };
}
export {};
//# sourceMappingURL=main.d.ts.map