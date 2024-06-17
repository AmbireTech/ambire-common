import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getAddressVisualization, getDeadline, getLabel, getToken } from '../../utils'
import traderJoe from '.'

const transactions = [
  // NATIVE for USDC.e
  {
    to: '0x18556DA13313f3532c54711497A8FedAC273220E',
    value: 830670960717642935n,
    data: '0xb066ea7c00000000000000000000000000000000000000000000000000000000ae17c7930000000000000000000000000000000000000000000000000000000000000080000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa9604500000000000000000000000000000000000000000000000000000000667037d5000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000f0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000300000000000000000000000082af49447d8a07e3bd95bd0d56f35241523fbab1000000000000000000000000fd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9000000000000000000000000ff970a61a04b1ca14834a43f5de4533ebddb5cc8'
  }
]
const accountOp: AccountOp = {
  accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  networkId: 'arbitrum',
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

describe('curve', () => {
  test('basic', () => {
    const expectedVisualziation = [
      [
        getAction('Swap'),
        getToken('0x0000000000000000000000000000000000000000', 830670960717642935n),
        getLabel('for'),
        getToken('0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', 2920794003n),
        getLabel('and send it to'),
        getAddressVisualization('0xd8da6bf26964af9d7eed9e03e53415d37aa96045'),
        getDeadline(1718630357n)
      ]
    ]
    const [calls] = traderJoe(accountOp, transactions, humanizerInfo as HumanizerMeta)

    compareHumanizerVisualizations(calls, expectedVisualziation)
  })
})
