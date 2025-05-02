import { Account } from '../../interfaces/account'
import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { RPCProvider } from '../../interfaces/provider'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { AbstractPaymaster } from '../../libs/paymaster/abstractPaymaster'
import { Paymaster } from '../../libs/paymaster/paymaster'
import { UserOperation } from '../../libs/userOperation/types'
import { failedPaymasters } from './FailedPaymasters'

// a factory for creating paymaster objects
// this is needed as we'd like to create paymasters at will with easy
// access to app properties like relayerUrl and Fetch
// so we init the PaymasterFactory in the main controller and use it
// throught the app as a singleton
export class PaymasterFactory {
  relayerUrl: string | undefined

  fetch: Fetch | undefined

  errorCallback: Function | undefined = undefined

  init(relayerUrl: string, fetch: Fetch, errorCallback: Function) {
    this.relayerUrl = relayerUrl
    this.fetch = fetch
    this.errorCallback = errorCallback
  }

  async create(
    op: AccountOp,
    userOp: UserOperation,
    account: Account,
    network: Network,
    provider: RPCProvider
  ): Promise<AbstractPaymaster> {
    if (
      this.relayerUrl === undefined ||
      this.fetch === undefined ||
      this.errorCallback === undefined
    )
      throw new Error('call init first')

    // check whether the sponsorship has failed and if it has,
    // mark it like so in the meta for the paymaster to know
    const localOp = { ...op }
    const paymasterServiceId = op.meta?.paymasterService?.id
    if (paymasterServiceId && failedPaymasters.hasFailedSponsorship(paymasterServiceId)) {
      if (localOp.meta && localOp.meta.paymasterService) localOp.meta.paymasterService.failed = true
    }

    const paymaster = new Paymaster(this.relayerUrl, this.fetch, this.errorCallback)
    await paymaster.init(localOp, userOp, account, network, provider)
    return paymaster
  }
}
