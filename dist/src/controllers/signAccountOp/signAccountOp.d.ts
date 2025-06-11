import { BUNDLER } from '../../consts/bundlers';
import { Hex } from '../../interfaces/hex';
import { Account } from '../../interfaces/account';
import { ExternalKey, ExternalSignerControllers, InternalKey, Key } from '../../interfaces/keystore';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { SignAccountOpError, TraceCallDiscoveryStatus, Warning } from '../../interfaces/signAccountOp';
import { BaseAccount } from '../../libs/account/BaseAccount';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { Sponsor } from '../../libs/erc7677/types';
import { FeePaymentOption } from '../../libs/estimate/interfaces';
import { GasRecommendation } from '../../libs/gasPrice/gasPrice';
import { TokenResult } from '../../libs/portfolio';
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher';
import { GasSpeeds } from '../../services/bundlers/types';
import { AccountsController } from '../accounts/accounts';
import { AccountOpAction } from '../actions/actions';
import { EstimationController } from '../estimation/estimation';
import EventEmitter from '../eventEmitter/eventEmitter';
import { GasPriceController } from '../gasPrice/gasPrice';
import { KeystoreController } from '../keystore/keystore';
import { NetworksController } from '../networks/networks';
import { PortfolioController } from '../portfolio/portfolio';
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
    Done = "done"
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
export declare class SignAccountOpController extends EventEmitter {
    #private;
    account: Account;
    baseAccount: BaseAccount;
    fromActionId: AccountOpAction['id'];
    accountOp: AccountOp;
    gasPrices?: GasRecommendation[] | null;
    bundlerGasPrices: GasSpeeds | null;
    feeSpeeds: {
        [identifier: string]: SpeedCalc[];
    };
    paidBy: string | null;
    feeTokenResult: TokenResult | null;
    selectedFeeSpeed: FeeSpeed | null;
    selectedOption: FeePaymentOption | undefined;
    status: Status | null;
    rbfAccountOps: {
        [key: string]: SubmittedAccountOp | null;
    };
    signedAccountOp: AccountOp | null;
    replacementFeeLow: boolean;
    warnings: Warning[];
    isSponsored: boolean;
    sponsor: Sponsor | undefined;
    bundlerSwitcher: BundlerSwitcher;
    signedTransactionsCount: number | null;
    traceCallDiscoveryStatus: TraceCallDiscoveryStatus;
    gasUsed: bigint;
    provider: RPCProvider;
    estimation: EstimationController;
    gasPrice: GasPriceController;
    shouldSignAuth: {
        type: 'V2Deploy' | '7702';
        text: string;
    } | null;
    constructor(accounts: AccountsController, networks: NetworksController, keystore: KeystoreController, portfolio: PortfolioController, externalSignerControllers: ExternalSignerControllers, account: Account, network: Network, provider: RPCProvider, fromActionId: AccountOpAction['id'], accountOp: AccountOp, isSignRequestStillActive: Function, shouldSimulate: boolean, traceCall?: Function);
    learnTokensFromCalls(): void;
    get isInitialized(): boolean;
    hasSpeeds(identifier: string): number | false;
    get errors(): SignAccountOpError[];
    get readyToSign(): boolean;
    calculateWarnings(): void;
    simulate(shouldTraceCall?: boolean): Promise<void>;
    estimate(): Promise<void>;
    simulateSwapOrBridge(): Promise<void>;
    update({ gasPrices, feeToken, paidBy, speed, signingKeyAddr, signingKeyType, calls, rbfAccountOps, bundlerGasPrices, blockGasLimit, signedTransactionsCount, hasNewEstimation }: {
        gasPrices?: GasRecommendation[] | null;
        feeToken?: TokenResult;
        paidBy?: string;
        speed?: FeeSpeed;
        signingKeyAddr?: Key['addr'];
        signingKeyType?: InternalKey['type'] | ExternalKey['type'];
        calls?: AccountOp['calls'];
        rbfAccountOps?: {
            [key: string]: SubmittedAccountOp | null;
        };
        bundlerGasPrices?: {
            speeds: GasSpeeds;
            bundler: BUNDLER;
        };
        blockGasLimit?: bigint;
        signedTransactionsCount?: number | null;
        hasNewEstimation?: boolean;
    }): void;
    updateStatus(forceStatusChange?: SigningStatus, replacementFeeLow?: boolean): void;
    reset(): void;
    resetStatus(): void;
    static getAmountAfterFeeTokenConvert(simulatedGasLimit: bigint, gasPrice: bigint, nativeRatio: bigint, feeTokenDecimals: number, addedNative: bigint): bigint;
    get feeToken(): string | null;
    get feePaidBy(): string | null;
    get accountKeyStoreKeys(): Key[];
    get speedOptions(): string[];
    get gasSavedUSD(): number | null;
    sign(): Promise<void | AccountOp>;
    canUpdate(): boolean;
    setDiscoveryStatus(status: TraceCallDiscoveryStatus): void;
    get delegatedContract(): Hex | null;
    toJSON(): this & {
        isInitialized: boolean;
        readyToSign: boolean;
        accountKeyStoreKeys: Key[];
        feeToken: string | null;
        feePaidBy: string | null;
        speedOptions: string[];
        selectedOption: FeePaymentOption | undefined;
        account: Account;
        errors: SignAccountOpError[];
        gasSavedUSD: number | null;
        delegatedContract: `0x${string}` | null;
    };
}
//# sourceMappingURL=signAccountOp.d.ts.map