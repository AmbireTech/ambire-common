import EmittableError from '../../classes/EmittableError';
import ExternalSignerError from '../../classes/ExternalSignerError';
import { Account, AccountOnchainState, IAccountsController } from '../../interfaces/account';
import { IActivityController } from '../../interfaces/activity';
import { IDappsController } from '../../interfaces/dapp';
import { ErrorRef, IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { Hex } from '../../interfaces/hex';
import { ExternalKey, ExternalSignerControllers, IKeystoreController, InternalKey, Key } from '../../interfaces/keystore';
import { INetworksController, Network } from '../../interfaces/network';
import { IPhishingController } from '../../interfaces/phishing';
import { IPortfolioController } from '../../interfaces/portfolio';
import { RPCProvider } from '../../interfaces/provider';
import { HardwareWalletSigningRequest, ISignAccountOpController, SignAccountOpBanner, SignAccountOpError, TraceCallDiscoveryStatus, Warning } from '../../interfaces/signAccountOp';
import { UserRequest } from '../../interfaces/userRequest';
import { BaseAccount } from '../../libs/account/BaseAccount';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { Sponsor } from '../../libs/erc7677/types';
import { FeePaymentOption } from '../../libs/estimate/interfaces';
import { IrCall } from '../../libs/humanizer/interfaces';
import { TokenResult } from '../../libs/portfolio';
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher';
import { GasSpeeds } from '../../services/bundlers/types';
import { EstimationController } from '../estimation/estimation';
import EventEmitter from '../eventEmitter/eventEmitter';
import { GasPriceController } from '../gasPrice/gasPrice';
import { SignAccountOpType } from './helper';
export declare enum SigningStatus {
    EstimationError = "estimation-error",
    UnableToSign = "unable-to-sign",
    ReadyToSign = "ready-to-sign",
    /**
     * Used to prevent state updates while the user is resolving warnings, connecting a hardware wallet, etc.
     * Signing is allowed in this state, but the state of the controller should not change.
     */
    UpdatesPaused = "updates-paused",
    InProgress = "in-progress",
    WaitingForPaymaster = "waiting-for-paymaster-response",
    Done = "done",
    Queued = "queued"
}
export type Status = {
    type: SigningStatus;
};
export declare enum FeeSpeed {
    Slow = "slow",
    Medium = "medium",
    Fast = "fast",
    Ape = "ape"
}
export type SpeedCalc = {
    type: FeeSpeed;
    amount: bigint;
    simulatedGasLimit: bigint;
    amountFormatted: string;
    amountUsd: string;
    gasPrice: bigint;
    disabled: boolean;
    maxPriorityFeePerGas?: bigint;
};
export declare const noStateUpdateStatuses: SigningStatus[];
export type SignAccountOpUpdateProps = {
    gasPrices?: GasSpeeds;
    customGasPrices?: GasSpeeds;
    customGasLimit?: bigint;
    feeToken?: TokenResult;
    paidBy?: string;
    paidByKeyType?: Key['type'];
    speed?: FeeSpeed;
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
export declare class SignAccountOpController extends EventEmitter implements ISignAccountOpController {
    #private;
    account: Account;
    baseAccount: BaseAccount;
    fromRequestId: UserRequest['id'];
    hasSafeApiFailed: boolean;
    gasPrices?: GasSpeeds;
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
    selectedFeeSpeed: FeeSpeed | null;
    /**
     * The selected payment option for txn broadcasting.
     * Depending on the account type, it could be various tokens,
     * gas tank, or payment by another EOA
     */
    selectedOption: FeePaymentOption | undefined;
    status: Status | null;
    broadcastStatus: 'INITIAL' | 'LOADING' | 'SUCCESS' | 'ERROR';
    signedAccountOp: AccountOp | null;
    replacementFeeLow: boolean;
    warnings: Warning[];
    isSponsored: boolean;
    sponsor: Sponsor | undefined;
    bundlerSwitcher: BundlerSwitcher;
    signedTransactionsCount: number | null;
    hardwareWalletSigningRequest: HardwareWalletSigningRequest | null;
    traceCallDiscoveryStatus: TraceCallDiscoveryStatus;
    gasUsed: bigint;
    provider: RPCProvider;
    estimation: EstimationController;
    humanization: IrCall[];
    humanizationId: number | null;
    gasPrice: GasPriceController;
    shouldSignAuth: {
        type: 'V2Deploy' | '7702';
        text: string;
    } | null;
    signPromise: Promise<void> | undefined;
    broadcastPromise: Promise<void> | undefined;
    signAndBroadcastPromise: Promise<void> | undefined;
    constructor({ eventEmitterRegistry, type, callRelayer, accounts, networks, keystore, portfolio, externalSignerControllers, account, network, activity, dapps, provider, phishing, fromRequestId, accountOp, shouldSimulate, onUpdateAfterTraceCallSuccess, onBroadcastSuccess, onBroadcastFailed }: {
        eventEmitterRegistry?: IEventEmitterRegistryController;
        type?: SignAccountOpType;
        callRelayer: Function;
        accounts: IAccountsController;
        networks: INetworksController;
        keystore: IKeystoreController;
        portfolio: IPortfolioController;
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
    });
    get safetyChecksLoading(): boolean;
    get accountOp(): Readonly<AccountOp>;
    get isSpeedUpTransaction(): boolean;
    humanize(): void;
    learnTokens(): void;
    get isInitialized(): boolean;
    hasSpeeds(identifier: string): number;
    get errors(): SignAccountOpError[];
    get readyToSign(): boolean;
    calculateWarnings(): void;
    retry(method: 'simulate' | 'estimate'): Promise<void>;
    update({ gasPrices, customGasPrices, customGasLimit, feeToken, paidBy, speed, signingKeyAddr, signingKeyType, signedTransactionsCount, hasNewEstimation, paidByKeyType, accountOpData }: SignAccountOpUpdateProps): void;
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
     * Unbrick mechanism.
     * Use this only when you are sure there's no way to continue, or
     * a promise waiting to resolve that might change the state
     */
    cancelSignReq(): void;
    get type(): SignAccountOpType;
    get delegatedContract(): Hex | null;
    get banners(): SignAccountOpBanner[];
    get canAccountBroadcastByItself(): boolean;
    get canSetCustomGasPrices(): boolean;
    get canSetCustomGas(): boolean;
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
        speedOptions: string[];
        selectedOption: FeePaymentOption;
        account: Account;
        errors: SignAccountOpError[];
        gasSavedUSD: number;
        delegatedContract: `0x${string}`;
        accountOp: Readonly<AccountOp>;
        isSignInProgress: boolean;
        isBroadcastInProgress: boolean;
        isSignAndBroadcastInProgress: boolean;
        banners: SignAccountOpBanner[];
        canAccountBroadcastByItself: boolean;
        canSetCustomGasPrices: boolean;
        canSetCustomGas: boolean;
        threshold: number;
        canBroadcast: boolean;
        hasSafeApiFailed: boolean;
        hardwareWalletSigningRequest: HardwareWalletSigningRequest;
        name: string;
        emittedErrors: ErrorRef[];
    };
}
//# sourceMappingURL=signAccountOp.d.ts.map