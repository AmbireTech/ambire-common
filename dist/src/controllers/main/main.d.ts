import { FeatureFlags } from '@/consts/featureFlags';
import { ContinuousUpdatesController } from '@/controllers/continuousUpdates/continuousUpdates';
import EventEmitter from '@/controllers/eventEmitter/eventEmitter';
import { SignAccountOpType } from '@/controllers/signAccountOp/helper';
import { OnboardingSuccessProps } from '@/controllers/signAccountOp/signAccountOp';
import { Account, IAccountsController } from '@/interfaces/account';
import { IAccountPickerController } from '@/interfaces/accountPicker';
import { IActivityController } from '@/interfaces/activity';
import { IAddressBookController } from '@/interfaces/addressBook';
import { IAutoLoginController } from '@/interfaces/autoLogin';
import { IBannerController } from '@/interfaces/banner';
import { IContractInfoController } from '@/interfaces/contractInfo';
import { IContractNamesController } from '@/interfaces/contractNames';
import { IDappsController } from '@/interfaces/dapp';
import { IDomainsController } from '@/interfaces/domains';
import { IEmailVaultController } from '@/interfaces/emailVault';
import { ErrorRef, IEventEmitterRegistryController, Statuses } from '@/interfaces/eventEmitter';
import { IFeatureFlagsController } from '@/interfaces/featureFlags';
import { Fetch } from '@/interfaces/fetch';
import { IInviteController } from '@/interfaces/invite';
import { ExternalSignerControllers, IKeystoreController, Key, KeystoreSignerType } from '@/interfaces/keystore';
import { IMainController, STATUS_WRAPPED_METHODS } from '@/interfaces/main';
import { AddNetworkRequestParams, INetworksController, Network } from '@/interfaces/network';
import { IPhishingController } from '@/interfaces/phishing';
import { Platform } from '@/interfaces/platform';
import { IPortfolioController } from '@/interfaces/portfolio';
import { IProvidersController } from '@/interfaces/provider';
import { IRequestsController } from '@/interfaces/requests';
import { ISafeController } from '@/interfaces/safe';
import { ISelectedAccountController } from '@/interfaces/selectedAccount';
import { ISignMessageController } from '@/interfaces/signMessage';
import { IStorageController, Storage } from '@/interfaces/storage';
import { ISurveyController } from '@/interfaces/survey';
import { ISwapAndBridgeController, SwapAndBridgeActiveRoute } from '@/interfaces/swapAndBridge';
import { ITransactionManagerController } from '@/interfaces/transactionManager';
import { ITransferController } from '@/interfaces/transfer';
import { ITransfersScannerController } from '@/interfaces/transferScanner';
import { IUiController, UiManager } from '@/interfaces/ui';
import { CallsUserRequest } from '@/interfaces/userRequest';
import { AccountOp } from '@/libs/accountOp/accountOp';
import { SubmittedAccountOp } from '@/libs/accountOp/submittedAccountOp';
export declare class MainController extends EventEmitter implements IMainController {
    #private;
    fetch: Fetch;
    initialLoadPromise?: Promise<void>;
    callRelayer: Function;
    isReady: boolean;
    storage: IStorageController;
    featureFlags: IFeatureFlagsController;
    invite: IInviteController;
    keystore: IKeystoreController;
    networks: INetworksController;
    providers: IProvidersController;
    accountPicker: IAccountPickerController;
    portfolio: IPortfolioController;
    dapps: IDappsController;
    phishing: IPhishingController;
    emailVault?: IEmailVaultController;
    signMessage: ISignMessageController;
    swapAndBridge: ISwapAndBridgeController;
    transactionManager?: ITransactionManagerController;
    transfer: ITransferController;
    signAccOpInitError: string | null;
    activity: IActivityController;
    transferScanner: ITransfersScannerController;
    addressBook: IAddressBookController;
    domains: IDomainsController;
    contractNames: IContractNamesController;
    contractInfo: IContractInfoController;
    autoLogin: IAutoLoginController;
    accounts: IAccountsController;
    selectedAccount: ISelectedAccountController;
    requests: IRequestsController;
    banner: IBannerController;
    survey: ISurveyController;
    accountOpsToBeConfirmed: {
        [key: string]: {
            [key: string]: AccountOp;
        };
    };
    lastUpdate: Date;
    isOffline: boolean;
    statuses: Statuses<keyof typeof STATUS_WRAPPED_METHODS>;
    ui: IUiController;
    safe: ISafeController;
    get continuousUpdates(): ContinuousUpdatesController;
    constructor({ eventEmitterRegistry, appVersion, platform, storageAPI, fetch, relayerUrl, velcroUrl, liFiApiKey, bungeeApiKey, squidIntegratorId, featureFlags, keystoreSigners, externalSignerControllers, uiManager }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        appVersion: string;
        platform: Platform;
        storageAPI: Storage;
        fetch: Fetch;
        relayerUrl: string;
        velcroUrl: string;
        liFiApiKey: string;
        bungeeApiKey: string;
        squidIntegratorId: string;
        featureFlags: Partial<FeatureFlags>;
        keystoreSigners: Partial<{
            [key in Key['type']]: KeystoreSignerType;
        }>;
        externalSignerControllers: ExternalSignerControllers;
        uiManager: UiManager;
    });
    /**
     * - Updates the selected account's account state, portfolio and defi positions
     * - Calls batchReverseLookup for all accounts
     *
     * It's not a problem to call it many times consecutively as all methods have internal
     * caching mechanisms to prevent unnecessary calls.
     */
    onPopupOpen(viewId: string): Promise<void>;
    lock(): void;
    selectAccount(toAccountAddr: string): Promise<void>;
    commonHandlerForBroadcastSuccess({ submittedAccountOp, accountOp, fromRequestId }: OnboardingSuccessProps): Promise<void>;
    handleSignAndBroadcastAccountOp(type: SignAccountOpType, fromRequestId: string | number): Promise<void>;
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
    handleSignMessage(): Promise<void>;
    handleAccountPickerInitLedger(LedgerKeyIterator: any): Promise<void>;
    handleAccountPickerInitTrezor(TrezorKeyIterator: any): Promise<void>;
    handleAccountPickerInitLattice(LatticeKeyIterator: any): Promise<void>;
    handleAccountPickerInitQr(QrKeyIterator: any, // TODO: KeyIterator type mismatch
    payload: string | Uint8Array): Promise<void>;
    updateAccountsOpsStatuses(): Promise<void>;
    setContractsDeployedToTrueIfDeployed(network: Network): Promise<void>;
    removeAccount(address: Account['addr']): Promise<void>;
    reloadSelectedAccount(options?: {
        chainIds?: bigint[];
        maxDataAgeMs?: number;
        defiMaxDataAgeMs?: number;
        maxDataAgeMsUnused?: number;
        isManualReload?: boolean;
    }): Promise<void>;
    /**
     * Fetch Safe txns from Safe Global and make them user requests
     * if the selected account is a safe
     */
    fetchSafeTxns(chainIds?: bigint[], forceRefetch?: boolean): Promise<void>;
    updateSelectedAccountPortfolio(opts?: {
        networks?: Network[];
        isManualUpdate?: boolean;
        defiMaxDataAgeMs?: number;
        maxDataAgeMs?: number;
        maxDataAgeMsUnused?: number;
    }): Promise<void>;
    removeActiveRoute(activeRouteId: SwapAndBridgeActiveRoute['activeRouteId']): Promise<void>;
    addNetwork(network: AddNetworkRequestParams): Promise<void>;
    removeNetworkData(chainId: bigint): void;
    resolveAccountOpRequest(submittedAccountOp: SubmittedAccountOp, requestId: CallsUserRequest['id'], openBenzin?: boolean): Promise<void>;
    onOneClickSwapClose(): void;
    onOneClickTransferClose(): void;
    accountPickerSetInitParamsFromPrivateKeyOrSeedPhrase({ privKeyOrSeed, seedPassphrase }: {
        privKeyOrSeed: string;
        seedPassphrase?: string | null;
    }): Promise<void>;
    toJSON(): this & {
        name: string;
        emittedErrors: ErrorRef[];
    };
}
//# sourceMappingURL=main.d.ts.map