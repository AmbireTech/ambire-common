import { IAccountsController } from '../../interfaces/account';
import { IActivityController } from '../../interfaces/activity';
import { ErrorRef } from '../../interfaces/eventEmitter';
import { IKeystoreController } from '../../interfaces/keystore';
import { INetworksController } from '../../interfaces/network';
import { IPortfolioController } from '../../interfaces/portfolio';
import { RPCProvider } from '../../interfaces/provider';
import { SignAccountOpError, Warning } from '../../interfaces/signAccountOp';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { FeePaymentOption, FullEstimationSummary } from '../../libs/estimate/interfaces';
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher';
import EventEmitter from '../eventEmitter/eventEmitter';
import { EstimationStatus } from './types';
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
    estimationRetryError: ErrorRef | null;
    availableFeeOptions: FeePaymentOption[];
    /**
     * Used to prevent slow estimations for a past accountOp overwriting
     * the latest estimation results
     */
    private lastAccountOpId;
    constructor(keystore: IKeystoreController, accounts: IAccountsController, networks: INetworksController, provider: RPCProvider, portfolio: IPortfolioController, bundlerSwitcher: BundlerSwitcher, activity: IActivityController);
    estimate(op: AccountOp): Promise<void>;
    /**
     * it's initialized if it has estimated at least once
     */
    isInitialized(): boolean;
    /**
     * has it estimated at least once without a failure
     */
    isLoadingOrFailed(): boolean;
    calculateWarnings(): Warning[];
    get errors(): SignAccountOpError[];
}
//# sourceMappingURL=estimation.d.ts.map