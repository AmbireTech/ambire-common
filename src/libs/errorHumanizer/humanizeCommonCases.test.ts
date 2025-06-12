// eslint-disable-next-line max-classes-per-file
import { ethers } from 'hardhat'

import { describe, expect } from '@jest/globals'

import { suppressConsole } from '../../../test/helpers/console'
import { decodeError } from '../errorDecoder'
import { DecodedError, ErrorType } from '../errorDecoder/types'
import { RELAYER_DOWN_MESSAGE, RelayerError } from '../relayerCall/relayerCall'
import { insufficientPaymasterFunds } from './errors'
import { MESSAGE_PREFIX } from './estimationErrorHumanizer'
import { humanizeEstimationOrBroadcastError } from './humanizeCommonCases'

const MockBundlerError = class extends Error {
  public constructor(public shortMessage?: string) {
    super(`UserOperation reverted during simulation with decodedError: ${shortMessage}`)
  }
}

describe('Estimation/Broadcast common errors are humanized', () => {
  let contract: any

  beforeEach(async () => {
    const contractFactory = await ethers.getContractFactory('MockContract')
    contract = await contractFactory.deploy()
  })

  it('Expired swap (Uniswap)', async () => {
    try {
      await contract.revertWithReason('Transaction too old')
    } catch (error: any) {
      const decodedError = decodeError(error)
      const message = humanizeEstimationOrBroadcastError(decodedError, MESSAGE_PREFIX, error)

      expect(message).toBe(
        `${MESSAGE_PREFIX} the swap has expired. Return to the app and reinitiate the swap if you wish to proceed.`
      )
    }
  })
  it('Rpc timeout', () => {
    const error = new Error('rpc-timeout')
    const decodedError = decodeError(error)
    const message = humanizeEstimationOrBroadcastError(decodedError, MESSAGE_PREFIX, error)

    expect(message).toBe(
      `${MESSAGE_PREFIX} of a problem with the RPC on this network. Please try again later, change the RPC or contact support for assistance.`
    )
  })
  it('Paymaster deposit too low', async () => {
    const consoleSuppressor = suppressConsole()
    const error = new MockBundlerError('paymaster deposit too low')

    const decodedError = decodeError(error)
    const message = humanizeEstimationOrBroadcastError(decodedError, MESSAGE_PREFIX, error)

    expect(message).toBe(`${MESSAGE_PREFIX} ${insufficientPaymasterFunds}`)
    consoleSuppressor.restore()
  })
  it('Insufficient funds for gas', async () => {
    try {
      await contract.revertWithReason('insufficient funds')
    } catch (error: any) {
      const decodedError = decodeError(error)
      const message = humanizeEstimationOrBroadcastError(decodedError, MESSAGE_PREFIX, error)

      expect(message).toBe(
        `${MESSAGE_PREFIX} of insufficient funds for the transaction fee. Please add more fee tokens to your account and try again.`
      )
    }
  })
  it('Transfer amount exceeds balance', async () => {
    try {
      await contract.revertWithReason('transfer amount exceeds balance')
    } catch (error: any) {
      const decodedError = decodeError(error)
      const message = humanizeEstimationOrBroadcastError(decodedError, MESSAGE_PREFIX, error)

      expect(message).toBe(
        `${MESSAGE_PREFIX} the transfer amount exceeds your account balance. Please check your balance or adjust the transfer amount.`
      )
    }
  })
  it('Returns null for unhandled error', () => {
    const decodedError: DecodedError = {
      reason: 'nema pari',
      type: ErrorType.UnknownError,
      data: ''
    }

    const message = humanizeEstimationOrBroadcastError(
      decodedError,
      MESSAGE_PREFIX,
      new Error('nema pari')
    )

    expect(message).toBe(null)
  })
  it('Relayer is down', () => {
    const decodedError: DecodedError = {
      reason: RELAYER_DOWN_MESSAGE,
      type: ErrorType.RelayerError,
      data: ''
    }
    const message = humanizeEstimationOrBroadcastError(
      decodedError,
      MESSAGE_PREFIX,
      new Error(RELAYER_DOWN_MESSAGE)
    )

    expect(message).toBe(
      `${MESSAGE_PREFIX} the Ambire relayer is temporarily down.\nPlease try again or contact Ambire support for assistance.`
    )
  })
  it('Displays the error message provided by the relayer if it is marked as human-readable', () => {
    const error = new RelayerError('Gas tank balance too low', {}, {}, true)

    const decodedError = decodeError(error)

    const message = humanizeEstimationOrBroadcastError(decodedError, MESSAGE_PREFIX, error)
    expect(message).toBe('Gas tank balance too low')
  })
})
