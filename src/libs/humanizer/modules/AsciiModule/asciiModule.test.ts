import { describe, expect } from '@jest/globals'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { ErrorRef } from '../../../../controllers/eventEmitter/eventEmitter'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta } from '../../interfaces'
import { compareHumanizerVisualizations, compareVisualizations } from '../../testHelpers'
import { getText } from '../../utils'
import { asciiModule } from './asciiModule'

const accountOp: AccountOp = {
  accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  networkId: 'ethereum',
  // this may not be defined, in case the user has not picked a key yet
  signingKeyAddr: null,
  signingKeyType: null,
  // this may not be set in case we haven't set it yet
  nonce: null,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null,
  // This is used when we have an account recovery to finalize before executing the AccountOp,
  // And we set this to the recovery finalization AccountOp; could be used in other scenarios too in the future,
  // for example account migration (from v1 QuickAcc to v2)
  accountOpToExecuteBefore: null
  // This is fed into the humanizer to help visualize the accountOp
  // This can contain info like the value of specific share tokens at the time of signing,
  // or any other data that needs to otherwise be retrieved in an async manner and/or needs to be
  // "remembered" at the time of signing in order to visualize history properly
  // humanizerMeta: {}
}
const transactions = [
    { to: '0xc4ce03b36f057591b2a360d773edb9896255051e', value: 0n, data: '0x68656c6c6f' },
    { to: '0xc4ce03b36f057591b2a360d773edb9896255051e', value: 1n, data: '0x68656c6c6f' },
    { to: '0xc4ce03b36f057591b2a360d773edb9896255051e', value: 0n, data: '0x536F6D65206578616D706C65206F6E636861696E2074657874206D657373616765' },
  ]
describe('asciiHumanizer', () => {
  test('basic functionality', async () => {
    accountOp.calls = transactions
    
    let irCalls = asciiModule(accountOp, accountOp.calls, humanizerInfo as HumanizerMeta)
    
    expect(irCalls[0].fullVisualization?.length).toBe(1)
    expect(irCalls[1].fullVisualization).toBeFalsy()
    compareVisualizations(irCalls[0].fullVisualization!, [getText('hello')])
    compareVisualizations(irCalls[2].fullVisualization!, [getText('Some example onchain text message')])
  })
})
