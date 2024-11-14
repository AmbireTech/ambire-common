// eslint-disable-next-line max-classes-per-file
import { concat, getBytes, zeroPadValue } from 'ethers'
import { ethers } from 'hardhat'

import { describe, expect } from '@jest/globals'

import { PANIC_ERROR_PREFIX } from './constants'
import { InnerCallFailureError } from './customErrors'
import { decodeError } from './errorDecoder'
import { DecodedError, ErrorType } from './types'

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
  let decodedError: DecodedError

  beforeEach(async () => {
    const contractFactory = await ethers.getContractFactory('MockContract')
    contract = await contractFactory.deploy()
  })

  describe('PanicErrorHandler', () => {
    beforeEach(async () => {
      try {
        await contract.panicUnderflow()
      } catch (e: any) {
        expect(e).toBeDefined()
        decodedError = decodeError(e)
      }
    })

    it('should return error type as PanicError', async () => {
      expect(decodedError.type).toEqual(ErrorType.PanicError)
    })

    it('should return panic error data', async () => {
      const errorData = concat([PANIC_ERROR_PREFIX, zeroPadValue(getBytes('0x11'), 32)])

      expect(decodedError.data).toEqual(errorData)
    })

    it('should capture the panic error', async () => {
      expect(decodedError.reason).toEqual(
        'Arithmetic operation underflowed or overflowed outside of an unchecked block'
      )
    })
  })
  describe('RpcErrorHandler', () => {
    describe('Reverted not due to contract errors', () => {
      beforeEach(async () => {
        try {
          await contract.revertWithReason('Test message', {
            gasLimit: 100000,
            gasPrice: '1180820112192848923743894728934'
          })
        } catch (e: any) {
          expect(e).toBeDefined()
          decodedError = decodeError(e)
        }
      })

      it('should return error type as RpcError', async () => {
        expect(decodedError.type).toEqual(ErrorType.RpcError)
      })

      it('should return the error reason', async () => {
        expect(decodedError.reason).toContain("sender doesn't have enough funds to send tx")
      })

      it('should return data as null', async () => {
        expect(decodedError.data).toBe('')
      })
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

        decodedError = decodeError(mockRpcError)

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
        decodedError = decodeError(mockRpcError)

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
        decodedError = decodeError(mockRpcError)

        expect(decodedError.reason).toEqual(mockRpcError.info?.error.message)
      })
    })
  })
  describe('InnerCallFailureHandler', () => {
    beforeEach(async () => {
      try {
        throw new InnerCallFailureError('transfer amount exceeds balance')
      } catch (e: any) {
        expect(e).toBeDefined()
        decodedError = decodeError(e)
      }
    })

    it('should return error type as InnerCallFailureError', async () => {
      expect(decodedError.type).toEqual(ErrorType.InnerCallFailureError)
    })

    it('should return the error reason', async () => {
      expect(decodedError.reason).toBe('transfer amount exceeds balance')
    })

    it('should return data as null', async () => {
      expect(decodedError.data).toBe('')
    })
  })
  describe('BundlerAndPaymasterErrorHandler', () => {
    beforeEach(async () => {
      try {
        throw new MockBundlerAndPaymasterError('paymaster deposit too low')
      } catch (e: any) {
        expect(e).toBeDefined()
        decodedError = decodeError(e)
      }
    })

    it('should return error type as BundlerAndPaymasterErrorHandler', async () => {
      expect(decodedError.type).toEqual(ErrorType.BundlerAndPaymasterErrorHandler)
    })

    it('should return the error reason', async () => {
      expect(decodedError.reason).toBe('paymaster deposit too low')
    })

    it('should return data as null', async () => {
      expect(decodedError.data).toBe('')
    })
  })
  describe('RevertErrorHandler (reverted with reason)', () => {
    beforeEach(async () => {
      try {
        await contract.revertWithReason('Test message')
      } catch (e: any) {
        expect(e).toBeDefined()
        decodedError = decodeError(e)
      }
    })

    it('should return error type as RevertError', async () => {
      expect(decodedError.type).toEqual(ErrorType.RevertError)
    })

    it('should return revert error data', async () => {
      const errorData =
        '0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000c54657374206d6573736167650000000000000000000000000000000000000000'

      expect(decodedError.data).toEqual(errorData)
    })

    it('should capture the revert', async () => {
      expect(decodedError.reason).toEqual('Test message')
    })
  })
  describe('When reverted without reason (UnknownError)', () => {
    beforeEach(async () => {
      try {
        await contract.revertWithoutReason()
      } catch (e: any) {
        expect(e).toBeDefined()
        decodedError = decodeError(e)
      }
    })

    it('should return error type as UnknownError', async () => {
      expect(decodedError.type).toEqual(ErrorType.UnknownError)
    })

    it('should return revert error data', async () => {
      const errorData = '0x'

      expect(decodedError.data).toEqual(errorData)
    })

    it('should capture revert without reason', async () => {
      expect(decodedError.reason).toBe('')
    })
  })
})
