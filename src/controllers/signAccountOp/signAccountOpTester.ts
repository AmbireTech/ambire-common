import { Account, IAccountsController } from '../../interfaces/account'
import { AccountOpAction } from '../../interfaces/actions'
import { IActivityController } from '../../interfaces/activity'
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore'
import { INetworksController, Network } from '../../interfaces/network'
import { IPortfolioController } from '../../interfaces/portfolio'
import { RPCProvider } from '../../interfaces/provider'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { EstimationController } from '../estimation/estimation'
import { GasPriceController } from '../gasPrice/gasPrice'
import { SignAccountOpController } from './signAccountOp'

export class SignAccountOpTesterController extends SignAccountOpController {
  constructor(
    accounts: IAccountsController,
    networks: INetworksController,
    keystore: IKeystoreController,
    portfolio: IPortfolioController,
    activity: IActivityController,
    externalSignerControllers: ExternalSignerControllers,
    account: Account,
    network: Network,
    provider: RPCProvider,
    fromActionId: AccountOpAction['id'],
    accountOp: AccountOp,
    isSignRequestStillActive: Function,
    shouldSimulate: boolean,
    traceCall: Function,
    estimateController: EstimationController,
    gasPriceController: GasPriceController
  ) {
    super(
      accounts,
      networks,
      keystore,
      portfolio,
      activity,
      externalSignerControllers,
      account,
      network,
      provider,
      fromActionId,
      accountOp,
      isSignRequestStillActive,
      shouldSimulate,
      traceCall
    )

    // remove main handlers
    this.estimation.onUpdate(() => {})
    this.gasPrice.onUpdate(() => {})

    // assign easy to mock controllers
    this.estimation = estimateController
    this.gasPrice = gasPriceController
  }
}
