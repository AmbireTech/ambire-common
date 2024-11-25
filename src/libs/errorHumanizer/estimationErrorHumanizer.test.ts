// eslint-disable-next-line max-classes-per-file
import { ethers } from 'hardhat'

import { describe, expect } from '@jest/globals'

import { MESSAGE_PREFIX } from './estimationErrorHumanizer'
import { getHumanReadableEstimationError } from './index'

describe('Estimation errors are humanized', () => {
  let contract: any

  beforeEach(async () => {
    const contractFactory = await ethers.getContractFactory('MockContract')
    contract = await contractFactory.deploy()
  })

  it('Insufficient privilege', async () => {
    const EXPECTED_MESSAGE = `${MESSAGE_PREFIX} your account key lacks the necessary permissions. Ensure that you have authorization to sign or use an account with sufficient privileges.`

    try {
      await contract.revertWithReason('SPOOF_ERROR')
    } catch (error: any) {
      const humanizedError = getHumanReadableEstimationError(error)

      expect(humanizedError.message).toBe(EXPECTED_MESSAGE)
    }
    try {
      await contract.revertWithReason('INSUFFICIENT_PRIVILEGE')
    } catch (error: any) {
      const humanizedError = getHumanReadableEstimationError(error)

      expect(humanizedError.message).toBe(EXPECTED_MESSAGE)
    }
  })
})