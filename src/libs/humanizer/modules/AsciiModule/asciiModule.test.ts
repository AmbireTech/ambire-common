import { ZeroAddress } from 'ethers'

import { describe } from '@jest/globals'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta } from '../../interfaces'
import { compareVisualizations } from '../../testHelpers'
import { getAction, getAddressVisualization, getLabel, getText, getToken } from '../../utils'
import { asciiModule } from './asciiModule'

const accountOp: AccountOp = {
  accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  chainId: 1n,
  signingKeyAddr: null,
  signingKeyType: null,
  nonce: null,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null,
  accountOpToExecuteBefore: null
}
const transactions = [
  { to: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8', value: 0n, data: '0x68656c6c6f' },
  { to: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8', value: 1n, data: '0x68656c6c6f' },
  {
    to: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
    value: 0n,
    data: '0x536F6D65206578616D706C65206F6E636861696E2074657874206D657373616765'
  }
]
describe('asciiHumanizer', () => {
  test('basic functionality', async () => {
    const humanizationPrefix = [
      getAction('Send this message'),
      getLabel('to'),
      getAddressVisualization('0x77777777789A8BBEE6C64381e5E89E501fb0e4c8')
    ]
    accountOp.calls = transactions

    const irCalls = asciiModule(accountOp, accountOp.calls, humanizerInfo as HumanizerMeta)

    compareVisualizations(irCalls[0].fullVisualization!, [...humanizationPrefix, getText('hello')])
    compareVisualizations(irCalls[1].fullVisualization!, [
      ...humanizationPrefix,
      getText('hello'),
      getLabel('and'),
      getAction('Send'),
      getToken(ZeroAddress, 1n)
    ])
    compareVisualizations(irCalls[2].fullVisualization!, [
      ...humanizationPrefix,
      getText('Some example onchain text message')
    ])
  })
})
