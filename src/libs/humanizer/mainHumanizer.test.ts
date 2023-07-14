import { AccountOp } from '../accountOp/accountOp'
import { callsToIr } from './mainHumanizer'

const accountOp: AccountOp = {
  accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  networkId: '1',
  // this may not be defined, in case the user has not picked a key yet
  signingKeyAddr: null,
  // this may not be set in case we haven't set it yet
  nonce: null,
  // @TODO: nonce namespace? it is dependent on gasFeePayment
  calls: [],
  gasLimit: null,
  signature: null,
  // @TODO separate interface
  gasFeePayment: null,
  // This is used when we have an account recovery to finalize before executing the AccountOp,
  // And we set this to the recovery finalization AccountOp; could be used in other scenarios too in the future,
  // for example account migration (from v1 QuickAcc to v2)
  accountOpToExecuteBefore: null,
  // This is fed into the humanizer to help visualize the accountOp
  // This can contain info like the value of specific share tokens at the time of signing,
  // or any other data that needs to otherwise be retrieved in an async manner and/or needs to be
  // "remembered" at the time of signing in order to visualize history properly
  humanizerMeta: {}
}

describe('call to ir', () => {
  beforeEach(() => {
    accountOp.calls = []
  })
  test('simple convert', () => {
    accountOp.calls = [
      // simple transafer
      { to: '0xc4Ce03B36F057591B2a360d773eDB9896255051e', value: BigInt(10 ** 18), data: '0x' },
      // transfer erc-20 tokens USDT
      {
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        value: BigInt(10 ** 18),
        data: '0xa9059cbb00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000016789040'
      }
    ]

    const ir = callsToIr(accountOp)
    console.log(ir)
  })
})

// describe('genericHUmanizer', () => {
//   beforeEach(() => {
//     accountOp.calls = []
//   })
//   test('Eth transfer', () => {
//     accountOp.calls = [
//       // simple transafer
//       { to: '0xc4Ce03B36F057591B2a360d773eDB9896255051e', value: BigInt(10 ** 18), data: '0x' },
//       // transfer erc-20 tokens USDT
//       {
//         to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
//         value: BigInt(10 ** 18),
//         data: '0xa9059cbb00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000016789040'
//       }
//     ]
//     const ir = accountOp.calls.map((call) => ({ call }))
//     const res = humanizerModules.genericHumanizer(accountOp, ir)
//     console.log(res[0])
//   })
// })
