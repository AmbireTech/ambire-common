// eslint-disable-next-line max-classes-per-file
import { concat, getBytes, zeroPadValue } from 'ethers'
import { ethers } from 'hardhat'

import { describe, expect } from '@jest/globals'

import { RELAYER_DOWN_MESSAGE } from '../relayerCall/relayerCall'
import { PANIC_ERROR_PREFIX } from './constants'
import { InnerCallFailureError, RelayerPaymasterError } from './customErrors'
import { decodeError } from './errorDecoder'
import { RPC_HARDCODED_ERRORS } from './handlers/rpc'
import { TRANSACTION_REJECTED_REASON } from './handlers/userRejection'
import { DecodedError, ErrorType } from './types'

const TEST_MESSAGE_REVERT_DATA =
  '0x08c379a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000c54657374206d6573736167650000000000000000000000000000000000000000'

const MockBundlerError = class extends Error {
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

  it('Should handle PanicError correctly', async () => {
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
    it('Should handle errors reverted not due to contract errors', async () => {
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
    it('Should handle predefined errors', async () => {
      const error = new MockRpcError(
        -32000,
        {
          error: {
            code: -32000,
            message: 'intrinsic gas too low: gas 0, minimum needed 21000'
          }
        },
        'could not coalesce error'
      )
      const decodedError = decodeError(error)

      expect(decodedError.type).toEqual(ErrorType.RpcError)
      expect(decodedError.reason).toBe(RPC_HARDCODED_ERRORS.lowGasLimit)
    })
    describe('Prioritizes error code if a valid reason, otherwise fallbacks', () => {
      it('Should use error code if string', async () => {
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

      it('Should fallback to shortMessage if code is not a string', async () => {
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
      it('Should fallback to info error message if the code is not a string and there is no short message', async () => {
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
  describe('Should handle BundlerError correctly', () => {
    it('Entry point error', () => {
      try {
        throw new MockBundlerError('AA31 paymaster deposit too low')
      } catch (e: any) {
        expect(e).toBeDefined()
        const decodedError = decodeError(e)

        expect(decodedError.type).toEqual(ErrorType.BundlerError)
        expect(decodedError.reason).toBe('paymaster deposit too low')
        expect(decodedError.data).toBe('paymaster deposit too low')
      }
    })
    it('pimlico_getUserOperationGasPrice', () => {
      try {
        throw new Error(
          "pimlico_getUserOperationGasPrice some information we don't care about 0x2314214"
        )
      } catch (e: any) {
        expect(e).toBeDefined()
        const decodedError = decodeError(e)

        expect(decodedError.type).toEqual(ErrorType.BundlerError)
        expect(decodedError.reason).toBe('pimlico_getUserOperationGasPrice')
        expect(decodedError.data).toBe('pimlico_getUserOperationGasPrice')
      }
    })
  })
  it('Should handle RevertError correctly when reverted with reason', async () => {
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
  describe('Should handle RelayerError correctly', () => {
    it('Relayer is down', async () => {
      try {
        throw new Error(RELAYER_DOWN_MESSAGE)
      } catch (e: any) {
        expect(e).toBeDefined()
        const decodedError = decodeError(e)

        expect(decodedError.type).toEqual(ErrorType.RelayerError)
        expect(decodedError.reason).toBe(RELAYER_DOWN_MESSAGE)
        expect(decodedError.data).toBe('')
      }
    })
    it('Relayer returns an RPC error as message', async () => {
      const error = new Error(
        '"Transaction too old" (action="estimateGas", data="0x08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000135472616e73616374696f6e20746f6f206f6c6400000000000000000000000000", reason="Transaction too old", transaction={ "data": "0x6171d1c9000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000004e000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000032000000000000000000000000068b3465833fb72a70ecdf485e0e4c7bd8665fc450000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000002445ae401dc00000000000000000000000000000000000000000000000000000000673b3e25000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000000000000001f40000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000c35000000000000000000000000000000000000000000000000001af5cbb4b149c38000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004449404b7c00000000000000000000000000000000000000000000000001af5cbb4b149c380000000000000000000000007544127fce3dd39a15b719abb93ca765d91ead6d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000942f9ce5d9a33a82f88d233aeb3292e6802303480000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000074f0dfef4cd1f200000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000767617354616e6b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006574d4154494300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042b1f9d3975aecfa6e646bef006f2ab88a131775543cb0321360633cef30dcce5b1c78936706c50fdb17469b8d8e546f22d68ab5c7a7d1e73649cd3ca8d9d3a1f81c01000000000000000000000000000000000000000000000000000000000000", "to": "0x7544127fCe3dd39A15b719abB93Ca765D91EAD6d" }, invocation=null, revert={ "args": [ "Transaction too old" ], "name": "Error", "signature": "Error(string)" }, code=CALL_EXCEPTION, version=6.7.1)'
      )

      const decodedError = decodeError(error)

      expect(decodedError.type).toEqual(ErrorType.RelayerError)
      expect(decodedError.reason).toBe('Transaction too old')
      expect(decodedError.data).toBe('')
    })
    it('Relayer returns a HEX RPC error as message which is then handled by RevertErrorHandler', async () => {
      const error = new Error(
        `"Transaction too old" (action="estimateGas", data="${TEST_MESSAGE_REVERT_DATA}", reason="", transaction={ "data": "0x6171d1c9000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000004e000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000032000000000000000000000000068b3465833fb72a70ecdf485e0e4c7bd8665fc450000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000002445ae401dc00000000000000000000000000000000000000000000000000000000673b3e25000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000c2132d05d31c914a87c6611c10748aeb04b58e8f0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000000000000001f40000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000c35000000000000000000000000000000000000000000000000001af5cbb4b149c38000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004449404b7c00000000000000000000000000000000000000000000000001af5cbb4b149c380000000000000000000000007544127fce3dd39a15b719abb93ca765d91ead6d0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000942f9ce5d9a33a82f88d233aeb3292e6802303480000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000e000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000074f0dfef4cd1f200000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000767617354616e6b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006574d4154494300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042b1f9d3975aecfa6e646bef006f2ab88a131775543cb0321360633cef30dcce5b1c78936706c50fdb17469b8d8e546f22d68ab5c7a7d1e73649cd3ca8d9d3a1f81c01000000000000000000000000000000000000000000000000000000000000", "to": "0x7544127fCe3dd39A15b719abB93Ca765D91EAD6d" }, invocation=null, revert={ "args": [ "Transaction too old" ], "name": "Error", "signature": "Error(string)" }, code=CALL_EXCEPTION, version=6.7.1)`
      )

      const decodedError = decodeError(error)

      expect(decodedError.type).toEqual(ErrorType.RevertError)
      expect(decodedError.reason).toBe('Test message')
      expect(decodedError.data).toBe(TEST_MESSAGE_REVERT_DATA)
    })
  })
  it('Should handle PaymasterError correctly', async () => {
    const error = new RelayerPaymasterError({
      errorState: [
        {
          message: 'user operation max fee per gas must be larger than 0 during gas estimation'
        }
      ]
    })

    const decodedError = decodeError(error)

    expect(decodedError.type).toEqual(ErrorType.PaymasterError)
    expect(decodedError.reason).toBe(
      'user operation max fee per gas must be larger than 0 during gas estimation'
    )
  })
  it('Should handle UnknownError correctly when reverted without reason', async () => {
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
  it('Should trim leading and trailing whitespaces from the reason', async () => {
    const error = new InnerCallFailureError('   transfer amount exceeds balance   ')
    const decodedError = decodeError(error)

    expect(decodedError.reason).toBe('transfer amount exceeds balance')
  })
  it('Should handle UserRejectionError correctly', async () => {
    const error = new MockRpcError(
      4001,
      {
        error: {
          code: 4001,
          message: 'User rejected the transaction request.'
        }
      },
      'User rejected the transaction request.'
    )
    const decodedError = decodeError(error)

    expect(decodedError.type).toEqual(ErrorType.UserRejectionHandler)
    expect(decodedError.reason).toBe(TRANSACTION_REJECTED_REASON)
  })
})
