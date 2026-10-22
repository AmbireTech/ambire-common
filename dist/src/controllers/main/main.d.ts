import { FeatureFlags } from '../../consts/featureFlags';
import { ContinuousUpdatesController } from '../continuousUpdates/continuousUpdates';
import EventEmitter from '../eventEmitter/eventEmitter';
import { SignAccountOpType } from '../signAccountOp/helper';
import { OnboardingSuccessProps } from '../signAccountOp/signAccountOp';
import { SignAccountOpPreferenceController } from '../signAccountOp/signAccountOpPreference';
import { Account, IAccountsController } from '../../interfaces/account';
import { IAccountPickerController } from '../../interfaces/accountPicker';
import { IActivityController } from '../../interfaces/activity';
import { IAddressBookController } from '../../interfaces/addressBook';
import { IAppDataSyncController } from '../../interfaces/appDataSync';
import { IAutoLoginController } from '../../interfaces/autoLogin';
import { IBannerController } from '../../interfaces/banner';
import { IContractInfoController } from '../../interfaces/contractInfo';
import { IContractNamesController } from '../../interfaces/contractNames';
import { IDappsController } from '../../interfaces/dapp';
import { IDebugController } from '../../interfaces/debug';
import { IDomainsController } from '../../interfaces/domains';
import { IEmailVaultController } from '../../interfaces/emailVault';
import { IErc7730Controller } from '../../interfaces/erc7730';
import { ErrorRef, IEventEmitterRegistryController, Statuses } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Fetch } from '../../interfaces/fetch';
import { IInviteController } from '../../interfaces/invite';
import { ExternalSignerControllers, IKeystoreController, Key, KeystoreSignerType } from '../../interfaces/keystore';
import { IMainController, STATUS_WRAPPED_METHODS } from '../../interfaces/main';
import { AddNetworkRequestParams, INetworksController, Network } from '../../interfaces/network';
import { IPhishingController } from '../../interfaces/phishing';
import { Platform } from '../../interfaces/platform';
import { IPortfolioController } from '../../interfaces/portfolio';
import { IPrivacyPoolsController } from '../../interfaces/privacyPools';
import { IProvidersController } from '../../interfaces/provider';
import { IRequestsController } from '../../interfaces/requests';
import { ISafeController } from '../../interfaces/safe';
import { ISelectedAccountController } from '../../interfaces/selectedAccount';
import { ISignMessageController } from '../../interfaces/signMessage';
import { IStorageController, Storage } from '../../interfaces/storage';
import { ISurveyController } from '../../interfaces/survey';
import { ISwapAndBridgeController, SwapAndBridgeActiveRoute } from '../../interfaces/swapAndBridge';
import { ITransactionManagerController } from '../../interfaces/transactionManager';
import { ITransferController } from '../../interfaces/transfer';
import { ITransfersScannerController } from '../../interfaces/transferScanner';
import { IUiController, UiManager } from '../../interfaces/ui';
import { CallsUserRequest } from '../../interfaces/userRequest';
import { IVerificationController } from '../../interfaces/verification';
import { IWalletTokenController } from '../../interfaces/walletToken';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { PrivacyPoolsProverFactory } from '../../libs/privacyPools/prover';
import { BindedRelayerCall } from '../../libs/relayerCall/relayerCall';
import { AmbireIdbDatabase } from '../../services/storage/idbDatabase';
type AccountsUpdate = {
    accountsToAdd: Account[];
    accountAddressesToRemove: Account['addr'][];
};
export declare class MainController extends EventEmitter implements IMainController {
    #private;
    fetch: Fetch;
    initialLoadPromise?: Promise<void>;
    callRelayer: BindedRelayerCall;
    isReady: boolean;
    storage: IStorageController;
    signAccountOpPreference: SignAccountOpPreferenceController;
    featureFlags: IFeatureFlagsController;
    debug: IDebugController;
    invite: IInviteController;
    keystore: IKeystoreController;
    networks: INetworksController;
    providers: IProvidersController;
    verification: IVerificationController;
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
    erc7730: IErc7730Controller;
    contractNames: IContractNamesController;
    contractInfo: IContractInfoController;
    walletToken: IWalletTokenController;
    autoLogin: IAutoLoginController;
    accounts: IAccountsController;
    selectedAccount: ISelectedAccountController;
    privacyPools: IPrivacyPoolsController;
    requests: IRequestsController;
    banner: IBannerController;
    survey: ISurveyController;
    appDataSync: IAppDataSyncController;
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
    constructor({ eventEmitterRegistry, appVersion, platform, storageAPI, fetch, relayerUrl, velcroUrl, liFiApiKey, cowSwapApiKey, bungeeApiKey, uniswapApiKey, featureFlags, keystoreSigners, externalSignerControllers, uiManager, privacyPoolsCircuitsBaseUrl, privacyPoolsProverFactory, idb }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        appVersion: string;
        platform: Platform;
        storageAPI: Storage;
        fetch: Fetch;
        relayerUrl: string;
        velcroUrl: string;
        liFiApiKey: string;
        cowSwapApiKey: string;
        bungeeApiKey: string;
        uniswapApiKey: string;
        featureFlags: Partial<FeatureFlags>;
        keystoreSigners: Partial<{
            [key in Key['type']]: KeystoreSignerType;
        }>;
        externalSignerControllers: ExternalSignerControllers;
        uiManager: UiManager;
        /** Base URL of the Privacy Pools circuit artifacts, a build asset only the platform knows. */
        privacyPoolsCircuitsBaseUrl: string;
        /** Where to generate Privacy Pools proofs if not here - see `PrivacyPoolsController`. */
        privacyPoolsProverFactory?: PrivacyPoolsProverFactory;
        idb?: AmbireIdbDatabase;
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
    /** Adds the Privacy Pools account of a stored recovery phrase and selects it. */
    addPrivacyPoolsAccount(seedId: string): Promise<void>;
    /**
     * Creates a recovery phrase with only a Privacy Pools account on it, and selects it. The phrase
     * is stored as not backed up, so the UI asks for a backup: the only way to recover the funds.
     */
    addPrivacyPoolsAccountFromNewSeed({ extraEntropy }: {
        extraEntropy?: string;
    }): Promise<void>;
    selectPrivacyPoolsAccount(seedId: string): Promise<void>;
    commonHandlerForBroadcastSuccess({ submittedAccountOp, accountOp }: OnboardingSuccessProps): Promise<void>;
    handleSignAndBroadcastAccountOp(type: SignAccountOpType, fromRequestId: string | number, reviewedAccountOpId?: string): Promise<void>;
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
    handleAccountPickerInitOneKey(OneKeyKeyIterator: any, // TODO: KeyIterator type mismatch
    preferredDeviceId?: string): Promise<void>;
    handleAccountPickerInitLattice(LatticeKeyIterator: any): Promise<void>;
    handleAccountPickerInitQr(QrKeyIterator: any, // TODO: KeyIterator type mismatch
    payload: string | Uint8Array): Promise<void>;
    handleAccountPickerInitNfc(NfcKeyIterator: any, // TODO: KeyIterator type mismatch
    payload: {
        extendedPublicKey: string;
        hdPath: string;
    }): Promise<void>;
    updateAccountsOpsStatuses(): Promise<void>;
    setContractsDeployedToTrueIfDeployed(network: Network): Promise<void>;
    removeAccount(address: Account['addr']): Promise<void>;
    updateAccounts(accountsUpdate: AccountsUpdate): Promise<void>;
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
    refreshSafeTxns(): Promise<void>;
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
    /**
     * Prepares the account picker with a list of private keys (bulk import). The key at position N
     * in the list is listed as the account at index N. Duplicates are dropped and the list is
     * limited to `MAX_BULK_PRIVATE_KEYS` keys.
     */
    accountPickerSetInitParamsFromPrivateKeys({ privateKeys }: {
        privateKeys: string[];
    }): Promise<void>;
    /**
     * Creates a brand new recovery phrase and prepares the account picker with it, all
     * in the background. The phrase is never sent to the UI - the user gets prompted to
     * write it down later, once the account holds funds.
     */
    accountPickerSetInitParamsFromNewSeed({ extraEntropy }: {
        extraEntropy?: string;
    }): Promise<void>;
    toJSON(): this & {
        name: string;
        emittedErrors: ErrorRef[];
    };
}
export {};
//# sourceMappingURL=main.d.ts.map