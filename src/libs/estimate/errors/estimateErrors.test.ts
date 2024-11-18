// eslint-disable-next-line max-classes-per-file
import { ethers } from 'hardhat'

import { describe, expect } from '@jest/globals'

import { RELAYER_DOWN_MESSAGE } from '../../relayerCall/relayerCall'
import { humanizeEstimationError } from './index'

const MockBundlerAndPaymasterError = class extends Error {
  public constructor(public shortMessage?: string) {
    super(`UserOperation reverted during simulation with reason: ${shortMessage}`)
  }
}

describe('Estimation errors are humanized', () => {
  let contract: any

  beforeEach(async () => {
    const contractFactory = await ethers.getContractFactory('MockContract')
    contract = await contractFactory.deploy()
  })

  it('Expired swap (Uniswap)', async () => {
    try {
      await contract.revertWithReason('Transaction too old')
    } catch (error: any) {
      const humanizedError = humanizeEstimationError(error)

      expect(humanizedError.message).toBe(
        'The transaction cannot be sent because the swap has expired. Return to the dApp and reinitiate the swap if you wish to proceed.'
      )
    }
  })
  it('Rpc timeout', () => {
    const error = new Error('rpc-timeout')
    const humanizedError = humanizeEstimationError(error)

    expect(humanizedError.message).toBe(
      'There seems to be a problem with the RPC on this network. Please try again later, change the RPC or contact support for assistance.'
    )
  })
  it('Relayer error', () => {
    const error = new Error(RELAYER_DOWN_MESSAGE)
    const humanizedError = humanizeEstimationError(error)

    expect(humanizedError.message).toBe(
      'Transaction cannot be sent because the Ambire relayer is down. Please try again later or contact Ambire support for assistance.'
    )
  })
  it('Paymaster deposit too low', async () => {
    const error = new MockBundlerAndPaymasterError('paymaster deposit too low')

    const humanizedError = humanizeEstimationError(error)

    expect(humanizedError.message).toBe(
      'The transaction cannot be sent because the Paymaster has insufficient funds. Please select an alternative fee payment option or contact support for assistance.'
    )
  })
  it('Insufficient funds for gas', async () => {
    try {
      await contract.revertWithReason('insufficient funds')
    } catch (error: any) {
      const humanizedError = humanizeEstimationError(error)

      expect(humanizedError.message).toBe(
        'The transaction could not be sent due to insufficient funds for the transaction fee. Please add more fee tokens to your account and try again.'
      )
    }
  })
  it('Transfer amount exceeds balance', async () => {
    try {
      await contract.revertWithReason('transfer amount exceeds balance')
    } catch (error: any) {
      const humanizedError = humanizeEstimationError(error)

      expect(humanizedError.message).toBe(
        'The transaction failed because the transfer amount exceeds your account balance. Please reduce the transfer amount and try again.'
      )
    }
  })
})
