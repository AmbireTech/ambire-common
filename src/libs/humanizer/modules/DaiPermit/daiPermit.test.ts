import { Interface, MaxUint256 } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import daiPermitModule from '.'
import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../../utils'

const accountOp: AccountOp = {
  id: '1',
  accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  chainId: 1n,
  // this may not be defined, in case the user has not picked a key yet
  signingKeyAddr: null,
  signingKeyType: null,
  // this may not be set in case we haven't set it yet
  nonce: null,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null
}

const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'
const spender = '0x46705dfff24256421a05d056c29e81bdc09723b8'
const otherHolder = '0xc4ce03b36f057591b2a360d773edb9896255051e'
const expiry = 968187600n
const emptySig = { v: 27, r: `0x${'0'.repeat(64)}`, s: `0x${'0'.repeat(64)}` }

const daiIface = new Interface([
  'function permit(address holder, address spender, uint256 nonce, uint256 expiry, bool allowed, uint8 v, bytes32 r, bytes32 s)'
])

const getPermitCall = (holder: string, permitExpiry: bigint, allowed: boolean): IrCall => ({
  to: DAI,
  value: 0n,
  data: daiIface.encodeFunctionData('permit', [
    holder,
    spender,
    1n,
    permitExpiry,
    allowed,
    emptySig.v,
    emptySig.r,
    emptySig.s
  ])
})

describe('dai permit module', () => {
  test('grant with expiry', () => {
    const calls = [getPermitCall(accountOp.accountAddr, expiry, true)].map((c) =>
      daiPermitModule(accountOp, c)
    )
    compareHumanizerVisualizations(calls, [
      [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(DAI, MaxUint256),
        getLabel('to'),
        getAddressVisualization(spender),
        getDeadline(expiry)
      ]
    ])
  })
  test('grant without expiry (0 means the permit never expires)', () => {
    const calls = [getPermitCall(accountOp.accountAddr, 0n, true)].map((c) =>
      daiPermitModule(accountOp, c)
    )
    compareHumanizerVisualizations(calls, [
      [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(DAI, MaxUint256),
        getLabel('to'),
        getAddressVisualization(spender)
      ]
    ])
  })
  test('revoke', () => {
    const calls = [getPermitCall(accountOp.accountAddr, expiry, false)].map((c) =>
      daiPermitModule(accountOp, c)
    )
    compareHumanizerVisualizations(calls, [
      [
        getAction('Revoke approval'),
        getToken(DAI, 0n),
        getLabel('for'),
        getAddressVisualization(spender)
      ]
    ])
  })
  test('grant on behalf of another holder', () => {
    const calls = [getPermitCall(otherHolder, expiry, true)].map((c) =>
      daiPermitModule(accountOp, c)
    )
    compareHumanizerVisualizations(calls, [
      [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(DAI, MaxUint256),
        getLabel('to'),
        getAddressVisualization(spender),
        getDeadline(expiry),
        getLabel('on behalf of'),
        getAddressVisualization(otherHolder)
      ]
    ])
  })
  test('does not touch unrelated calls', () => {
    const unrelatedCall: IrCall = { to: DAI, value: 0n, data: '0x' }
    const calls = [unrelatedCall].map((c) => daiPermitModule(accountOp, c))
    expect(calls[0]!.fullVisualization).toBeUndefined()
  })
})
