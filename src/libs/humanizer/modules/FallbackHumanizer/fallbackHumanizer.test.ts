import { ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta, IrCall } from '../../interfaces'
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
    label: 'has-to:no-value:has-data — Interacting with address',
    call: { to: TO, value: 0n, data: DATA } as IrCall,
    expected: [
      { type: 'action', content: 'Interacting' },
      { type: 'label', content: 'with' },
      { type: 'address', address: TO }
    ]
  },
  {
    label: 'has-to:has-value:has-data — Send ETH and Interacting with address',
    call: { to: TO, value: ETH, data: DATA } as IrCall,
    expected: [
      { type: 'action', content: 'Send' },
      { type: 'token', address: ZERO, value: ETH },
      { type: 'label', content: 'and' },
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
      fullVisualization: [{ type: 'action', content: 'Swap', id: 1 }]
    } as IrCall,
    expected: [{ type: 'action', content: 'Swap' }]
  }
]

describe('fallbackHumanizer', () => {
  test('all switch cases', () => {
    fallbackCases.forEach(({ call, expected }) => {
      const result = fallbackHumanizer(accountOp, call, humanizerInfo as HumanizerMeta)
      expect(result!.fullVisualization).toHaveLength(expected.length)
      result!.fullVisualization!.forEach((item, i) => {
        expect(item).toMatchObject(expected[i]!)
      })
    })
  })
})
