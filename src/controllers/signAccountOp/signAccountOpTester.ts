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
import { SignAccountOpType } from './helper'
import { OnBroadcastFailed, OnBroadcastSuccess, SignAccountOpController } from './signAccountOp'

export class SignAccountOpTesterController extends SignAccountOpController {
  constructor(props: {
    type?: SignAccountOpType
    callRelayer: Function
    accounts: IAccountsController
    networks: INetworksController
    keystore: IKeystoreController
    portfolio: IPortfolioController
    externalSignerControllers: ExternalSignerControllers
    account: Account
    network: Network
    activity: IActivityController
    provider: RPCProvider
    fromActionId: AccountOpAction['id']
    accountOp: AccountOp
    isSignRequestStillActive: Function
    shouldSimulate: boolean
    onAccountOpUpdate?: (updatedAccountOp: AccountOp) => void
    traceCall?: Function
    onBroadcastSuccess: OnBroadcastSuccess
    onBroadcastFailed?: OnBroadcastFailed
    estimateController: EstimationController
    gasPriceController: GasPriceController
  }) {
    super(props)

    // remove main handlers
    this.estimation.onUpdate(() => {})
    this.gasPrice.onUpdate(() => {})

    // assign easy to mock controllers
    this.estimation = props.estimateController
    this.gasPrice = props.gasPriceController
  }
}
