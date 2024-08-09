import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta, IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction } from '../../utils'
import { deploymentModule } from '.'

describe('Deployment', () => {
  const accountOp: AccountOp = {
    accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
    networkId: 'ethereum',
    // networkId: 'polygon',
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
  // @TODO once we have updated the interfaces IrCall and Call to have to?: string instead of to: string
  // test('WETH', () => {
  //   accountOp.calls = [{ data: '0x', value: 0n, to: undefined }]
  //   let irCalls: IrCall[] = accountOp.calls
  //   ;[irCalls] = deploymentModule(accountOp, irCalls, humanizerInfo as HumanizerMeta)
  //   compareHumanizerVisualizations(irCalls, [[getAction('Deploy smart contract')]])
  // })
})
