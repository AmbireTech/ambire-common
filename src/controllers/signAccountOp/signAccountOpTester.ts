import { Account, IAccountsController } from '../../interfaces/account'
import { AccountOpAction } from '../../interfaces/actions'
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore'
import { INetworksController, Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { ActivityController } from '../activity/activity'
import { EstimationController } from '../estimation/estimation'
import { GasPriceController } from '../gasPrice/gasPrice'
import { PortfolioController } from '../portfolio/portfolio'
import { SignAccountOpController } from './signAccountOp'

export class SignAccountOpTesterController extends SignAccountOpController {
  constructor(
    accounts: IAccountsController,
    networks: INetworksController,
    keystore: IKeystoreController,
    portfolio: PortfolioController,
    activity: ActivityController,
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
