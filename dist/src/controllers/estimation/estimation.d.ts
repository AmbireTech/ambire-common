import { Account, IAccountsController } from '../../interfaces/account';
import { IActivityController } from '../../interfaces/activity';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { IKeystoreController } from '../../interfaces/keystore';
import { INetworksController } from '../../interfaces/network';
import { IPortfolioController } from '../../interfaces/portfolio';
import { RPCProvider } from '../../interfaces/provider';
import { SignAccountOpError, Warning } from '../../interfaces/signAccountOp';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { FeePaymentOption, FullEstimationSummary } from '../../libs/estimate/interfaces';
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher';
import EventEmitter from '../eventEmitter/eventEmitter';
import { EstimationFailure, EstimationFailureKind, EstimationStatus } from './types';
/** User-facing reasons an estimation attempt could not produce a result. */
export declare const ESTIMATION_FAILURES: Record<'missingAccount' | 'missingNetwork' | 'missingAccountState' | 'unexpected', EstimationFailure>;
export declare class EstimationController extends EventEmitter {
    #private;
    status: EstimationStatus;
    estimation: FullEstimationSummary | null;
    error: Error | null;
    /**
     * a boolean to understand if the estimation has been performed
     * at least one indicating clearly that all other are re-estimates
     */
    hasEstimated: boolean;
    /**
     * How the last attempt failed, or null when it produced an answer - even one
     * the user has to act on, like not enough funds to cover the fee.
     */
    failureKind: EstimationFailureKind | null;
    availableFeeOptions: FeePaymentOption[];
    /**
     * Used to prevent slow estimations for a past accountOp overwriting
     * the latest estimation results
     */
    private lastAccountOpId;
    constructor(keystore: IKeystoreController, accounts: IAccountsController, networks: INetworksController, provider: RPCProvider, portfolio: IPortfolioController, bundlerSwitcher: BundlerSwitcher, activity: IActivityController, featureFlags: IFeatureFlagsController);
    estimate(op: AccountOp): Promise<void>;
    /**
     * it's initialized if it has estimated at least once
     */
    isInitialized(): boolean;
    /**
     * Whether the last attempt failed for a reason that could resolve on its own.
     * The reestimation loop keeps going and the sign screen says the estimation
     * is taking longer than usual instead of showing a dead end.
     */
    isRetryingFailure(): boolean;
    /**
     * Whether asking again cannot change the outcome, so the reestimation loop
     * has nothing left to do.
     */
    hasPermanentFailure(): boolean;
    calculateWarnings(acc: Account): Warning[];
    get errors(): SignAccountOpError[];
}
//# sourceMappingURL=estimation.d.ts.map