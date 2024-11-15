// eslint-disable-next-line max-classes-per-file
import { concat, getBytes, zeroPadValue } from 'ethers'
import { ethers } from 'hardhat'

import { describe, expect } from '@jest/globals'

import { PANIC_ERROR_PREFIX } from './constants'
import { InnerCallFailureError } from './customErrors'
import { decodeError } from './errorDecoder'
import { DecodedError, ErrorType } from './types'

const TEST_MESSAGE_REVERT_DATA =
  '0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000c54657374206d6573736167650000000000000000000000000000000000000000'

const MockBundlerAndPaymasterError = class extends Error {
  public constructor(public shortMessage?: string) {
    super(`UserOperation reverted during simulation with reason: ${shortMessage}`)
  }
}

const MockRpcError = class extends Error {
  public constructor(
    public code?: string | number,
    public info?: { error: { code: number; message: string } },
    public shortMessage?: string
  ) {
    super(info?.error.message || shortMessage)
  }
}

describe('Error decoders work', () => {
  let contract: any

  beforeEach(async () => {
    const contractFactory = await ethers.getContractFactory('MockContract')
    contract = await contractFactory.deploy()
  })

  it('should handle PanicError correctly', async () => {
    try {
      await contract.panicUnderflow()
    } catch (e: any) {
      expect(e).toBeDefined()
      const decodedError = decodeError(e)

      expect(decodedError.type).toEqual(ErrorType.PanicError)

      const errorData = concat([PANIC_ERROR_PREFIX, zeroPadValue(getBytes('0x11'), 32)])
      expect(decodedError.data).toEqual(errorData)

      expect(decodedError.reason).toEqual(
        'Arithmetic operation underflowed or overflowed outside of an unchecked block'
      )
    }
  })
  describe('RpcErrorHandler', () => {
    it('should handle errors reverted not due to contract errors', async () => {
      let decodedError: DecodedError

      try {
        await contract.revertWithReason('Test message', {
          gasLimit: 100000,
          gasPrice: '1180820112192848923743894728934'
        })
      } catch (e: any) {
        expect(e).toBeDefined()
        decodedError = decodeError(e)
        expect(decodedError.type).toEqual(ErrorType.RpcError)
        expect(decodedError.reason).toContain("sender doesn't have enough funds to send tx")
        expect(decodedError.data).toBe('')
      }
    })
    describe('Prioritizes error code if string, otherwise fallbacks', () => {
      it('should use error code if string', async () => {
        const mockRpcError = new MockRpcError(
          'INSUFFICIENT_FUNDS',
          {
            error: {
              code: -32000,
              message: 'insufficient funds for gas * price + value: balance 0'
            }
          },
          'insufficient funds for intrinsic transaction cost'
        )

        const decodedError = decodeError(mockRpcError)

        expect(decodedError.reason).toEqual(mockRpcError.code)
      })

      it('should fallback to shortMessage if code is not a string', async () => {
        const mockRpcError = new MockRpcError(
          -32000,
          {
            error: {
              code: -32000,
              message: 'insufficient funds for gas * price + value: balance 0'
            }
          },
          'insufficient funds for intrinsic transaction cost'
        )
        const decodedError = decodeError(mockRpcError)

        expect(decodedError.reason).toEqual(mockRpcError.shortMessage)
      })
      it('should fallback to info error message if the code is not a string and there is no short message', async () => {
        const mockRpcError = new MockRpcError(
          -32000,
          {
            error: {
              code: -32000,
              message: 'insufficient funds for gas * price + value: balance 0'
            }
          },
          ''
        )
        const decodedError = decodeError(mockRpcError)

        expect(decodedError.reason).toEqual(mockRpcError.info?.error.message)
      })
    })
  })
  describe('InnerCallFailureHandler', () => {
    it('Error is decoded InnerCallFailureHandler it if not panic or revert', async () => {
      const error = new InnerCallFailureError('transfer amount exceeds balance')
      const decodedError = decodeError(error)

      expect(decodedError.type).toEqual(ErrorType.InnerCallFailureError)
      expect(decodedError.reason).toBe('transfer amount exceeds balance')
      expect(decodedError.data).toBe('transfer amount exceeds balance')
    })
    it("Error doesn't gets overwritten by Panic/Revert if it is panic or revert", async () => {
      const error = new InnerCallFailureError(TEST_MESSAGE_REVERT_DATA)
      const decodedError = decodeError(error)

      expect(decodedError.type).toEqual(ErrorType.RevertError)
      expect(decodedError.reason).toBe('Test message')
      expect(decodedError.data).toBe(TEST_MESSAGE_REVERT_DATA)
    })
  })
  it('should handle BundlerAndPaymasterError correctly', async () => {
    try {
      throw new MockBundlerAndPaymasterError('paymaster deposit too low')
    } catch (e: any) {
      expect(e).toBeDefined()
      const decodedError = decodeError(e)

      expect(decodedError.type).toEqual(ErrorType.BundlerAndPaymasterErrorHandler)
      expect(decodedError.reason).toBe('paymaster deposit too low')
      expect(decodedError.data).toBe('paymaster deposit too low')
    }
  })
  it('should handle RevertError correctly when reverted with reason', async () => {
    try {
      await contract.revertWithReason('Test message')
    } catch (e: any) {
      expect(e).toBeDefined()
      const decodedError = decodeError(e)

      expect(decodedError.type).toEqual(ErrorType.RevertError)
      expect(decodedError.data).toEqual(TEST_MESSAGE_REVERT_DATA)
      expect(decodedError.reason).toEqual('Test message')
    }
  })
  it('should handle UnknownError correctly when reverted without reason', async () => {
    try {
      await contract.revertWithoutReason()
    } catch (e: any) {
      expect(e).toBeDefined()
      const decodedError = decodeError(e)
      const errorData = '0x'

      expect(decodedError.type).toEqual(ErrorType.UnknownError)
      expect(decodedError.data).toEqual(errorData)
      expect(decodedError.reason).toBe('')
    }
  })
})
