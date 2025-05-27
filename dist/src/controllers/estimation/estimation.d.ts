import { RPCProvider } from '../../interfaces/provider';
import { SignAccountOpError, Warning } from '../../interfaces/signAccountOp';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { FeePaymentOption, FullEstimationSummary } from '../../libs/estimate/interfaces';
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher';
import { AccountsController } from '../accounts/accounts';
import EventEmitter, { ErrorRef } from '../eventEmitter/eventEmitter';
import { KeystoreController } from '../keystore/keystore';
import { NetworksController } from '../networks/networks';
import { PortfolioController } from '../portfolio/portfolio';
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
    constructor(keystore: KeystoreController, accounts: AccountsController, networks: NetworksController, provider: RPCProvider, portfolio: PortfolioController, bundlerSwitcher: BundlerSwitcher);
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
    reset(): void;
}
//# sourceMappingURL=estimation.d.ts.map