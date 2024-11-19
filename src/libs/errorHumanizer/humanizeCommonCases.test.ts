// eslint-disable-next-line max-classes-per-file
import { ethers } from 'hardhat'

import { describe, expect } from '@jest/globals'

import { decodeError } from '../errorDecoder'
import { ErrorType } from '../errorDecoder/types'
import { RELAYER_DOWN_MESSAGE } from '../relayerCall/relayerCall'
import { MESSAGE_PREFIX } from './estimationErrorHumanizer'
import {
  getGenericMessageFromType,
  humanizeEstimationOrBroadcastError
} from './humanizeCommonCases'

const MockBundlerError = class extends Error {
  public constructor(public shortMessage?: string) {
    super(`UserOperation reverted during simulation with reason: ${shortMessage}`)
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
      const { reason } = decodeError(error)
      const message = humanizeEstimationOrBroadcastError(reason, MESSAGE_PREFIX)

      expect(message).toBe(
        `${MESSAGE_PREFIX} the swap has expired. Return to the dApp and reinitiate the swap if you wish to proceed.`
      )
    }
  })
  it('Rpc timeout', () => {
    const error = new Error('rpc-timeout')
    const { reason } = decodeError(error)
    const message = humanizeEstimationOrBroadcastError(reason, MESSAGE_PREFIX)

    expect(message).toBe(
      `${MESSAGE_PREFIX} of a problem with the RPC on this network. Please try again later, change the RPC or contact support for assistance.`
    )
  })
  it('Paymaster deposit too low', async () => {
    const error = new MockBundlerError('paymaster deposit too low')

    const { reason } = decodeError(error)
    const message = humanizeEstimationOrBroadcastError(reason, MESSAGE_PREFIX)

    expect(message).toBe(
      `${MESSAGE_PREFIX} the Paymaster has insufficient funds. Please select an alternative fee payment option or contact support for assistance.`
    )
  })
  it('Insufficient funds for gas', async () => {
    try {
      await contract.revertWithReason('insufficient funds')
    } catch (error: any) {
      const { reason } = decodeError(error)
      const message = humanizeEstimationOrBroadcastError(reason, MESSAGE_PREFIX)

      expect(message).toBe(
        `${MESSAGE_PREFIX} to insufficient funds for the transaction fee. Please add more fee tokens to your account and try again.`
      )
    }
  })
  it('Transfer amount exceeds balance', async () => {
    try {
      await contract.revertWithReason('transfer amount exceeds balance')
    } catch (error: any) {
      const { reason } = decodeError(error)
      const message = humanizeEstimationOrBroadcastError(reason, MESSAGE_PREFIX)

      expect(message).toBe(
        `${MESSAGE_PREFIX} the transfer amount exceeds your account balance. Please reduce the transfer amount and try again.`
      )
    }
  })
  it('Returns null for unhandled error', () => {
    const reason = 'nema pari'

    const message = humanizeEstimationOrBroadcastError(reason, MESSAGE_PREFIX)

    expect(message).toBe(null)
  })
  it('Relayer is down', () => {
    const message = humanizeEstimationOrBroadcastError(RELAYER_DOWN_MESSAGE, MESSAGE_PREFIX)

    expect(message).toBe(
      `${MESSAGE_PREFIX} the Ambire relayer is down.\nPlease try again or contact Ambire support for assistance.`
    )
  })
})
describe('Generic error fallbacks work', () => {
  it('RPC error', () => {
    const messageWithCode = getGenericMessageFromType(
      ErrorType.RpcError,
      'Unsupported method',
      MESSAGE_PREFIX,
      ''
    )
    const messageWithoutCode = getGenericMessageFromType(
      ErrorType.RpcError,
      null,
      MESSAGE_PREFIX,
      ''
    )

    expect(messageWithCode).toBe(
      `${MESSAGE_PREFIX} of an RPC error. Error code: Unsupported method\nPlease try again or contact Ambire support for assistance.`
    )
    expect(messageWithoutCode).toBe(
      `${MESSAGE_PREFIX} of an RPC error.\nPlease try again or contact Ambire support for assistance.`
    )
  })
  it('Relayer error', () => {
    const message = getGenericMessageFromType(ErrorType.RelayerError, null, MESSAGE_PREFIX, '')

    expect(message).toBe(
      `${MESSAGE_PREFIX} of an Ambire Relayer error.\nPlease try again or contact Ambire support for assistance.`
    )
  })
  it('Null error type', () => {
    const LAST_RESORT_ERROR_MESSAGE =
      'An unknown error occurred while estimating the transaction. Please try again or contact Ambire support for assistance.'
    // @ts-ignore
    const message = getGenericMessageFromType(null, null, MESSAGE_PREFIX, LAST_RESORT_ERROR_MESSAGE)

    expect(message).toBe(LAST_RESORT_ERROR_MESSAGE)
  })
})
