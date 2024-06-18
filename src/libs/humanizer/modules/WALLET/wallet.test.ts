import { expect } from '@jest/globals'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta, HumanizerVisualization, IrCall } from '../../interfaces'
import { WALLETModule } from '.'

const transactions = {
  WALLET: [
    // enter
    {
      to: '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935',
      value: 0n,
      data: '0xa59f3e0c00000000000000000000000000000000000000000000021e19e0c9bab2400000'
    }, // leave
    {
      to: '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935',
      value: 0n,
      data: '0x9b4ee06400000000000000000000000000000000000000000002172be687fbab0bd4bfd10000000000000000000000000000000000000000000000000000000000000000'
    }, // rage leave
    {
      to: '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935',
      value: 0n,
      data: '0x8a07b41900000000000000000000000000000000000000000000006d7daaded78ae996310000000000000000000000000000000000000000000000000000000000000000'
    }
  ]
}
describe('wallet', () => {
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
  test('WALLET', () => {
    const expectedhumanization = [
      [
        { type: 'action', content: 'Deposit' },
        {
          type: 'token',
          address: '0x88800092ff476844f74dc2fc427974bbee2794ae',
          amount: 10000000000000000000000n
        },
        { type: 'label', content: 'to' },
        {
          type: 'address',
          address: '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935'
        }
      ],
      [
        { type: 'action', content: 'Leave' },
        { type: 'label', content: 'with' },
        {
          type: 'token',
          address: '0x88800092ff476844f74dc2fc427974bbee2794ae',
          amount: 2527275889852892335882193n
        },
        {
          type: 'address',
          address: '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935'
        }
      ],
      [
        { type: 'action', content: 'Rage leave' },
        { type: 'label', content: 'with' },
        {
          type: 'token',
          address: '0x88800092ff476844f74dc2fc427974bbee2794ae',
          amount: 2019750399052452828721n
        },
        {
          type: 'address',
          address: '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935'
        }
      ]
    ]
    accountOp.calls = [...transactions.WALLET]
    let irCalls: IrCall[] = accountOp.calls
    ;[irCalls] = WALLETModule(accountOp, irCalls, humanizerInfo as HumanizerMeta)

    irCalls.forEach((c, i) =>
      c?.fullVisualization?.forEach((v: HumanizerVisualization, j: number) =>
        expect(v).toMatchObject(expectedhumanization[i][j])
      )
    )
  })
})
