import { describe, expect, test } from '@jest/globals'

import { ethers } from 'ethers'
import { AccountOp } from '../accountOp/accountOp'
import { callsToIr, namingHumanizer, initialHumanizer, initHumanizerMeta } from './mainHumanizer'

import { uniswapHumanizer } from './modules/Uniswap'
import { Ir } from './interfaces'
import { genericErc20Humanizer, genericErc721Humanizer } from './modules/tokens'

const humanizerInfo = initHumanizerMeta(require('./humanizerInfo.json'))

const mockedFetchForTokens = async (url: string) => {
  const usdtAddress = '0xdac17f958d2ee523a2206206994597c13d831ec7'
  return url === `https://api.coingecko.com/api/v3/coins/ethereum/contract/${usdtAddress}`
    ? {
        json: async () => ({ symbol: 'usdt', detail_platforms: { ethereum: { decimal_place: 6 } } })
      }
    : {}
}
// @NOTE all tests pass regardless offunctionality
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
  erc721: [
    // grant approval nft 1
    {
      to: '0x59468516a8259058bad1ca5f8f4bff190d30e066',
      value: BigInt(0),
      data: '0x095ea7b300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000001'
    },
    // revoke approval nft 1
    {
      to: '0x59468516a8259058bad1ca5f8f4bff190d30e066',
      value: BigInt(0),
      data: `0x095ea7b3000000000000000000000000${ethers.ZeroAddress.substring(
        2
      )}0000000000000000000000000000000000000000000000000000000000000001`
    },
    // approve all
    {
      to: '0x59468516a8259058bad1ca5f8f4bff190d30e066',
      value: BigInt(0),
      data: '0xa22cb46500000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000001'
    },
    // revoke all approvals
    {
      to: '0x59468516a8259058bad1ca5f8f4bff190d30e066',
      value: BigInt(0),
      data: '0xa22cb46500000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000000'
    },
    // transfer from me to A
    {
      to: '0x59468516a8259058bad1ca5f8f4bff190d30e066',
      value: BigInt(0),
      data: '0x23b872dd000000000000000000000000B674F3fd5F43464dB0448a57529eAF37F04cceA500000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000000'
    },
    // transfer from B to A
    {
      to: '0x59468516a8259058bad1ca5f8f4bff190d30e066',
      value: BigInt(0),
      data: '0x23b872dd000000000000000000000000C89B38119C58536d818f3Bf19a9E3870828C199400000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000000'
    },
    // safe transfer from A to B
    {
      to: '0x59468516a8259058bad1ca5f8f4bff190d30e066',
      value: BigInt(0),
      data: '0x42842e0e000000000000000000000000C89B38119C58536d818f3Bf19a9E3870828C199400000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000000'
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
      data: '0xa9059cbb000000000000000000000000B674F3fd5F43464dB0448a57529eAF37F04cceA5000000000000000000000000000000000000000000000000000000003b9aca00'
    }
  ],
  uniV3: [
    // Swap exact WALLET for at least x  USDC
    {
      to: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
      value: BigInt(0),
      data: '0x5ae401dc0000000000000000000000000000000000000000000000000000000064c236530000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000124b858183f00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000000000000000000000000003635c9adc5dea000000000000000000000000000000000000000000000000000000000000000835074000000000000000000000000000000000000000000000000000000000000004288800092ff476844f74dc2fc427974bbee2794ae002710c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    },
    // Swap up to x Adex to exact DAI
    {
      to: '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45',
      value: BigInt(0),
      data: '0x5ae401dc0000000000000000000000000000000000000000000000000000000064c233bf000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000012409b8134600000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea50000000000000000000000000000000000000000000000056bc75e2d63100000000000000000000000000000000000000000000000000025faff1f58be30f6ec00000000000000000000000000000000000000000000000000000000000000426b175474e89094c44da98b954eedeac495271d0f000064dac17f958d2ee523a2206206994597c13d831ec7000bb8ade00c28244d5ce17d72e40330b1c318cd12b7c300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    }
  ]
}

describe('asyncOps tests', () => {
  beforeEach(async () => {
    accountOp.humanizerMeta = { ...humanizerInfo }
    accountOp.calls = []
  })

  test('getTokenInfo', async () => {
    accountOp.calls = transactions.erc20
    if (accountOp.humanizerMeta)
      Object.keys(accountOp.humanizerMeta).forEach((k) => {
        k.includes('tokens') ? delete accountOp.humanizerMeta?.[k] : null
      })
    const ir = callsToIr(accountOp)
    const [, asyncOps] = genericErc20Humanizer(accountOp, ir, { fetch: mockedFetchForTokens })
    const asyncData = await Promise.all(asyncOps)
    expect(asyncData[0]).toMatchObject({ key: `tokens:${ir.calls[0].to}`, value: ['USDT', 6] })
  })
})

describe('module tests', () => {
  beforeEach(async () => {
    // const humanizerInfo = await (
    //   await fetch(
    //     'https://raw.githubusercontent.com/AmbireTech/ambire-constants/master/constants/humanizerInfo.json'
    //   )
    // ).json()
    accountOp.humanizerMeta = { ...humanizerInfo }
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
      expect(c.fullVisualization.find((v: any) => v.type === 'address')).toMatchObject({
        type: 'address',
        address: expect.anything(),
        name: expect.not.stringMatching(/^0x[a-fA-F0-9]{3}\.{3}[a-fA-F0-9]{3}$/)
      })
    })
  })
  test('genericErc721Humanizer', () => {
    accountOp.calls = [...transactions.erc721]
    let ir = callsToIr(accountOp)
    ;[ir] = initialHumanizer(accountOp, ir)
    const [{ calls: newCalls }] = genericErc721Humanizer(accountOp, ir)

    expect(newCalls.length).toBe(transactions.erc721.length)
    newCalls.forEach((c) => {
      expect(c.fullVisualization).not.toBeNull()
      // expect(c.fullVisualization.find((v: any) => v.type === 'address')).toMatchObject({
      //   type: 'address',
      //   address: expect.anything(),
      //   name: expect.not.stringMatching(/^0x[a-fA-F0-9]{3}\.{3}[a-fA-F0-9]{3}$/)
    })
  })
  test('uniSwap', () => {
    accountOp.calls = [...transactions.uniV3]
    const ir = callsToIr(accountOp)
    const [{ calls }] = uniswapHumanizer(accountOp, ir)
    expect(calls[0].fullVisualization[0]).toEqual({ type: 'action', content: 'Swap' })
    expect(calls[0].fullVisualization[1]).toMatchObject({ type: 'token' })
    expect(calls[0].fullVisualization[2]).toEqual({ type: 'lable', content: 'for at least' })
    expect(calls[0].fullVisualization[3]).toMatchObject({ type: 'token' })

    expect(calls[1].fullVisualization[0]).toEqual({ type: 'action', content: 'Swap up to' })
    expect(calls[1].fullVisualization[1]).toMatchObject({ type: 'token' })
    expect(calls[1].fullVisualization[2]).toEqual({ type: 'lable', content: 'for' })
    expect(calls[1].fullVisualization[3]).toMatchObject({ type: 'token' })
  })
})
