import { Account, IAccountsController } from '../../interfaces/account';
import { IActivityController } from '../../interfaces/activity';
import { IDappsController } from '../../interfaces/dapp';
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore';
import { INetworksController, Network } from '../../interfaces/network';
import { IPhishingController } from '../../interfaces/phishing';
import { IPortfolioController } from '../../interfaces/portfolio';
import { RPCProvider } from '../../interfaces/provider';
import { UserRequest } from '../../interfaces/userRequest';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { EstimationController } from '../estimation/estimation';
import { GasPriceController } from '../gasPrice/gasPrice';
import { SignAccountOpType } from './helper';
import { OnBroadcastFailed, OnBroadcastSuccess, SignAccountOpController } from './signAccountOp';
export declare class SignAccountOpTesterController extends SignAccountOpController {
    constructor(props: {
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
        fromRequestId: UserRequest['id'];
        accountOp: AccountOp;
        shouldSimulate: boolean;
        traceCall?: Function;
        onBroadcastSuccess: OnBroadcastSuccess;
        onBroadcastFailed?: OnBroadcastFailed;
        estimateController: EstimationController;
        gasPriceController: GasPriceController;
        phishing: IPhishingController;
    });
}
//# sourceMappingURL=signAccountOpTester.d.ts.map