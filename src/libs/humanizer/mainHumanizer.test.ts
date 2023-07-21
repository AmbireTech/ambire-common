import { describe, expect, test } from '@jest/globals'

import fetch from 'node-fetch'
import { ethers } from 'ethers'
import { AccountOp } from '../accountOp/accountOp'
import {
  callsToIr,
  Ir,
  genericErc20Humanizer,
  namingHumanizer,
  initialHumanizer
} from './mainHumanizer'

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
const transactions = {
  generic: [
    // simple transafer
    { to: '0xc4Ce03B36F057591B2a360d773eDB9896255051e', value: BigInt(10 ** 18), data: '0x' },
    // simple contract call (WETH approve)
    {
      to: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      value: BigInt(0),
      data: '0x095ea7b3000000000000000000000000e5c783ee536cf5e63e792988335c4255169be4e1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    }
  ],
  // currently with USDT
  erc20: [
    // approve erc-20 token USDT
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: '0x095ea7b300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    // revoke approval  erc-20 token USDT
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: '0x095ea7b300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    // transferFrom A to me  erc-20 token USDT
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: `0x23b872dd00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000${accountOp.accountAddr.substring(
        2
      )}000000000000000000000000000000000000000000000000000000003b9aca00`
    },
    // transferFrom A to B (bad example - B is USDT) erc-20 token USDT
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: '0x23b872dd00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    // transferFrom me to A  erc-20 token USDT (bad example, in such case transfer will be used)
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: `0x23b872dd000000000000000000000000${accountOp.accountAddr.substring(
        2
      )}00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00`
    },
    // transfer erc-20 tokens USDT
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: '0xa9059cbb00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00'
    }
  ],
  toKnownAddresses: [
    // ETH to uniswap (bad example, sending eth to contract)
    {
      to: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
      value: BigInt(10 * 18),
      data: '0x'
    },
    // USDT to uniswap (bad example, sending erc-20 to contract)
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: '0xa9059cbb0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d000000000000000000000000000000000000000000000000000000003b9aca00'
    }
  ]
}
describe('module tests', () => {
  beforeEach(async () => {
    const humanizerInfo = await (
      await fetch(
        'https://raw.githubusercontent.com/AmbireTech/ambire-constants/master/constants/humanizerInfo.json'
      )
    ).json()
    accountOp.humanizerMeta = humanizerInfo
    accountOp.calls = []
  })
  // @TODO add erc20 test
  // @TODO add namingHumanizer test
  test('callsToIr', () => {
    accountOp.calls = [...transactions.generic, ...transactions.erc20]
    const ir: Ir = callsToIr(accountOp)
    expect(ir.calls.length).toBe(transactions.erc20.length + transactions.generic.length)
    expect(ir.calls[0]).toEqual({ ...transactions.generic[0], fullVisualization: null })
  })
  test('initial humanizer', () => {
    accountOp.calls = [...transactions.generic, transactions.erc20[0]]
    const ir = callsToIr(accountOp)
    const [{ calls }] = initialHumanizer(accountOp, ir)
    expect(calls[0].fullVisualization).not.toBeNull()
    expect(calls[1].fullVisualization).not.toBeNull()
    expect(calls[0].fullVisualization[0]).toEqual({ type: 'action', content: 'Sending' })
    expect(calls[0].fullVisualization[1]).toMatchObject({
      type: 'token',
      address: ethers.ZeroAddress
    })
    expect(calls[1].fullVisualization[0]).toEqual({ type: 'action', content: 'Interacting with' })
  })
  test('genericErc20Humanizer', () => {
    accountOp.calls = [...transactions.erc20]
    const ir = callsToIr(accountOp)
    const [{ calls: newCalls }] = genericErc20Humanizer(accountOp, ir)
    expect(newCalls.length).toBe(transactions.erc20.length)
    newCalls.forEach((c) => {
      expect(c.fullVisualization.find((v: any) => v.type === 'token')).toMatchObject({
        type: 'token',
        address: expect.anything(),
        amount: expect.anything()
      })
    })
  })
  test('namingHumanizer', () => {
    accountOp.calls = [...transactions.toKnownAddresses]
    let ir = callsToIr(accountOp)
    ;[ir] = initialHumanizer(accountOp, ir)
    const [{ calls: newCalls }] = namingHumanizer(accountOp, ir)

    expect(newCalls.length).toBe(transactions.toKnownAddresses.length)
    newCalls.forEach((c) => {
      console.log(c.fullVisualization.find((v: any) => v.type === 'address'))
      expect(c.fullVisualization.find((v: any) => v.type === 'address')).toMatchObject({
        type: 'address',
        address: expect.anything(),
        name: expect.not.stringMatching(/^0x[a-fA-F0-9]{3}\.{3}[a-fA-F0-9]{3}$/)
      })
    })
  })
})
