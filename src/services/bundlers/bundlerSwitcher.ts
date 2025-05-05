/* eslint-disable class-methods-use-this */

import { BUNDLER } from '../../consts/bundlers'
import { Account } from '../../interfaces/account'
import { Network } from '../../interfaces/network'
import { Bundler } from './bundler'
import { getBundlerByName, getDefaultBundler } from './getBundler'

export class BundlerSwitcher {
  protected network: Network

  protected bundler: Bundler

  protected usedBundlers: BUNDLER[] = []

  /**
   * This service is stateless so we're allowing a method
   * to jump in and forbid updates if the controller state forbids them
   */
  hasControllerForbiddenUpdates: Function

  constructor(network: Network, hasControllerForbiddenUpdates: Function) {
    this.network = network
    this.bundler = getDefaultBundler(network)
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

  canSwitch(acc: Account, bundlerError: Error | null): boolean {
    // no fallbacks for EOAs
    if (!acc.creation) return false

    // don't switch the bundler if the account op is in a state of signing
    if (this.hasControllerForbiddenUpdates()) return false

    if (!this.hasBundlers()) return false

    const availableBundlers = this.network.erc4337.bundlers!.filter((bundler) => {
      return this.usedBundlers.indexOf(bundler) === -1
    })

    if (availableBundlers.length === 0) return false

    return (
      !bundlerError ||
      bundlerError.cause === 'biconomy: 400' ||
      bundlerError.cause === 'pimlico: 500'
    )
  }

  switch(): Bundler {
    if (!this.hasBundlers()) {
      throw new Error('no available bundlers to switch')
    }

    const availableBundlers = this.network.erc4337.bundlers!.filter((bundler) => {
      return this.usedBundlers.indexOf(bundler) === -1
    })
    this.bundler = getBundlerByName(availableBundlers[0])
    this.usedBundlers.push(this.bundler.getName())
    return this.bundler
  }
}
