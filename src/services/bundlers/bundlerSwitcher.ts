/* eslint-disable class-methods-use-this */

import { BUNDLER } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { Bundler } from './bundler'
import { getBundlerByName, getDefaultBundler } from './getBundler'

export class BundlerSwitcher {
  protected network: Network

  protected bundler: Bundler

  protected usedBundlers: BUNDLER[] = []

  constructor(network: Network) {
    this.network = network
    this.bundler = getDefaultBundler(network)
    this.usedBundlers.push(this.bundler.getName())
  }

  protected hasBundlers() {
    const bundlers = this.network.erc4337.bundlers
    return bundlers && bundlers.length > 1
  }

  getBundler(): Bundler {
    return this.bundler
  }

  canSwitch(bundlerError: Error | null): boolean {
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
