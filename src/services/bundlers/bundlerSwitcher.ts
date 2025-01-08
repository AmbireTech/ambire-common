/* eslint-disable class-methods-use-this */

import { Network } from '../../interfaces/network'
import { AccountOp, isAccountOpsIntentEqual } from '../../libs/accountOp/accountOp'
import { Erc4337GasLimits } from '../../libs/estimate/interfaces'
import { Bundler } from './bundler'
import { getBundlerByName, getDefaultBundler } from './getBundler'

export class BundlerSwitcher {
  op: AccountOp | undefined

  getBundler(accountOp: AccountOp, estimation4337: Erc4337GasLimits, network: Network): Bundler {
    const bundlers = network.erc4337.bundlers

    // use the default network bundler
    // if this is the first request for this account op (!this.op)
    // or the account op has changed (!isAccountOpsIntentEqual)
    // or there are no fallback bundlers
    if (
      !this.op ||
      !isAccountOpsIntentEqual([this.op], [accountOp]) ||
      !bundlers ||
      bundlers.length < 2
    ) {
      this.op = accountOp
      return getDefaultBundler(network)
    }

    const availableBundlers = [...bundlers]
    const index = availableBundlers.indexOf(estimation4337.bundler)
    availableBundlers.splice(index, 1)
    return getBundlerByName(availableBundlers[0])
  }
}
