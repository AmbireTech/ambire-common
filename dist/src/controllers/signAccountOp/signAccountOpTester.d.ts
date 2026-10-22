import { SpeedUp } from './speedUp';
import { Account, IAccountsController } from '../../interfaces/account';
import { IActivityController } from '../../interfaces/activity';
import { IContractInfoController } from '../../interfaces/contractInfo';
import { IDappsController } from '../../interfaces/dapp';
import { IErc7730Controller } from '../../interfaces/erc7730';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore';
import { INetworksController, Network } from '../../interfaces/network';
import { IPhishingController } from '../../interfaces/phishing';
import { Platform } from '../../interfaces/platform';
import { IPortfolioController } from '../../interfaces/portfolio';
import { RPCProvider } from '../../interfaces/provider';
import { UserRequest } from '../../interfaces/userRequest';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { BindedRelayerCall } from '../../libs/relayerCall/relayerCall';
import { EstimationController } from '../estimation/estimation';
import { GasPriceController } from '../gasPrice/gasPrice';
import { SignAccountOpType } from './helper';
import { OnBroadcastFailed, OnBroadcastSuccess, OnPartialBroadcast, SignAccountOpController } from './signAccountOp';
import { SignAccountOpPreferenceController } from './signAccountOpPreference';
export declare class SignAccountOpTesterController extends SignAccountOpController {
    #private;
    constructor(props: {
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
        fromRequestId: UserRequest['id'];
        accountOp: AccountOp;
        shouldSimulate: boolean;
        onUpdateAfterTraceCallSuccess?: () => Promise<void>;
        onBroadcastSuccess: OnBroadcastSuccess;
        onBroadcastFailed?: OnBroadcastFailed;
        onPartialBroadcast?: OnPartialBroadcast;
        speedUp?: SpeedUp;
        estimateController: EstimationController;
        gasPriceController: GasPriceController;
        phishing: IPhishingController;
    });
    /**
     * Runs the parent's gas price update handler, as a gas price fetch would.
     * The handler reads the gas prices from the swapped in (mocked) gasPrice controller
     */
    emitGasPriceUpdate(): Promise<void>;
}
//# sourceMappingURL=signAccountOpTester.d.ts.map