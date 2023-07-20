import { describe, expect, test } from '@jest/globals'

import { AccountOp } from '../accountOp/accountOp'
import { callsToIr, Ir, genericErc20Humanizer } from './mainHumanizer'

// @НNOTE all tests pass regardless offunctionality
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

describe('generc tests for structure', () => {
  let ir: Ir
  beforeEach(() => {
    accountOp.calls = [
      // simple transafer
      { to: '0xc4Ce03B36F057591B2a360d773eDB9896255051e', value: BigInt(10 ** 18), data: '0x' },
      // approve erc-20 token USDT
      {
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        value: BigInt(10 ** 18),
        data: '0x095ea7b300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000016789040'
      },
      // revoke approval  erc-20 token USDT
      {
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        value: BigInt(10 ** 18),
        data: '0x095ea7b300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000000'
      },
      // transferFrom A to me  erc-20 token USDT
      {
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        value: BigInt(10 ** 18),
        data: `0x23b872dd00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000${accountOp.accountAddr.substring(
          2
        )}0000000000000000000000000000000000000000000000000000000000000000`
      },
      // transferFrom A to B (bad example - B is USDT) erc-20 token USDT
      {
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        value: BigInt(10 ** 18),
        data: '0x23b872dd00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec70000000000000000000000000000000000000000000000000000000000000000'
      },
      // transferFrom me to A  erc-20 token USDT
      {
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        value: BigInt(10 ** 18),
        data: `0x23b872dd000000000000000000000000${accountOp.accountAddr.substring(
          2
        )}00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000000`
      },
      // transfer erc-20 tokens USDT
      {
        to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        value: BigInt(10 ** 18),
        data: '0xa9059cbb00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000016789040'
      }
    ]
    ir = callsToIr(accountOp)
  })
  test('simple convert to Ir', () => {
    expect(ir.calls[0]).toEqual({
      data: '0x',
      to: '0xc4Ce03B36F057591B2a360d773eDB9896255051e',
      value: 1000000000000000000n,
      fullVisualization: null
    })
    expect(ir.calls[1]).toEqual({
      data: '0x095ea7b300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000016789040',
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: 1000000000000000000n,
      fullVisualization: null
    })
  })
  test('erc20Humanizer', () => {
    const irCalls = genericErc20Humanizer(accountOp, ir)[0].calls
    irCalls.forEach((c) => console.log(c.fullVisualization))
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
