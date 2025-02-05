import { BUNDLER } from '../../consts/bundlers';
import { Account } from '../../interfaces/account';
import { ExternalSignerControllers, Key } from '../../interfaces/keystore';
import { Network } from '../../interfaces/network';
import { Warning } from '../../interfaces/signAccountOp';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { SubmittedAccountOp } from '../../libs/accountOp/submittedAccountOp';
import { Sponsor } from '../../libs/erc7677/types';
import { EstimateResult, FeePaymentOption } from '../../libs/estimate/interfaces';
import { GasRecommendation } from '../../libs/gasPrice/gasPrice';
import { TokenResult } from '../../libs/portfolio';
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher';
import { GasSpeeds } from '../../services/bundlers/types';
import { AccountsController } from '../accounts/accounts';
import { AccountOpAction } from '../actions/actions';
import EventEmitter from '../eventEmitter/eventEmitter';
import { KeystoreController } from '../keystore/keystore';
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
type SpeedCalc = {
    type: FeeSpeed;
    amount: bigint;
    simulatedGasLimit: bigint;
    amountFormatted: string;
    amountUsd: string;
    gasPrice: bigint;
    maxPriorityFeePerGas?: bigint;
};
export declare const noStateUpdateStatuses: SigningStatus[];
export declare class SignAccountOpController extends EventEmitter {
    #private;
    account: Account;
    fromActionId: AccountOpAction['id'];
    accountOp: AccountOp;
    gasPrices: GasRecommendation[] | null;
    bundlerGasPrices: GasSpeeds | null;
    estimation: EstimateResult | null;
    feeSpeeds: {
        [identifier: string]: SpeedCalc[];
    };
    paidBy: string | null;
    feeTokenResult: TokenResult | null;
    selectedFeeSpeed: FeeSpeed;
    selectedOption: FeePaymentOption | undefined;
    status: Status | null;
    gasUsedTooHigh: boolean;
    gasUsedTooHighAgreed: boolean;
    rbfAccountOps: {
        [key: string]: SubmittedAccountOp | null;
    };
    signedAccountOp: AccountOp | null;
    replacementFeeLow: boolean;
    warnings: Warning[];
    isSponsored: boolean;
    sponsor: Sponsor | undefined;
    bundlerSwitcher: BundlerSwitcher;
    constructor(accounts: AccountsController, keystore: KeystoreController, portfolio: PortfolioController, externalSignerControllers: ExternalSignerControllers, account: Account, network: Network, fromActionId: AccountOpAction['id'], accountOp: AccountOp, reEstimate: Function, isSignRequestStillActive: Function);
    get isInitialized(): boolean;
    hasSpeeds(identifier: string): number | false;
    getCallDataAdditionalByNetwork(): bigint;
    get errors(): string[];
    get readyToSign(): boolean;
    calculateWarnings(): void;
    update({ gasPrices, estimation, feeToken, paidBy, speed, signingKeyAddr, signingKeyType, calls, gasUsedTooHighAgreed, rbfAccountOps, bundlerGasPrices, blockGasLimit }: {
        gasPrices?: GasRecommendation[];
        estimation?: EstimateResult | null;
        feeToken?: TokenResult;
        paidBy?: string;
        speed?: FeeSpeed;
        signingKeyAddr?: Key['addr'];
        signingKeyType?: Key['type'];
        calls?: AccountOp['calls'];
        gasUsedTooHighAgreed?: boolean;
        rbfAccountOps?: {
            [key: string]: SubmittedAccountOp | null;
        };
        bundlerGasPrices?: {
            speeds: GasSpeeds;
            bundler: BUNDLER;
        };
        blockGasLimit?: bigint;
    }): void;
    updateStatus(forceStatusChange?: SigningStatus, replacementFeeLow?: boolean): void;
    reset(): void;
    resetStatus(): void;
    static getAmountAfterFeeTokenConvert(simulatedGasLimit: bigint, gasPrice: bigint, nativeRatio: bigint, feeTokenDecimals: number, addedNative: bigint): bigint;
    get feeToken(): string | null;
    get feePaidBy(): string | null;
    get availableFeeOptions(): EstimateResult['feePaymentOptions'];
    get accountKeyStoreKeys(): Key[];
    get speedOptions(): string[];
    get gasSavedUSD(): number | null;
    sign(): Promise<void | AccountOp>;
    toJSON(): this & {
        isInitialized: boolean;
        readyToSign: boolean;
        availableFeeOptions: FeePaymentOption[];
        accountKeyStoreKeys: Key[];
        feeToken: string | null;
        feePaidBy: string | null;
        speedOptions: string[];
        selectedOption: FeePaymentOption | undefined;
        account: Account;
        errors: string[];
        gasSavedUSD: number | null;
    };
}
export {};
//# sourceMappingURL=signAccountOp.d.ts.map