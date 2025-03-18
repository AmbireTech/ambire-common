/* eslint-disable class-methods-use-this */
import { getBaseAccount } from '../../libs/account/getBaseAccount'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { getEstimation } from '../../libs/estimate/estimate'
import { FullEstimation } from '../../libs/estimate/interfaces'
import { isPortfolioGasTankResult } from '../../libs/portfolio/helpers'
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher'
import { getIsViewOnly } from '../../utils/accounts'
import { AccountsController } from '../accounts/accounts'
import EventEmitter from '../eventEmitter/eventEmitter'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { PortfolioController } from '../portfolio/portfolio'
import { ProvidersController } from '../providers/providers'

export class EstimationController extends EventEmitter {
  #keystore: KeystoreController

  #accounts: AccountsController

  #networks: NetworksController

  #providers: ProvidersController

  #portfolio: PortfolioController

  #errorCallback: Function

  // this is mainly for the bundler switcher but in general
  // if the estimation wants to know the status of the outside
  // controller, this is the function to set up intiially
  #getOutsideControllerStatus: Function = () => {}

  // this is mainly for the bundler switcher but in general
  // if the estimation wants to know on which statuses in should
  // disregard updates, this is the place
  #outsideControllerNoUpdateStatuses: any[] = []

  constructor(
    keystore: KeystoreController,
    accounts: AccountsController,
    networks: NetworksController,
    providers: ProvidersController,
    portfolio: PortfolioController,
    errorCallback: Function,
    getOutsideControllerStatus?: Function,
    outsideControllerNoUpdateStatuses?: any[]
  ) {
    super()
    this.#keystore = keystore
    this.#accounts = accounts
    this.#networks = networks
    this.#providers = providers
    this.#portfolio = portfolio
    this.#errorCallback = errorCallback
    if (getOutsideControllerStatus) this.#getOutsideControllerStatus = getOutsideControllerStatus
    if (outsideControllerNoUpdateStatuses)
      this.#outsideControllerNoUpdateStatuses = outsideControllerNoUpdateStatuses
  }

  async estimate(op: AccountOp): Promise<FullEstimation | Error> {
    const account = this.#accounts.accounts.find((acc) => acc.addr === op.accountAddr)!
    const network = this.#networks.networks.find((net) => net.id === op.networkId)!
    const accountState = await this.#accounts.getOrFetchAccountOnChainState(
      op.accountAddr,
      op.networkId
    )
    const baseAcc = getBaseAccount(
      account,
      accountState,
      this.#keystore.getAccountKeys(account),
      network
    )

    // Take the fee tokens from two places: the user's tokens and his gasTank
    // The gasTank tokens participate on each network as they belong everywhere
    // NOTE: at some point we should check all the "?" signs below and if
    // an error pops out, we should notify the user about it
    const networkFeeTokens =
      this.#portfolio.getLatestPortfolioState(op.accountAddr)?.[op.networkId]?.result?.feeTokens ??
      []
    const gasTankResult = this.#portfolio.getLatestPortfolioState(op.accountAddr)?.gasTank?.result
    const gasTankFeeTokens = isPortfolioGasTankResult(gasTankResult)
      ? gasTankResult.gasTankTokens
      : []
    const feeTokens =
      [...networkFeeTokens, ...gasTankFeeTokens].filter((t) => t.flags.isFeeToken) || []

    // Here, we list EOA accounts for which you can also obtain an estimation of the AccountOp payment.
    // In the case of operating with a smart account (an account with creation code), all other EOAs can pay the fee.
    //
    // If the current account is an EOA, only this account can pay the fee,
    // and there's no need for checking other EOA accounts native balances.
    // This is already handled and estimated as a fee option in the estimate library, which is why we pass an empty array here.
    //
    // we're excluding the view only accounts from the natives to check
    // in all cases EXCEPT the case where we're making an estimation for
    // the view only account itself. In all other, view only accounts options
    // should not be present as the user cannot pay the fee with them (no key)
    const nativeToCheck = account.creation
      ? this.#accounts.accounts
          .filter(
            (acc) =>
              !acc.creation &&
              (acc.addr === op.accountAddr ||
                !getIsViewOnly(this.#keystore.keys, acc.associatedKeys))
          )
          .map((acc) => acc.addr)
      : []

    // configure the bundler switcher for the network if any
    const bundlerSwitcher = new BundlerSwitcher(
      network,
      this.#getOutsideControllerStatus,
      this.#outsideControllerNoUpdateStatuses
    )
    return getEstimation(
      baseAcc,
      accountState,
      op,
      network,
      this.#providers.providers[op.networkId],
      feeTokens,
      nativeToCheck,
      bundlerSwitcher,
      this.#errorCallback
    ).catch((e) => e)
  }
}
