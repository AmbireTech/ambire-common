import { Account } from '../../interfaces/account';
import { AccountOpAction } from '../../interfaces/actions';
import { ExternalSignerControllers } from '../../interfaces/keystore';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { AccountsController } from '../accounts/accounts';
import { EstimationController } from '../estimation/estimation';
import { GasPriceController } from '../gasPrice/gasPrice';
import { KeystoreController } from '../keystore/keystore';
import { NetworksController } from '../networks/networks';
import { PortfolioController } from '../portfolio/portfolio';
import { SignAccountOpController } from './signAccountOp';
export declare class SignAccountOpTesterController extends SignAccountOpController {
    constructor(accounts: AccountsController, networks: NetworksController, keystore: KeystoreController, portfolio: PortfolioController, externalSignerControllers: ExternalSignerControllers, account: Account, network: Network, provider: RPCProvider, fromActionId: AccountOpAction['id'], accountOp: AccountOp, isSignRequestStillActive: Function, shouldSimulate: boolean, traceCall: Function, estimateController: EstimationController, gasPriceController: GasPriceController);
}
//# sourceMappingURL=signAccountOpTester.d.ts.map