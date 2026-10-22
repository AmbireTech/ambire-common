import { BindedRelayerCall } from '../../libs/relayerCall/relayerCall';
import EmittableError from '../../classes/EmittableError';
import ExternalSignerError from '../../classes/ExternalSignerError';
import { Account, AccountOnchainState, IAccountsController } from '../../interfaces/account';
import { IActivityController } from '../../interfaces/activity';
import { IContractInfoController } from '../../interfaces/contractInfo';
import { IDappsController } from '../../interfaces/dapp';
import { IErc7730Controller } from '../../interfaces/erc7730';
import { ErrorRef, IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Hex } from '../../interfaces/hex';
import { ExternalKey, ExternalSignerControllers, IKeystoreController, InternalKey, Key } from '../../interfaces/keystore';
import { INetworksController, Network } from '../../interfaces/network';
import { IPhishingController } from '../../interfaces/phishing';
import { Platform } from '../../interfaces/platform';
import { IPortfolioController } from '../../interfaces/portfolio';
import { RPCProvider } from '../../interfaces/provider';
import { FeeSpeed, HardwareWalletSigningRequest, ISignAccountOpController, noStateUpdateStatuses, SafeFeePayerLinks, SignAccountOpBanner, SignAccountOpError, SigningStatus, TraceCallDiscoveryStatus, Warning } from '../../interfaces/signAccountOp';
import { SigningAuthRequirement } from '../../interfaces/signingAuth';
import { UserRequest } from '../../interfaces/userRequest';
import { BaseAccount } from '../../libs/account/BaseAccount';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { Call } from '../../libs/accountOp/types';
import { Sponsor } from '../../libs/erc7677/types';
import { FeePaymentOption } from '../../libs/estimate/interfaces';
import { IrCall } from '../../libs/humanizer/interfaces';
import { TokenResult } from '../../libs/portfolio';
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher';
import { GasSpeeds } from '../../services/bundlers/types';
import { EstimationController } from '../estimation/estimation';
import { GasPriceController } from '../gasPrice/gasPrice';
import HumanizationController from '../humanization/humanization';
import { SignAccountOpType } from './helper';
import { SignAccountOpFeeTokenPreference, SignAccountOpPreferenceController } from './signAccountOpPreference';
import { SpeedUp } from './speedUp';
import type { SpeedCalc, Status } from '../../interfaces/signAccountOp';
export { FeeSpeed, noStateUpdateStatuses, SigningStatus };
export type { SpeedCalc, Status };
/** After this many reestimates the loop gives up and stops refetching. */
export declare const MAX_REESTIMATES = 20;
export type SignAccountOpUpdateProps = {
    gasPrices?: GasSpeeds;
    rpcGasPrices?: GasSpeeds;
    customGasPrices?: GasSpeeds;
    customGasLimit?: bigint;
    feeToken?: TokenResult;
    pendingFeeTokenPreference?: TokenResult | null;
    paidBy?: string;
    paidByKeyType?: Key['type'];
    speed?: FeeSpeed;
    shouldPersistSpeed?: boolean;
    signingKeyAddr?: Key['addr'];
    signingKeyType?: InternalKey['type'] | ExternalKey['type'];
    signedTransactionsCount?: number | null;
    hasNewEstimation?: boolean;
    accountOpData?: Partial<AccountOp>;
};
export type OnboardingSuccessProps = {
    submittedAccountOp: SubmittedAccountOp;
    accountOp: AccountOp;
    type: SignAccountOpType;
    fromRequestId: string | number;
};
export type OnBroadcastSuccess = (props: OnboardingSuccessProps) => Promise<void>;
export type OnBroadcastFailed = (accountOp: AccountOp) => void;
/**
 * Called when only the first txns of a batch broadcast one by one went out,
 * e.g. the approval of a swap was sent but the swap itself was rejected on the device.
 * Receives the sent part, so it can be recorded and tracked until confirmed.
 */
export type OnPartialBroadcast = (sentAccountOp: SubmittedAccountOp) => Promise<void>;
export declare class SignAccountOpController extends HumanizationController implements ISignAccountOpController {
    #private;
    account: Account;
    baseAccount: BaseAccount;
    fromRequestId: UserRequest['id'];
    hasSafeApiFailed: boolean;
    isRefetchingAccountState: boolean;
    /**
     * The gas prices used for broadcasting. With the `rpcWithBundlerFallback` strategy
     * (see BaseAccount.getGasPriceFetchStrategy), these come from the bundler estimation
     * and are used for bundler broadcasts only. While there's no bundler estimation,
     * they're the gasPrice controller ones
     */
    gasPrices?: GasSpeeds;
    /**
     * The gas prices for broadcasts outside the bundler with the `rpcWithBundlerFallback`
     * strategy (see BaseAccount.getGasPriceFetchStrategy). These are the RPC gas prices,
     * or the bundler ones if the RPC has failed and the bundler fallback has succeeded
     */
    rpcGasPrices?: GasSpeeds;
    hasCustomGasPrices: boolean;
    customGasLimit?: bigint;
    feeSpeeds: {
        [identifier: string]: SpeedCalc[];
    };
    /**
     * The selected fee token the user is going to broadcast with.
     * This probably exists in selectedOption as well and it could
     * be refactored away someday
     */
    feeTokenResult: TokenResult | null;
    feeTokenPreference: SignAccountOpFeeTokenPreference;
    pendingFeeTokenPreference: SignAccountOpFeeTokenPreference | null;
    selectedFeeSpeed: FeeSpeed | null;
    /**
     * The selected payment option for txn broadcasting.
     * Depending on the account type, it could be various tokens,
     * gas tank, or payment by another EOA
     */
    selectedOption: FeePaymentOption | undefined;
    /**
     * Safes only, null for other accounts. Paying the fee from an EOA publicly links it to the
     * Safe, unless it's an owner (listed in the Safe itself) or already paid for the Safe before.
     * Lowercased addresses; `linked` excludes the owners.
     */
    safeFeePayerLinks: SafeFeePayerLinks | null;
    status: Status | null;
    broadcastStatus: 'INITIAL' | 'LOADING' | 'SUCCESS' | 'ERROR';
    signedAccountOp: AccountOp | null;
    replacementFeeLow: boolean;
    gasFeeChangedConfirmationRequired: boolean;
    previousFee: SpeedCalc | null;
    warnings: Warning[];
    isSponsored: boolean;
    sponsor: Sponsor | undefined;
    bundlerSwitcher: BundlerSwitcher;
    signedTransactionsCount: number | null;
    hardwareWalletSigningRequest: HardwareWalletSigningRequest | null;
    safeEip712Data: unknown | null;
    traceCallDiscoveryStatus: TraceCallDiscoveryStatus;
    gasUsed: bigint;
    provider: RPCProvider;
    estimation: EstimationController;
    /**
     * The humanized calls, with the unlimited approval warnings of apps in the default Ambire
     * catalog taken out. Humanizer modules cannot read the catalog, so they report every unlimited
     * approval, and the ones from an app we already trust are dropped here.
     *
     * The catalog is fetched, so it often arrives after the calls were humanized. Deciding this on
     * read, rather than baking it into the humanization, means a catalog that lands late needs no
     * new humanization: the dapps update this controller already listens to emits, the UI reads
     * again, and the answer is right whether an app joins the catalog or leaves it.
     *
     * Returns the stored array itself when nothing was dropped, so the calls on screen keep their
     * identity while a new humanization is running.
     */
    get humanization(): IrCall[];
    humanizationId: number | null;
    isHumanizing: boolean;
    gasPrice: GasPriceController;
    shouldSignAuth: {
        type: 'V2Deploy' | '7702';
        text: string;
    } | null;
    signPromise: Promise<void> | undefined;
    broadcastPromise: Promise<void> | undefined;
    signAndBroadcastPromise: Promise<void> | undefined;
    private traceCallTimeoutId;
    constructor({ eventEmitterRegistry, type, callRelayer, erc7730, contractInfo, accounts, networks, keystore, portfolio, featureFlags, platform, signAccountOpPreference, externalSignerControllers, account, network, activity, dapps, provider, phishing, fromRequestId, accountOp, shouldSimulate, onUpdateAfterTraceCallSuccess, onBroadcastSuccess, onBroadcastFailed, onPartialBroadcast, speedUp }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        type?: SignAccountOpType;
        callRelayer: BindedRelayerCall;
        erc7730: IErc7730Controller;
        contractInfo: IContractInfoController;
        accounts: IAccountsController;
        networks: INetworksController;
        keystore: IKeystoreController;
        portfolio: IPortfolioController;
        featureFlags: IFeatureFlagsController;
        platform: Platform;
        signAccountOpPreference: SignAccountOpPreferenceController;
        externalSignerControllers: ExternalSignerControllers;
        account: Account;
        network: Network;
        activity: IActivityController;
        dapps: IDappsController;
        provider: RPCProvider;
        phishing: IPhishingController;
        fromRequestId: UserRequest['id'];
        accountOp: AccountOp;
        shouldSimulate: boolean;
        onUpdateAfterTraceCallSuccess?: () => Promise<void>;
        onBroadcastSuccess: OnBroadcastSuccess;
        onBroadcastFailed?: OnBroadcastFailed;
        onPartialBroadcast?: OnPartialBroadcast;
        /** Pass only when speeding up a pending transaction */
        speedUp?: SpeedUp;
    });
    get safetyChecksLoading(): boolean;
    get accountOp(): Readonly<AccountOp>;
    get isSpeedUpTransaction(): boolean;
    /**
     * Why this account op needs the password/biometrics confirmation, or `null` when it does not.
     * Read live for the dapps, whose stored flag can change while the request is on screen.
     * Mobile only. A Safe needs it only when its hot owners can meet the threshold on their own.
     */
    get signingAuthRequirement(): SigningAuthRequirement | null;
    setSafeNonce(nonce: bigint): void;
    refetchAccountState(): Promise<void>;
    humanize(): void;
    learnTokens(): void;
    get isInitialized(): boolean;
    /**
     * Safes only: no payer is selected because the only default left would publicly link a new
     * EOA to the Safe, so the user has to choose one before executing.
     */
    get isSafeFeePayerChoiceRequired(): boolean;
    /**
     * Whether the selected fee payer would publicly link a new EOA to this Safe.
     * The Safe paying by itself (e.g. through the gas tank) links nothing.
     */
    get isFeePayerNotLinkedToSafe(): boolean;
    hasSpeeds(identifier: string): number;
    get errors(): SignAccountOpError[];
    get readyToSign(): boolean;
    calculateWarnings(): void;
    retry(method: 'simulate' | 'estimate'): Promise<void>;
    enableErc4337AndReestimate(): Promise<void>;
    update({ gasPrices, rpcGasPrices, customGasPrices, customGasLimit, feeToken, pendingFeeTokenPreference, paidBy, speed, shouldPersistSpeed, signingKeyAddr, signingKeyType, signedTransactionsCount, hasNewEstimation, paidByKeyType, accountOpData }: SignAccountOpUpdateProps): void;
    updateStatus(forceStatusChange?: SigningStatus, replacementFeeLow?: boolean): void;
    destroy(): void;
    /**
     * Makes the signAccountOp controller inactive:
     * - Stops all refetching (estimation, gas price)
     * - Unregisters from the controller registry, which in turn stops all emit updates
     * to the UI
     * This is done so there is always only one signAccountOp controller active at a time,
     * and only one controller in the registry (so the UI listens to the active one only).
     */
    pause(): void;
    /**
     * Resumes updates and intervals for the signAccountOp controller.
     *
     * Also registers the controller in the controller registry.
     */
    resume(): void;
    resetStatus(): void;
    private traceCall;
    get feeToken(): string | null;
    get accountKeyStoreKeys(): Key[];
    get feePayerKeyStoreKeys(): Key[];
    get speedOptions(): string[];
    get gasSavedUSD(): number | null;
    sign(): Promise<void>;
    signAndBroadcast(): Promise<void>;
    get isSignInProgress(): boolean;
    get isBroadcastInProgress(): boolean;
    get isSignAndBroadcastInProgress(): boolean;
    throwBroadcastAccountOp({ message: humanReadableMessage, error: _err, accountState, isRelayer, provider, network }: {
        message?: string;
        error?: Error | EmittableError | ExternalSignerError;
        accountState?: AccountOnchainState;
        isRelayer?: boolean;
        provider?: RPCProvider;
        network?: Network;
    }): void;
    canUpdate(): boolean;
    setDiscoveryStatus(status: TraceCallDiscoveryStatus): void;
    /**
     * Dismisses the soft "Gas fee updated" confirmation without retrying the
     * broadcast (e.g. when the user cancels the modal). The controller stays in
     * ReadyToSign so the user can still adjust and submit again manually.
     */
    dismissGasFeeChangedConfirmation(): void;
    cancelSignReq(): void;
    /**
     * Winds a broadcast up. The calls that went out are done with, so only the ones left
     * unsigned stay on the op and the controller goes back to where it was before
     * signing, ready for them. Its status has to be put back first: while it is signing,
     * every update to the op is frozen and the calls would not go in.
     *
     * Returns the calls still waiting to be signed, so the caller can tell whether the
     * request is finished with or has to stay.
     */
    cleanupAfterBroadcast(sentCallIds: Call['id'][]): Call[];
    get type(): SignAccountOpType;
    get delegatedContract(): Hex | null;
    get banners(): SignAccountOpBanner[];
    get canAccountBroadcastByItself(): boolean;
    /**
     * The gas prices used by the selected fee option. They differ from gasPrices
     * only with the `rpcWithBundlerFallback` strategy
     * (see BaseAccount.getGasPriceFetchStrategy)
     */
    get selectedOptionGasPrices(): GasSpeeds | undefined;
    get canSetCustomGasPrices(): boolean;
    get canSetCustomGas(): boolean;
    get isErc4337Enabled(): boolean;
    get canEnableErc4337(): boolean;
    get threshold(): number;
    get canBroadcast(): boolean;
    toJSON(): this & {
        isInitialized: boolean;
        type: SignAccountOpType;
        readyToSign: boolean;
        safetyChecksLoading: boolean;
        accountKeyStoreKeys: Key[];
        feePayerKeyStoreKeys: Key[];
        feeToken: string;
        feeTokenPreference: {
            [chainId: string]: string;
        };
        pendingFeeTokenPreference: {
            [chainId: string]: string;
        };
        speedOptions: string[];
        selectedOption: FeePaymentOption;
        account: Account;
        errors: SignAccountOpError[];
        gasSavedUSD: number;
        delegatedContract: `0x${string}`;
        accountOp: Readonly<AccountOp>;
        humanization: IrCall[];
        isSignInProgress: boolean;
        isBroadcastInProgress: boolean;
        isSignAndBroadcastInProgress: boolean;
        banners: SignAccountOpBanner[];
        canAccountBroadcastByItself: boolean;
        selectedOptionGasPrices: GasSpeeds;
        canSetCustomGasPrices: boolean;
        canSetCustomGas: boolean;
        isErc4337Enabled: boolean;
        canEnableErc4337: boolean;
        threshold: number;
        canBroadcast: boolean;
        isFeePayerNotLinkedToSafe: boolean;
        isSafeFeePayerChoiceRequired: boolean;
        hasSafeApiFailed: boolean;
        hardwareWalletSigningRequest: HardwareWalletSigningRequest;
        safeEip712Data: unknown;
        gasFeeChangedConfirmationRequired: boolean;
        previousFee: SpeedCalc;
        signingAuthRequirement: SigningAuthRequirement;
        name: string;
        emittedErrors: ErrorRef[];
    };
}
//# sourceMappingURL=signAccountOp.d.ts.map