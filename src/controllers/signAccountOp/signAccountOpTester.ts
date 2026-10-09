import { Account, IAccountsController } from '../../interfaces/account'
import { IActivityController } from '../../interfaces/activity'
import { IDappsController } from '../../interfaces/dapp'
import { IErc7730Controller } from '../../interfaces/erc7730'
import { IFeatureFlagsController } from '../../interfaces/featureFlags'
import { ExternalSignerControllers, IKeystoreController } from '../../interfaces/keystore'
import { INetworksController, Network } from '../../interfaces/network'
import { IPhishingController } from '../../interfaces/phishing'
import { Platform } from '../../interfaces/platform'
import { IPortfolioController } from '../../interfaces/portfolio'
import { RPCProvider } from '../../interfaces/provider'
import { UserRequest } from '../../interfaces/userRequest'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { BindedRelayerCall } from '../../libs/relayerCall/relayerCall'
import { EstimationController } from '../estimation/estimation'
import { GasPriceController } from '../gasPrice/gasPrice'
import { SignAccountOpType } from './helper'
import { OnBroadcastFailed, OnBroadcastSuccess, SignAccountOpController } from './signAccountOp'
import { SignAccountOpPreferenceController } from './signAccountOpPreference'

export class SignAccountOpTesterController extends SignAccountOpController {
  /**
   * The gas price controller built by the parent constructor. The parent attaches its
   * gas price update handler to it before the mocked one is swapped in below
   */
  #ownGasPriceController: GasPriceController

  constructor(props: {
    type?: SignAccountOpType
    callRelayer: BindedRelayerCall
    erc7730: IErc7730Controller
    accounts: IAccountsController
    networks: INetworksController
    keystore: IKeystoreController
    portfolio: IPortfolioController
    featureFlags: IFeatureFlagsController
    platform: Platform
    signAccountOpPreference: SignAccountOpPreferenceController
    externalSignerControllers: ExternalSignerControllers
    account: Account
    network: Network
    activity: IActivityController
    dapps: IDappsController
    provider: RPCProvider
    fromRequestId: UserRequest['id']
    accountOp: AccountOp
    shouldSimulate: boolean
    traceCall?: Function
    onUpdateAfterTraceCallSuccess?: () => Promise<void>
    onBroadcastSuccess: OnBroadcastSuccess
    onBroadcastFailed?: OnBroadcastFailed
    estimateController: EstimationController
    gasPriceController: GasPriceController
    phishing: IPhishingController
  }) {
    super(props)

    // remove main handlers
    this.estimation.onUpdate(() => {})
    this.gasPrice.onUpdate(() => {})

    // assign easy to mock controllers
    this.#ownGasPriceController = this.gasPrice
    this.estimation = props.estimateController
    this.gasPrice = props.gasPriceController
  }

  /**
   * Runs the parent's gas price update handler, as a gas price fetch would.
   * The handler reads the gas prices from the swapped in (mocked) gasPrice controller
   */
  async emitGasPriceUpdate() {
    await this.#ownGasPriceController.forceEmitUpdate()
  }
}
