import { Fetch } from '../../interfaces/fetch'
import { Network } from '../../interfaces/network'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { Paymaster } from '../../libs/paymaster/paymaster'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { UserOperation } from '../../libs/userOperation/types'

// a factory for creating paymaster objects
// this is needed as we'd like to create paymasters at will with easy
// access to app properties like relayerUrl and Fetch
// so we init the PaymasterFactory in the main controller and use it
// throught the app as a singleton
class PaymasterFactory {
  callRelayer: Function | undefined = undefined

  init(relayerUrl: string, fetch: Fetch) {
    this.callRelayer = relayerCall.bind({ url: relayerUrl, fetch })
  }

  async create(op: AccountOp, userOp: UserOperation, network: Network): Promise<Paymaster> {
    if (this.callRelayer === undefined) throw new Error('call init first')

    const paymaster = new Paymaster(this.callRelayer)
    await paymaster.init(op, userOp, network)
    return paymaster
  }
}

export const paymasterFactory = new PaymasterFactory()
