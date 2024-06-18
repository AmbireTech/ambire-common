import { ethers } from 'ethers'
import fetch from 'node-fetch'

import { describe, expect, test } from '@jest/globals'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { networks } from '../../../../consts/networks'
import { ErrorRef } from '../../../../controllers/eventEmitter/eventEmitter'
import { AccountOp } from '../../../accountOp/accountOp'
import { parse, stringify } from '../../../richJson/richJson'
import { HumanizerMeta, HumanizerVisualization, IrCall } from '../../interfaces'
import { genericErc20Humanizer, genericErc721Humanizer } from '.'

// eslint-disable-next-line no-console
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
  accountOpToExecuteBefore: null
  // This is fed into the humanizer to help visualize the accountOp
  // This can contain info like the value of specific share tokens at the time of signing,
  // or any other data that needs to otherwise be retrieved in an async manner and/or needs to be
  // "remembered" at the time of signing in order to visualize history properly
  // humanizerMeta: {}
}
const transactions = {
  generic: [
    // simple transafer
    { to: '0xc4ce03b36f057591b2a360d773edb9896255051e', value: BigInt(10 ** 18), data: '0x' },
    // simple contract call (WETH approve)
    {
      to: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
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
  ]
}

describe('Tokens', () => {
  beforeEach(async () => {
    accountOp.calls = []
  })

  test('getTokenInfo', async () => {
    accountOp.calls = transactions.erc20
    const humanizerMeta = parse(stringify(humanizerInfo))
    delete humanizerMeta!.knownAddresses['0xdac17f958d2ee523a2206206994597c13d831ec7'].token
    if (humanizerMeta)
      Object.keys(humanizerMeta.knownAddresses).forEach((k) => {
        delete humanizerMeta?.knownAddresses[k]
      })
    const irCalls: IrCall[] = accountOp.calls
    const [, asyncOps] = genericErc20Humanizer(accountOp, irCalls, humanizerMeta, {
      fetch,
      emitError: mockEmitError,
      network: networks[0]
    })
    const asyncData = await Promise.all(asyncOps.map((i) => i()))

    expect(asyncData[0]).toMatchObject({
      key: irCalls[0].to.toLowerCase(),
      type: 'token',
      value: {
        decimals: 6,
        symbol: 'USDT'
      }
    })
  })
  // @TODO err
  test('genericErc20Humanizer', () => {
    accountOp.calls = [...transactions.erc20]
    const irCalls: IrCall[] = accountOp.calls
    const [newCalls] = genericErc20Humanizer(accountOp, irCalls, humanizerInfo as HumanizerMeta, {
      fetch,
      networkId: 'ethereum'
    })
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
    const [newCalls] = genericErc721Humanizer(accountOp, irCalls, humanizerInfo as HumanizerMeta, {
      networkId: 'ethereum'
    })

    expect(newCalls.length).toBe(transactions.erc721.length)
    newCalls.forEach((c) => {
      expect(c?.fullVisualization).not.toBeNull()
    })
  })
})
