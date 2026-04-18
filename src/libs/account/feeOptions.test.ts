import { Interface, ZeroAddress } from 'ethers'

import IERC20 from '../../../contracts/compiled/IERC20.json'
import { AccountOp } from '../accountOp/accountOp'
import { FeePaymentOption } from '../estimate/interfaces'
import { isTransferredTokenFeeOption } from './feeOptions'

const ERC20Interface = new Interface(IERC20.abi)

describe('account fee options', () => {
  test('should keep the same token when the op transfers it out', () => {
    const op = {
      accountAddr: '0x1111111111111111111111111111111111111111',
      meta: {
        allowTransferFeeTokenSelfReserve: true
      },
      calls: [
        {
          to: '0x2222222222222222222222222222222222222222',
          value: 0n,
          data: ERC20Interface.encodeFunctionData('transfer', [
            '0x3333333333333333333333333333333333333333',
            15_000_000n
          ])
        }
      ]
    } as AccountOp

    const feeOption = {
      paidBy: op.accountAddr,
      availableAmount: 0n,
      gasUsed: 0n,
      addedNative: 0n,
      token: {
        address: '0x2222222222222222222222222222222222222222',
        flags: {
          onGasTank: false
        }
      }
    } as FeePaymentOption

    expect(isTransferredTokenFeeOption(feeOption, op)).toBe(true)
  })

  test('should not keep unrelated zero-balance fee tokens', () => {
    const op = {
      accountAddr: '0x1111111111111111111111111111111111111111',
      meta: {
        allowTransferFeeTokenSelfReserve: true
      },
      calls: [
        {
          to: '0x2222222222222222222222222222222222222222',
          value: 0n,
          data: ERC20Interface.encodeFunctionData('transfer', [
            '0x3333333333333333333333333333333333333333',
            15_000_000n
          ])
        }
      ]
    } as AccountOp

    const feeOption = {
      paidBy: op.accountAddr,
      availableAmount: 0n,
      gasUsed: 0n,
      addedNative: 0n,
      token: {
        address: '0x4444444444444444444444444444444444444444',
        flags: {
          onGasTank: false
        }
      }
    } as FeePaymentOption

    expect(isTransferredTokenFeeOption(feeOption, op)).toBe(false)
  })

  test('should keep the native token when the op transfers native value', () => {
    const op = {
      accountAddr: '0x1111111111111111111111111111111111111111',
      meta: {
        allowTransferFeeTokenSelfReserve: true
      },
      calls: [
        {
          to: '0x3333333333333333333333333333333333333333',
          value: 15_000_000_000_000_000n,
          data: '0x'
        }
      ]
    } as AccountOp

    const feeOption = {
      paidBy: op.accountAddr,
      availableAmount: 0n,
      gasUsed: 0n,
      addedNative: 0n,
      token: {
        address: ZeroAddress,
        flags: {
          onGasTank: false
        }
      }
    } as FeePaymentOption

    expect(isTransferredTokenFeeOption(feeOption, op)).toBe(true)
  })

  test('should not keep the native token when no native value is transferred', () => {
    const op = {
      accountAddr: '0x1111111111111111111111111111111111111111',
      meta: {
        allowTransferFeeTokenSelfReserve: true
      },
      calls: [
        {
          to: '0x3333333333333333333333333333333333333333',
          value: 0n,
          data: ERC20Interface.encodeFunctionData('transfer', [
            '0x4444444444444444444444444444444444444444',
            15_000_000n
          ])
        }
      ]
    } as AccountOp

    const feeOption = {
      paidBy: op.accountAddr,
      availableAmount: 0n,
      gasUsed: 0n,
      addedNative: 0n,
      token: {
        address: ZeroAddress,
        flags: {
          onGasTank: false
        }
      }
    } as FeePaymentOption

    expect(isTransferredTokenFeeOption(feeOption, op)).toBe(false)
  })

  test('should not keep the transferred token outside the direct transfer controller flow', () => {
    const op = {
      accountAddr: '0x1111111111111111111111111111111111111111',
      calls: [
        {
          to: '0x2222222222222222222222222222222222222222',
          value: 0n,
          data: ERC20Interface.encodeFunctionData('transfer', [
            '0x3333333333333333333333333333333333333333',
            15_000_000n
          ])
        }
      ]
    } as AccountOp

    const feeOption = {
      paidBy: op.accountAddr,
      availableAmount: 0n,
      gasUsed: 0n,
      addedNative: 0n,
      token: {
        address: '0x2222222222222222222222222222222222222222',
        flags: {
          onGasTank: false
        }
      }
    } as FeePaymentOption

    expect(isTransferredTokenFeeOption(feeOption, op)).toBe(false)
  })
})
