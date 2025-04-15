import { Account, AccountOnchainState } from '../../interfaces/account'
import { AccountOpAction } from '../../interfaces/actions'
import { ExternalSignerControllers } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { AccountsController } from '../accounts/accounts'
import { EstimationController } from '../estimation/estimation'
import { GasPriceController } from '../gasPrice/gasPrice'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { PortfolioController } from '../portfolio/portfolio'
import { ProvidersController } from '../providers/providers'
import { SignAccountOpController } from './signAccountOp'

export class SignAccountOpTesterController extends SignAccountOpController {
  constructor(
    accounts: AccountsController,
    networks: NetworksController,
    providers: ProvidersController,
    keystore: KeystoreController,
    portfolio: PortfolioController,
    externalSignerControllers: ExternalSignerControllers,
    account: Account,
    accountState: AccountOnchainState,
    network: Network,
    provider: RPCProvider,
    fromActionId: AccountOpAction['id'],
    accountOp: AccountOp,
    isSignRequestStillActive: Function,
    traceCall: Function,
    estimateController: EstimationController,
    gasPriceController: GasPriceController
  ) {
    super(
      accounts,
      networks,
      providers,
      keystore,
      portfolio,
      externalSignerControllers,
      account,
      accountState,
      network,
      provider,
      fromActionId,
      accountOp,
      isSignRequestStillActive,
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
