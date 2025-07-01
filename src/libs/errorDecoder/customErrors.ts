/* eslint-disable max-classes-per-file */

import { isHexString } from 'ethers'

import { BUNDLER } from '../../consts/bundlers'
import { Network } from '../../interfaces/network'
import { Call } from '../accountOp/types'

class InnerCallFailureError extends Error {
  public data: string = ''

  public calls: Call[]

  public nativePortfolioValue: bigint | undefined

  public network: Network

  constructor(message: string, calls: Call[], network: Network, nativePortfolioValue?: bigint) {
    super(message)
    this.name = 'InnerCallFailureError'
    this.calls = calls
    this.network = network
    this.nativePortfolioValue = nativePortfolioValue
    // If the message is a hex string pass it to
    // the data field so it can be used by other error handlers
    if (isHexString(message)) {
      this.data = message
    }
  }
}

class RelayerPaymasterError extends Error {
  isHumanized: boolean

  constructor(error: any) {
    super(error.message)
    this.name = 'PaymasterError'
    this.message = error.message
    this.isHumanized = error.isHumanized || false
  }
}

class SponsorshipPaymasterError extends Error {
  isHumanized: boolean = false

  constructor() {
    const message = 'Sponsorship failed.'
    super(message)
    this.name = 'PaymasterSponsorshipError'
    this.message = message
  }
}

class BundlerError extends Error {
  bundlerName: BUNDLER

  constructor(message: string, bundlerName: BUNDLER) {
    super(message)
    this.bundlerName = bundlerName
    this.name = 'BundlerError'
    this.message = message
  }
}

export { BundlerError, InnerCallFailureError, RelayerPaymasterError, SponsorshipPaymasterError }
