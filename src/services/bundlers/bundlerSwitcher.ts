/* eslint-disable class-methods-use-this */

import { BUNDLER } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { BaseAccount } from '../../libs/account/BaseAccount'
import { BROADCAST_OPTIONS } from '../../libs/broadcast/broadcast'
import { Bundler } from './bundler'
import { getAvailableBunlders, getDefaultBundler } from './getBundler'

export class BundlerSwitcher {
  protected network: Network

  protected bundler: Bundler

  protected usedBundlers: BUNDLER[] = []

  /**
   * This service is stateless so we're allowing a method
   * to jump in and forbid updates if the controller state forbids them
   */
  hasControllerForbiddenUpdates: Function

  constructor(
    network: Network,
    hasControllerForbiddenUpdates: Function,
    opts: { canDelegate: boolean } = { canDelegate: false }
  ) {
    this.network = network
    this.bundler = getDefaultBundler(network, opts)
    this.usedBundlers.push(this.bundler.getName())
    this.hasControllerForbiddenUpdates = hasControllerForbiddenUpdates
  }

  protected hasBundlers() {
    const bundlers = this.network.erc4337.bundlers
    return bundlers && bundlers.length > 1
  }

  getBundler(): Bundler {
    return this.bundler
  }

  canSwitch(baseAcc: BaseAccount): boolean {
    // don't switch the bundler if the account op is in a state of signing
    if (this.hasControllerForbiddenUpdates()) return false

    if (!this.hasBundlers()) return false

    const availableBundlers = getAvailableBunlders(this.network).filter((bundler) => {
      return this.usedBundlers.indexOf(bundler.getName()) === -1
    })

    if (availableBundlers.length === 0) return false

    // only pimlico can do txn type 4 and if pimlico is
    // not working, we have nothing to fallback to
    if (baseAcc.shouldSignAuthorization(BROADCAST_OPTIONS.byBundler)) return false

    return true
  }

  switch(): Bundler {
    if (!this.hasBundlers()) {
      throw new Error('no available bundlers to switch')
    }

    const availableBundlers = getAvailableBunlders(this.network).filter((bundler) => {
      return this.usedBundlers.indexOf(bundler.getName()) === -1
    })
    this.bundler = availableBundlers[0]
    this.usedBundlers.push(this.bundler.getName())
    return this.bundler
  }
}
