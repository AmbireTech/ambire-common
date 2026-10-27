import { ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta, IrCall } from '../../interfaces'
import {
  getAddressVisualization,
  getLegacyVisualization,
  getRichVisualization,
  getSingleValueRow,
  getToken,
  getWarning,
  NATIVE_VALUE_WARNING_CODE
} from '../../utils'
import { ST_ETH_ADDRESS } from '../Lido'
import { fallbackHumanizer } from './fallBackHumanizer'

const accountOp: AccountOp = {
  id: 'test',
  accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  chainId: 1n,
  signingKeyAddr: null,
  signingKeyType: null,
  nonce: null,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null
}

const TO = '0xc4ce03b36f057591b2a360d773edb9896255051e'
const DATA =
  '0x095ea7b3000000000000000000000000e5c783ee536cf5e63e792988335c4255169be4e1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
const ETH = 10n ** 18n
const ZERO = ZeroAddress.toLowerCase()

const fallbackCases: Array<{
  label: string
  call: IrCall
  expected: Array<
    Partial<{ type: string; content: string; address: string; value: bigint; warning: boolean }>
  >
}> = [
  {
    label: 'no-to:no-value:no-data — Deploy contract',
    call: { value: 0n, data: '0x' } as IrCall,
    expected: [
      { type: 'action', content: 'Deploy' },
      { type: 'label', content: 'contract' }
    ]
  },
  {
    label: 'no-to:no-value:has-data — Deploy contract with bytecode',
    call: { value: 0n, data: DATA } as IrCall,
    expected: [
      { type: 'action', content: 'Deploy' },
      { type: 'label', content: 'contract' }
    ]
  },
  {
    label: 'no-to:has-value:no-data — Deploy and Burn ETH',
    call: { value: ETH, data: '0x' } as IrCall,
    expected: [
      { type: 'action', content: 'Deploy' },
      { type: 'label', content: 'contract' },
      { type: 'label', content: 'and' },
      { type: 'action', content: 'Burn', warning: true },
      { type: 'token', address: ZERO, value: ETH }
    ]
  },
  {
    label: 'no-to:has-value:has-data — Deploy with bytecode and Burn ETH',
    call: { value: ETH, data: DATA } as IrCall,
    expected: [
      { type: 'action', content: 'Deploy' },
      { type: 'label', content: 'contract' },
      { type: 'label', content: 'and' },
      { type: 'action', content: 'Burn', warning: true },
      { type: 'token', address: ZERO, value: ETH }
    ]
  },
  {
    label: 'has-to:no-value:no-data — Empty call to address',
    call: { to: TO, value: 0n, data: '0x' } as IrCall,
    expected: [
      { type: 'action', content: 'Empty call to' },
      { type: 'address', address: TO }
    ]
  },
  {
    label: 'has-to:has-value:no-data — Send ETH to address',
    call: { to: TO, value: ETH, data: '0x' } as IrCall,
    expected: [
      { type: 'action', content: 'Send' },
      { type: 'token', address: ZERO, value: ETH },
      { type: 'label', content: 'to' },
      { type: 'address', address: TO }
    ]
  },
  {
    label: 'has-to:no-value:has-data — known function name used instead of Interacting with',
    call: { to: TO, value: 0n, data: DATA } as IrCall,
    expected: [
      { type: 'action', content: 'Approve' },
      { type: 'label', content: 'on' },
      { type: 'address', address: TO }
    ]
  },
  {
    label:
      'has-to:has-value:has-data — known function name instead of Interacting with, the ETH is a row',
    call: { to: TO, value: ETH, data: DATA } as IrCall,
    expected: [
      { type: 'action', content: 'Approve' },
      { type: 'label', content: 'on' },
      { type: 'address', address: TO }
    ]
  },
  {
    label: 'has-to:no-value:has-data — falls back to Interacting with when selector is unknown',
    call: { to: TO, value: 0n, data: '0xdeadbeef' } as IrCall,
    expected: [
      { type: 'action', content: 'Interacting' },
      { type: 'label', content: 'with' },
      { type: 'address', address: TO }
    ]
  },
  {
    label: 'existing fullVisualization — returned unchanged',
    call: {
      to: TO,
      value: 0n,
      data: DATA,
      fullVisualization: getLegacyVisualization([{ type: 'action', content: 'Swap', id: 1 }])
    } as IrCall,
    expected: [{ type: 'action', content: 'Swap' }]
  },
  {
    // A more specific module may already have humanized an empty call, so preserve its result
    // instead of overwriting it with the generic "Empty call to" label below.
    label: 'has-to:no-value:no-data — existing fullVisualization preserved',
    call: {
      to: TO,
      value: 0n,
      data: '0x',
      fullVisualization: getLegacyVisualization([
        { type: 'action', content: 'Cancel transaction with nonce 5', id: 1 }
      ])
    } as IrCall,
    expected: [{ type: 'action', content: 'Cancel transaction with nonce 5' }]
  }
]

describe('fallbackHumanizer', () => {
  test('all switch cases', () => {
    fallbackCases.forEach(({ call, expected }) => {
      const result = fallbackHumanizer(accountOp, call, humanizerInfo as HumanizerMeta)
      expect(result!.fullVisualization?.intent).toHaveLength(expected.length)
      result!.fullVisualization!.intent.forEach((item, i) => {
        expect(item).toMatchObject(expected[i]!)
      })
    })
  })

  describe('a call that a module already described with rows', () => {
    const spenderRow = getSingleValueRow('Spender', getAddressVisualization(TO))
    const rowsVisualization = getRichVisualization('Approve', [spenderRow])

    test('keeps the rows', () => {
      const call = { to: TO, value: 0n, data: DATA, fullVisualization: rowsVisualization } as IrCall

      const result = fallbackHumanizer(accountOp, call, humanizerInfo as HumanizerMeta)

      expect(result.fullVisualization?.fields).toEqual([spenderRow])
      expect(result.fullVisualization?.intent).toEqual(rowsVisualization.intent)
      expect(result.isFallback).toBe(false)
    })

    test('does not add the native value to the intent when a row already shows it', () => {
      const nativeRow = getSingleValueRow('Send', getToken(ZeroAddress, ETH, 1n))
      const call = {
        to: TO,
        value: ETH,
        data: DATA,
        fullVisualization: { ...rowsVisualization, fields: [spenderRow, nativeRow] }
      } as IrCall

      const result = fallbackHumanizer(accountOp, call, humanizerInfo as HumanizerMeta)

      expect(result.fullVisualization?.fields).toEqual([spenderRow, nativeRow])
      expect(result.fullVisualization?.intent).toEqual(rowsVisualization.intent)
      expect(result.warnings).toBeUndefined()
    })

    test('shows the native value as a row and warns, and leaves the intent as it is', () => {
      const call = {
        to: TO,
        value: ETH,
        data: DATA,
        fullVisualization: rowsVisualization
      } as IrCall

      const result = fallbackHumanizer(accountOp, call, humanizerInfo as HumanizerMeta)

      expect(result.fullVisualization?.intent).toEqual(rowsVisualization.intent)
      expect(result.fullVisualization?.fields).toEqual([
        spenderRow,
        expect.objectContaining({
          type: 'single-value',
          label: 'Send',
          value: expect.objectContaining({ address: ZERO, value: ETH, chainId: 1n })
        })
      ])
      expect(result.warnings?.map((warning) => warning.code)).toEqual([NATIVE_VALUE_WARNING_CODE])
    })

    test('keeps the warnings a module found next to the one for the native value', () => {
      const moduleWarning = getWarning('A warning of a module', 'MODULE_WARNING')
      const call = {
        to: TO,
        value: ETH,
        data: DATA,
        fullVisualization: rowsVisualization,
        warnings: [moduleWarning]
      } as IrCall

      const result = fallbackHumanizer(accountOp, call, humanizerInfo as HumanizerMeta)

      expect(result.warnings?.map((warning) => warning.code)).toEqual([
        'MODULE_WARNING',
        NATIVE_VALUE_WARNING_CODE
      ])
    })

    test('shows the native value as a row for a call no module described', () => {
      const call = { to: TO, value: ETH, data: '0x12345678' } as IrCall

      const result = fallbackHumanizer(accountOp, call, humanizerInfo as HumanizerMeta)

      expect(result.isFallback).toBe(true)
      expect(result.fullVisualization?.intent[0]).toMatchObject({ content: 'Interacting' })
      expect(result.fullVisualization?.fields).toHaveLength(1)
      expect(result.fullVisualization?.fields[0]).toMatchObject({ label: 'Send' })
    })

    test.each(['Swap', 'Bridge', 'Swap/Bridge', 'Supply', 'Deposit', 'Supply to vault', 'Wrap'])(
      'adds no row for a %s, which shows its own value',
      (action) => {
        const call = {
          to: TO,
          value: ETH,
          data: DATA,
          fullVisualization: getRichVisualization(action, [])
        } as IrCall

        const result = fallbackHumanizer(accountOp, call, humanizerInfo as HumanizerMeta)

        expect(result.fullVisualization?.fields).toEqual([])
        expect(result.warnings).toBeUndefined()
      }
    )
  })

  describe('staking on Lido', () => {
    const lidoStakeData = `0xa1903eab${'0'.repeat(64)}`
    const stakeVisualization = getRichVisualization('Stake', [])
    const getStakeCall = (to: string, value = ETH) =>
      ({ to, value, data: lidoStakeData, fullVisualization: stakeVisualization }) as IrCall

    test('adds no row and no warning for the coin, the stake already is the coin sent', () => {
      const result = fallbackHumanizer(
        accountOp,
        getStakeCall(ST_ETH_ADDRESS),
        humanizerInfo as HumanizerMeta
      )

      expect(result.fullVisualization?.fields).toEqual([])
      expect(result.warnings).toBeUndefined()
    })

    test('does the same when the address is in another letter case', () => {
      const result = fallbackHumanizer(
        accountOp,
        getStakeCall(ST_ETH_ADDRESS.toLowerCase()),
        humanizerInfo as HumanizerMeta
      )

      expect(result.fullVisualization?.fields).toEqual([])
    })

    test('still adds the row and the warning for a stake on another contract', () => {
      const result = fallbackHumanizer(accountOp, getStakeCall(TO), humanizerInfo as HumanizerMeta)

      expect(result.fullVisualization?.fields).toHaveLength(1)
      expect(result.warnings?.map((warning) => warning.code)).toEqual([NATIVE_VALUE_WARNING_CODE])
    })

    test('still adds the row and the warning for another action on the Lido contract', () => {
      const call = {
        to: ST_ETH_ADDRESS,
        value: ETH,
        data: DATA,
        fullVisualization: getRichVisualization('Approve', [])
      } as IrCall

      const result = fallbackHumanizer(accountOp, call, humanizerInfo as HumanizerMeta)

      expect(result.fullVisualization?.fields).toHaveLength(1)
      expect(result.warnings?.map((warning) => warning.code)).toEqual([NATIVE_VALUE_WARNING_CODE])
    })
  })
})
