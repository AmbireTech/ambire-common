/* eslint-disable class-methods-use-this */

import { BUNDLER } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { Bundler } from './bundler'
import { getBundlerByName, getDefaultBundler } from './getBundler'

export class BundlerSwitcher {
  protected network: Network

  protected bundler: Bundler

  protected usedBundlers: BUNDLER[] = []

  // a function to retrieve the current sign account op state
  protected getSignAccountOpStatus: Function

  // TODO:
  // no typehints here as importing typehints from signAccountOp causes
  // a dependancy cicle. Types should be removed from signAccountOp in
  // a different file before proceeding to fix this
  protected noStateUpdateStatuses: any[] = []

  constructor(network: Network, getSignAccountOpStatus: Function, noStateUpdateStatuses: any[]) {
    this.network = network
    this.bundler = getDefaultBundler(network)
    this.usedBundlers.push(this.bundler.getName())
    this.getSignAccountOpStatus = getSignAccountOpStatus
    this.noStateUpdateStatuses = noStateUpdateStatuses
  }

  protected hasBundlers() {
    const bundlers = this.network.erc4337.bundlers
    return bundlers && bundlers.length > 1
  }

  getBundler(): Bundler {
    return this.bundler
  }

  userHasCommitted(): boolean {
    return this.noStateUpdateStatuses.includes(this.getSignAccountOpStatus())
  }

  canSwitch(bundlerError: Error | null): boolean {
    // don't switch the bundler if the account op is in a state of signing
    if (this.userHasCommitted()) return false

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
