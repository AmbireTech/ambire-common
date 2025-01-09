/* eslint-disable class-methods-use-this */

import { Network } from '../../interfaces/network'
import { Bundler } from './bundler'
import { getBundlerByName, getDefaultBundler } from './getBundler'

export class BundlerSwitcher {
  #bundler: Bundler

  #network: Network

  #usedBundlers: string[] = []

  constructor(network: Network) {
    this.#network = network
    this.#bundler = getDefaultBundler(network)
    this.#usedBundlers.push(this.#bundler.getName())
  }

  #hasBundlers() {
    const bundlers = this.#network.erc4337.bundlers
    return bundlers && bundlers.length > 1
  }

  getBundler(): Bundler {
    return this.#bundler
  }

  canSwitch(estimationError: Error | null): boolean {
    if (!this.#hasBundlers()) return false

    const availableBundlers = this.#network.erc4337.bundlers!.filter((bundler) => {
      return this.#usedBundlers.indexOf(bundler) === -1
    })

    if (availableBundlers.length === 0) return false

    // TODO: think of all the appropriate conditions for estimation errors
    // where we can switch the bundler
    return !estimationError || estimationError.cause === 'biconomy: 400'
  }

  switch(): Bundler {
    if (!this.#hasBundlers()) {
      throw new Error('no available bundlers to switch')
    }

    const availableBundlers = this.#network.erc4337.bundlers!.filter((bundler) => {
      return this.#usedBundlers.indexOf(bundler) === -1
    })
    this.#bundler = getBundlerByName(availableBundlers[0])
    this.#usedBundlers.push(this.#bundler.getName())
    return this.#bundler
  }
}
