import { describe, expect, test } from '@jest/globals'

import { ethers } from 'ethers'
import fetch from 'node-fetch'
import { AccountOp } from '../accountOp/accountOp'
import { fallbackHumanizer } from './modules/fallBackHumanizer'
import { uniswapHumanizer } from './modules/Uniswap'
import { HumanizerFragment, HumanizerVisualization, IrCall } from './interfaces'
import { genericErc20Humanizer, genericErc721Humanizer } from './modules/tokens'
import { ErrorRef } from '../../controllers/eventEmitter'
import { nameParsing } from './parsers/nameParsing'
import { parseCalls } from './parsers'

const humanizerInfo = require('../../consts/humanizerInfo.json')

const mockEmitError = (e: ErrorRef) => console.log(e)

// const mockedFetchForTokens = async (url: string) => {
//   const usdtAddress = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
//   return url === `https://api.coingecko.com/api/v3/coins/ethereum/contract/${usdtAddress}`
//     ? {
//         json: async () => ({ symbol: 'usdt', detail_platforms: { ethereum: { decimal_place: 6 } } })
//       }
//     : {}
// }
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
      to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      value: BigInt(0),
      data: '0x095ea7b300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    // revoke approval  erc-20 token USDT
    {
      to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      value: BigInt(0),
      data: '0x095ea7b300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    // transferFrom A to me  erc-20 token USDT
    {
      to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      value: BigInt(0),
      data: `0x23b872dd00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000${accountOp.accountAddr.substring(
        2
      )}000000000000000000000000000000000000000000000000000000003b9aca00`
    },
    // transferFrom A to B (bad example - B is USDT) erc-20 token USDT
    {
      to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      value: BigInt(0),
      data: '0x23b872dd00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    // transferFrom me to A  erc-20 token USDT (bad example, in such case transfer will be used)
    {
      to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      value: BigInt(0),
      data: `0x23b872dd000000000000000000000000${accountOp.accountAddr.substring(
        2
      )}00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00`
    },
    // transfer erc-20 tokens USDT
    {
      to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      value: BigInt(0),
      data: '0xa9059cbb00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00'
    }
  ],
  erc721: [
    // grant approval nft 1
    {
      to: '0x59468516a8259058baD1cA5F8f4BFF190d30E066',
      value: BigInt(0),
      data: '0x095ea7b300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000001'
    },
    // revoke approval nft 1
    {
      to: '0x59468516a8259058baD1cA5F8f4BFF190d30E066',
      value: BigInt(0),
      data: `0x095ea7b3000000000000000000000000${ethers.ZeroAddress.substring(
        2
      )}0000000000000000000000000000000000000000000000000000000000000001`
    },
    // approve all
    {
      to: '0x59468516a8259058baD1cA5F8f4BFF190d30E066',
      value: BigInt(0),
      data: '0xa22cb46500000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000001'
    },
    // revoke all approvals
    {
      to: '0x59468516a8259058baD1cA5F8f4BFF190d30E066',
      value: BigInt(0),
      data: '0xa22cb46500000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000000'
    },
    // transfer from me to A
    {
      to: '0x59468516a8259058baD1cA5F8f4BFF190d30E066',
      value: BigInt(0),
      data: '0x23b872dd000000000000000000000000B674F3fd5F43464dB0448a57529eAF37F04cceA500000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000000'
    },
    // transfer from B to A
    {
      to: '0x59468516a8259058baD1cA5F8f4BFF190d30E066',
      value: BigInt(0),
      data: '0x23b872dd000000000000000000000000C89B38119C58536d818f3Bf19a9E3870828C199400000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000000'
    },
    // safe transfer from A to B
    {
      to: '0x59468516a8259058baD1cA5F8f4BFF190d30E066',
      value: BigInt(0),
      data: '0x42842e0e000000000000000000000000C89B38119C58536d818f3Bf19a9E3870828C199400000000000000000000000046705dfff24256421a05d056c29e81bdc09723b80000000000000000000000000000000000000000000000000000000000000000'
    }
  ],
  namingTransactions: [
    // ETH to uniswap (bad example, sending eth to contract)
    {
      to: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
      value: BigInt(10 * 18),
      data: '0x'
    },
    // USDT to uniswap (bad example, sending erc-20 to contract)
    {
      to: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      value: BigInt(0),
      data: '0xa9059cbb0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    // ETH to arbitrary address (expects to shortened address)
    {
      to: '0xb674f3fd5f43464db0448a57529eaf37f04ccea5',
      value: BigInt(10 * 18),
      data: '0x'
    }
  ],
  uniV3: [
    // Swap exact WALLET for at least x  USDC
    {
      to: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      value: BigInt(0),
      data: '0x5ae401dc0000000000000000000000000000000000000000000000000000000064c236530000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000124b858183f00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea500000000000000000000000000000000000000000000003635c9adc5dea000000000000000000000000000000000000000000000000000000000000000835074000000000000000000000000000000000000000000000000000000000000004288800092ff476844f74dc2fc427974bbee2794ae002710c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    },
    // Swap up to x Adex to exact DAI
    {
      to: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      value: BigInt(0),
      data: '0x5ae401dc0000000000000000000000000000000000000000000000000000000064c233bf000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000012409b8134600000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000080000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea50000000000000000000000000000000000000000000000056bc75e2d63100000000000000000000000000000000000000000000000000025faff1f58be30f6ec00000000000000000000000000000000000000000000000000000000000000426b175474e89094c44da98b954eedeac495271d0f000064dac17f958d2ee523a2206206994597c13d831ec7000bb8ade00c28244d5ce17d72e40330b1c318cd12b7c300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    },
    // multicall
    {
      to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001a00000000000000000000000000000000000000000000000000000000000000124f28c0498000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000005a5be6b067d6b5b018adbcd27ee6972105b3b4000000000000000000000000000000000000000000000000000000000064d4f15700000000000000000000000000000000000000000000048a19ce0269c802800000000000000000000000000000000000000000000000000019952df3ca0a9588000000000000000000000000000000000000000000000000000000000000002b046eee2cc3188071c02bfc1745a6b17c656e3f3d000bb8c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000412210e8a00000000000000000000000000000000000000000000000000000000',
      value: BigInt(0)
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
    delete accountOp.humanizerMeta!['tokens:0xdAC17F958D2ee523a2206206994597C13D831ec7']
    if (accountOp.humanizerMeta)
      Object.keys(accountOp.humanizerMeta).forEach((k) => {
        k.includes('tokens') ? delete accountOp.humanizerMeta?.[k] : null
      })
    const irCalls: IrCall[] = accountOp.calls
    const [, asyncOps] = genericErc20Humanizer(accountOp, irCalls, {
      fetch,
      emitError: mockEmitError
    })
    const asyncData = await Promise.all(asyncOps)
    expect(asyncData[0]).toMatchObject({ key: `tokens:${irCalls[0].to}`, value: ['USDT', 6] })
  })
})

describe('module tests', () => {
  beforeEach(async () => {
    accountOp.humanizerMeta = { ...humanizerInfo }
    accountOp.calls = []
  })
  test('callsToIr', () => {
    accountOp.calls = [...transactions.generic, ...transactions.erc20]
    const irCalls: IrCall[] = accountOp.calls
    expect(irCalls.length).toBe(transactions.erc20.length + transactions.generic.length)
    expect(irCalls[0]).toEqual({ ...transactions.generic[0], fullVisualization: undefined })
  })
  test('genericErc20Humanizer', () => {
    accountOp.calls = [...transactions.erc20]
    const irCalls: IrCall[] = accountOp.calls
    const [newCalls] = genericErc20Humanizer(accountOp, irCalls, { fetch })
    expect(newCalls.length).toBe(transactions.erc20.length)
    newCalls.forEach((c) => {
      expect(
        c?.fullVisualization?.find((v: HumanizerVisualization) => v.type === 'token')
      ).toMatchObject({
        type: 'token',
        address: expect.anything(),
        amount: expect.anything()
      })
    })
  })

  test('genericErc721Humanizer', () => {
    accountOp.calls = [...transactions.erc721]
    const irCalls: IrCall[] = accountOp.calls
    const [newCalls] = genericErc721Humanizer(accountOp, irCalls)

    expect(newCalls.length).toBe(transactions.erc721.length)
    newCalls.forEach((c) => {
      expect(c?.fullVisualization).not.toBeNull()
    })
  })
  test('uniSwap', () => {
    accountOp.calls = [...transactions.uniV3]
    const irCalls: IrCall[] = accountOp.calls
    const [calls] = uniswapHumanizer(accountOp, irCalls)
    const expectedVisualization = [
      [
        { type: 'action', content: 'Swap' },
        {
          type: 'token',
          address: '0x88800092fF476844f74dC2FC427974BBee2794Ae',
          amount: 1000000000000000000000n
        },
        { type: 'label', content: 'for at least' },
        {
          type: 'token',
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
        },
        { type: 'label', content: 'already expired' }
      ],
      [
        { type: 'action', content: 'Swap up to' },
        {
          type: 'token',
          address: '0xADE00C28244d5CE17D72E40330B1c318cD12B7c3'
        },
        { type: 'label', content: 'for' },
        {
          type: 'token',
          address: '0x6B175474E89094C44Da98b954EedeAC495271d0F'
        },
        { type: 'label', content: 'already expired' }
      ],
      [
        { type: 'action', content: 'Swap up to' },
        {
          type: 'token',
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
        },
        { type: 'label', content: 'for' },
        {
          type: 'token',
          address: '0x046EeE2cc3188071C02BfC1745A6b17c656e3f3d'
        },
        { type: 'label', content: 'and send it to' },
        {
          type: 'address',
          address: '0x5a5Be6b067d6B5B018adBCD27EE6972105B3b400'
        },
        { type: 'label', content: 'already expired' }
      ],
      [{ type: 'action', content: 'Refund' }]
    ]
    expect(calls.length).toEqual(expectedVisualization.length)
    calls.forEach((c, i) => {
      expect(c?.fullVisualization?.length).toBe(expectedVisualization[i].length)
      c?.fullVisualization?.forEach((v: HumanizerVisualization, j: number) => {
        expect(v).toMatchObject(expectedVisualization[i][j])
      })
    })
  })

  test('fallback', async () => {
    accountOp.calls = [...transactions.generic]
    delete accountOp.humanizerMeta?.['funcSelectors:0x095ea7b3']
    let irCalls: IrCall[] = accountOp.calls
    let asyncOps = []
    ;[irCalls, asyncOps] = fallbackHumanizer(accountOp, irCalls, {
      fetch,
      emitError: mockEmitError
    })
    asyncOps = (await Promise.all(asyncOps)).filter((a) => a) as HumanizerFragment[]
    expect(asyncOps.length).toBe(1)
    expect(asyncOps[0]).toMatchObject({ key: 'funcSelectors:0x095ea7b3' })
    asyncOps.forEach((a) => {
      accountOp.humanizerMeta = { ...accountOp.humanizerMeta, [a.key]: a.value }
    })
    // etherface api might be asparagus
    expect(accountOp.humanizerMeta).toHaveProperty('funcSelectors:0x095ea7b3')
    ;[irCalls, asyncOps] = fallbackHumanizer(accountOp, irCalls, { fetch })
    expect(irCalls[1]?.fullVisualization?.[0]).toMatchObject({
      type: 'action',
      content: 'Call approve(address,uint256)'
    })
    expect(asyncOps.length).toBe(0)
  })

  test('nameParsing', () => {
    accountOp.calls = [...transactions.namingTransactions]
    let irCalls = accountOp.calls
    ;[irCalls] = genericErc20Humanizer(accountOp, irCalls)
    ;[irCalls] = fallbackHumanizer(accountOp, irCalls)
    const [newCalls] = parseCalls(accountOp, irCalls, [nameParsing], { fetch })
    expect(newCalls.length).toBe(transactions.namingTransactions.length)
    expect(newCalls[0].warnings?.length).toBeFalsy()
    expect(newCalls[1].warnings?.length).toBeFalsy()
    expect(newCalls[2].warnings?.length).toBe(1)
    expect(
      newCalls[0]?.fullVisualization?.find((v: HumanizerVisualization) => v.type === 'address')
    ).toMatchObject({
      type: 'address',
      address: expect.anything(),
      name: expect.not.stringMatching(/^0x[a-fA-F0-9]{3}\.{3}[a-fA-F0-9]{3}$/)
    })
    expect(
      newCalls[1]?.fullVisualization?.find((v: HumanizerVisualization) => v.type === 'address')
    ).toMatchObject({
      type: 'address',
      address: expect.anything(),
      name: expect.not.stringMatching(/^0x[a-fA-F0-9]{3}\.{3}[a-fA-F0-9]{3}$/)
    })
    expect(
      newCalls[2]?.fullVisualization?.find((v: HumanizerVisualization) => v.type === 'address')
    ).toMatchObject({
      type: 'address',
      address: expect.anything(),
      name: expect.stringMatching(/^0x[a-fA-F0-9]{3}\.{3}[a-fA-F0-9]{3}$/)
    })
  })
})
