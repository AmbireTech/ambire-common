import { toBeHex } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import { Hex } from '../../interfaces/hex'
import { IActivityController } from '../../interfaces/activity'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { AccountOpStatus } from '../../libs/accountOp/types'
import { FeePaymentOption } from '../../libs/estimate/interfaces'
import { GasSpeeds } from '../../services/bundlers/types'
import { SpeedUp } from './speedUp'

const accountAddr = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
const otherAddr = '0x1111111111111111111111111111111111111111'
const usdcAddr = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const replacedIdentifiedBy = { type: 'Transaction' as const, identifier: `0x${'ab'.repeat(32)}` }

const createAccountOp = (overrides: Partial<AccountOp> = {}): AccountOp =>
  ({
    accountAddr,
    chainId: 1n,
    calls: [],
    gasFeePayment: {
      paidBy: accountAddr,
      inToken: '0x0000000000000000000000000000000000000000',
      feeTokenChainId: 1n,
      isGasTank: false,
      amount: 1000n,
      gasPrice: 100n,
      maxPriorityFeePerGas: 10n,
      simulatedGasLimit: 21000n,
      broadcastOption: 'bySelf',
      paidByKeyType: 'internal'
    },
    meta: {
      speedUp: {
        enabled: true,
        replacedFees: { gasPrice: 100n, maxPriorityFeePerGas: 10n, amount: 1000n },
        replacedIdentifiedBy
      }
    },
    ...overrides
  }) as AccountOp

/** An activity controller double that lets a test trigger updates and set the op status */
const createActivity = (initialStatus?: AccountOpStatus) => {
  let status = initialStatus
  let listener: (() => void) | undefined
  const unsubscribe = jest.fn(() => {
    listener = undefined
  })
  const activity = {
    onUpdate: jest.fn((cb: () => void) => {
      listener = cb
      return unsubscribe
    }),
    findByIdentifiedBy: jest.fn(() => (status ? { status } : undefined))
  }

  return {
    activity: activity as unknown as IActivityController,
    findByIdentifiedBy: activity.findByIdentifiedBy,
    unsubscribe,
    setStatus: (newStatus: AccountOpStatus) => {
      status = newStatus
    },
    emitUpdate: () => listener?.()
  }
}

const createFeeOption = (
  paidBy: string,
  tokenAddress: string,
  { onGasTank = false, chainId = 1n }: { onGasTank?: boolean; chainId?: bigint } = {}
) =>
  ({
    paidBy,
    token: { address: tokenAddress, chainId, flags: { onGasTank } }
  }) as FeePaymentOption

const toGas = (maxFeePerGas: bigint, maxPriorityFeePerGas: bigint) => ({
  maxFeePerGas: toBeHex(maxFeePerGas) as Hex,
  maxPriorityFeePerGas: toBeHex(maxPriorityFeePerGas) as Hex
})

describe('SpeedUp', () => {
  describe('isSpeedUp', () => {
    test('is true only for account ops marked as a speed up', () => {
      expect(SpeedUp.isSpeedUp(createAccountOp())).toBe(true)
      expect(SpeedUp.isSpeedUp(createAccountOp({ meta: {} }))).toBe(false)
      expect(SpeedUp.isSpeedUp(createAccountOp({ meta: undefined }))).toBe(false)
      expect(SpeedUp.isSpeedUp(createAccountOp({ meta: { speedUp: { enabled: false } } }))).toBe(
        false
      )
    })
  })

  describe('applyMinFees', () => {
    test('raises the speeds below the minimum and keeps the ones above it', () => {
      const speedUp = new SpeedUp({
        accountOp: createAccountOp(),
        activity: createActivity().activity
      })
      const gasPrices: GasSpeeds = {
        slow: toGas(50n, 5n),
        medium: toGas(200n, 20n),
        fast: toGas(300n, 30n),
        ape: toGas(400n, 40n)
      }

      const result = speedUp.applyMinFees(gasPrices)!

      // 12.5% above 100 and 10, rounded up
      expect(BigInt(result.slow.maxFeePerGas)).toBe(113n)
      expect(BigInt(result.slow.maxPriorityFeePerGas)).toBe(12n)
      expect(BigInt(result.medium.maxFeePerGas)).toBe(200n)
      expect(BigInt(result.medium.maxPriorityFeePerGas)).toBe(20n)
    })

    test('returns no gas prices when there are none yet', () => {
      const speedUp = new SpeedUp({
        accountOp: createAccountOp(),
        activity: createActivity().activity
      })

      expect(speedUp.applyMinFees(undefined)).toBeUndefined()
    })

    test('keeps the gas prices as they are when the replaced fees are unknown', () => {
      const speedUp = new SpeedUp({
        accountOp: createAccountOp({ meta: { speedUp: { enabled: true } } }),
        activity: createActivity().activity
      })
      const gasPrices: GasSpeeds = {
        slow: toGas(1n, 1n),
        medium: toGas(1n, 1n),
        fast: toGas(1n, 1n),
        ape: toGas(1n, 1n)
      }

      expect(speedUp.applyMinFees(gasPrices)).toBe(gasPrices)
    })
  })

  describe('findReplacedFeeOption', () => {
    const nativeOption = createFeeOption(accountAddr, '0x0000000000000000000000000000000000000000')

    test('finds the option the pending transaction was paid with', () => {
      const speedUp = new SpeedUp({
        accountOp: createAccountOp(),
        activity: createActivity().activity
      })
      const options = [
        createFeeOption(accountAddr, usdcAddr),
        createFeeOption(otherAddr, '0x0000000000000000000000000000000000000000'),
        nativeOption
      ]

      expect(speedUp.findReplacedFeeOption(options)).toBe(nativeOption)
    })

    test('does not mix up the gas tank with the same token in the account', () => {
      const speedUp = new SpeedUp({
        accountOp: createAccountOp(),
        activity: createActivity().activity
      })
      const gasTankOption = createFeeOption(
        accountAddr,
        '0x0000000000000000000000000000000000000000',
        {
          onGasTank: true
        }
      )

      expect(speedUp.findReplacedFeeOption([gasTankOption])).toBeUndefined()
    })

    test('does not match the same token on another network', () => {
      const speedUp = new SpeedUp({
        accountOp: createAccountOp(),
        activity: createActivity().activity
      })
      const otherChainOption = createFeeOption(
        accountAddr,
        '0x0000000000000000000000000000000000000000',
        { chainId: 137n }
      )

      expect(speedUp.findReplacedFeeOption([otherChainOption])).toBeUndefined()
    })

    test('keeps the original fee option after the account op gets a new fee', () => {
      const accountOp = createAccountOp()
      const speedUp = new SpeedUp({ accountOp, activity: createActivity().activity })
      // SignAccountOpController replaces the account op's gasFeePayment with the selected fee
      accountOp.gasFeePayment = { ...accountOp.gasFeePayment!, paidBy: otherAddr }

      expect(speedUp.findReplacedFeeOption([nativeOption])).toBe(nativeOption)
    })

    test('finds nothing when the pending transaction had no fee payment', () => {
      const speedUp = new SpeedUp({
        accountOp: createAccountOp({ gasFeePayment: null }),
        activity: createActivity().activity
      })

      expect(speedUp.findReplacedFeeOption([nativeOption])).toBeUndefined()
    })
  })

  describe('watchReplacedTransaction', () => {
    test('calls back right away when the pending transaction was already processed', () => {
      const { activity, findByIdentifiedBy } = createActivity(AccountOpStatus.Success)
      const speedUp = new SpeedUp({ accountOp: createAccountOp(), activity })
      const onProcessed = jest.fn()

      speedUp.watchReplacedTransaction(onProcessed)

      expect(findByIdentifiedBy).toHaveBeenCalledWith(replacedIdentifiedBy, accountAddr, 1n)
      expect(onProcessed).toHaveBeenCalledTimes(1)
    })

    test.each([
      AccountOpStatus.Success,
      AccountOpStatus.Failure,
      AccountOpStatus.UnknownButPastNonce
    ])('calls back once the pending transaction gets the %s status', (status) => {
      const { activity, setStatus, emitUpdate } = createActivity(
        AccountOpStatus.BroadcastedButNotConfirmed
      )
      const speedUp = new SpeedUp({ accountOp: createAccountOp(), activity })
      const onProcessed = jest.fn()
      speedUp.watchReplacedTransaction(onProcessed)
      expect(onProcessed).not.toHaveBeenCalled()

      setStatus(status)
      emitUpdate()

      expect(onProcessed).toHaveBeenCalledTimes(1)
    })

    test.each([
      AccountOpStatus.BroadcastedButNotConfirmed,
      AccountOpStatus.BroadcastButStuck,
      AccountOpStatus.Pending
    ])('does not call back while the pending transaction has the %s status', (status) => {
      const { activity, emitUpdate } = createActivity(status)
      const speedUp = new SpeedUp({ accountOp: createAccountOp(), activity })
      const onProcessed = jest.fn()

      speedUp.watchReplacedTransaction(onProcessed)
      emitUpdate()

      expect(onProcessed).not.toHaveBeenCalled()
    })

    test('does not call back when the pending transaction is not in the activity', () => {
      const { activity, emitUpdate } = createActivity()
      const speedUp = new SpeedUp({ accountOp: createAccountOp(), activity })
      const onProcessed = jest.fn()

      speedUp.watchReplacedTransaction(onProcessed)
      emitUpdate()

      expect(onProcessed).not.toHaveBeenCalled()
    })

    test('never calls back when it is unknown which transaction is replaced', () => {
      const { activity, findByIdentifiedBy, emitUpdate } = createActivity(AccountOpStatus.Success)
      const speedUp = new SpeedUp({
        accountOp: createAccountOp({ meta: { speedUp: { enabled: true } } }),
        activity
      })
      const onProcessed = jest.fn()

      speedUp.watchReplacedTransaction(onProcessed)
      emitUpdate()

      expect(findByIdentifiedBy).not.toHaveBeenCalled()
      expect(onProcessed).not.toHaveBeenCalled()
    })

    test('keeps calling back on later updates, so a busy caller can act later', () => {
      const { activity, emitUpdate } = createActivity(AccountOpStatus.Success)
      const speedUp = new SpeedUp({ accountOp: createAccountOp(), activity })
      const onProcessed = jest.fn()

      speedUp.watchReplacedTransaction(onProcessed)
      emitUpdate()

      expect(onProcessed).toHaveBeenCalledTimes(2)
    })

    test('stops listening to the activity once destroyed', () => {
      const { activity, unsubscribe, setStatus, emitUpdate } = createActivity(
        AccountOpStatus.BroadcastedButNotConfirmed
      )
      const speedUp = new SpeedUp({ accountOp: createAccountOp(), activity })
      const onProcessed = jest.fn()
      speedUp.watchReplacedTransaction(onProcessed)

      speedUp.destroy()
      setStatus(AccountOpStatus.Success)
      emitUpdate()

      expect(unsubscribe).toHaveBeenCalledTimes(1)
      expect(onProcessed).not.toHaveBeenCalled()
    })

    test('replaces the previous listener when watching again', () => {
      const { activity, unsubscribe } = createActivity(AccountOpStatus.BroadcastedButNotConfirmed)
      const speedUp = new SpeedUp({ accountOp: createAccountOp(), activity })

      speedUp.watchReplacedTransaction(jest.fn())
      speedUp.watchReplacedTransaction(jest.fn())

      expect(unsubscribe).toHaveBeenCalledTimes(1)
      expect(activity.onUpdate).toHaveBeenCalledTimes(2)
    })
  })
})
