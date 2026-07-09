import { ethers } from 'ethers'

import { beforeEach, describe, test } from '@jest/globals'

import { genericErc20Humanizer, genericErc721Humanizer } from '.'
import { AccountOp } from '../../../accountOp/accountOp'
import { IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getAddressVisualization, getLabel, getToken } from '../../utils'

const accountOp: AccountOp = {
  id: '1',
  accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  chainId: 1n,
  // this may not be defined, in case the user has not picked a key yet
  signingKeyAddr: null,
  signingKeyType: null,
  // this may not be set in case we haven't set it yet
  nonce: null,
  calls: [],
  gasLimit: null,
  signature: null,
  gasFeePayment: null
  // This is fed into the humanizer to help visualize the accountOp
  // This can contain info like the value of specific share tokens at the time of signing,
  // or any other data that needs to otherwise be retrieved in an async manner and/or needs to be
  // "remembered" at the time of signing in order to visualize history properly
  // humanizerMeta: {}
}

const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const spender = '0x46705dfff24256421a05d056c29e81bdc09723b8'

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
      to: USDT,
      value: BigInt(0),
      data: '0x095ea7b300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    // revoke approval  erc-20 token USDT
    {
      to: USDT,
      value: BigInt(0),
      data: `0x095ea7b3000000000000000000000000${spender.substring(
        2
      )}0000000000000000000000000000000000000000000000000000000000000000`
    },
    // increaseAllowance erc-20 token USDT
    {
      to: USDT,
      value: BigInt(0),
      data: '0x3950935100000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    // decreaseAllowance erc-20 token USDT
    {
      to: USDT,
      value: BigInt(0),
      data: '0xa457c2d700000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    // increaseApproval erc-20 token (legacy naming, e.g. OMG)
    {
      to: USDT,
      value: BigInt(0),
      data: '0xd73dd62300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    // decreaseApproval erc-20 token (legacy naming, e.g. OMG)
    {
      to: USDT,
      value: BigInt(0),
      data: '0x6618846300000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    // transferFrom A to me  erc-20 token USDT
    {
      to: USDT,
      value: BigInt(0),
      data: `0x23b872dd00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000${accountOp.accountAddr.substring(
        2
      )}000000000000000000000000000000000000000000000000000000003b9aca00`
    },
    // transferFrom A to B (bad example - B is USDT) erc-20 token USDT
    {
      to: USDT,
      value: BigInt(0),
      data: '0x23b872dd00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    // transferFrom me to A  erc-20 token USDT (bad example, in such case transfer will be used)
    {
      to: USDT,
      value: BigInt(0),
      data: `0x23b872dd000000000000000000000000${accountOp.accountAddr.substring(
        2
      )}00000000000000000000000046705dfff24256421a05d056c29e81bdc09723b8000000000000000000000000000000000000000000000000000000003b9aca00`
    },
    // transfer erc-20 tokens USDT
    {
      to: USDT,
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

  test('genericErc20Humanizer', () => {
    accountOp.calls = [...transactions.erc20]
    const irCalls: IrCall[] = genericErc20Humanizer(
      { accountAddr: accountOp.accountAddr },
      accountOp.calls
    )
    const addedValue = 1000000000n

    const expectedHumanization = [
      [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(USDT, addedValue),
        getLabel('to'),
        getAddressVisualization(spender)
      ],
      [
        getAction('Revoke approval'),
        getToken(USDT, 0n),
        getLabel('for'),
        getAddressVisualization(spender)
      ],
      [
        getAction('Increase allowance'),
        getLabel('of'),
        getAddressVisualization(spender),
        getLabel('with'),
        getToken(USDT, addedValue)
      ],
      [
        getAction('Decrease allowance'),
        getLabel('of'),
        getAddressVisualization(spender),
        getLabel('with'),
        getToken(USDT, addedValue)
      ],
      [
        getAction('Increase allowance'),
        getLabel('of'),
        getAddressVisualization(spender),
        getLabel('with'),
        getToken(USDT, addedValue)
      ],
      [
        getAction('Decrease allowance'),
        getLabel('of'),
        getAddressVisualization(spender),
        getLabel('with'),
        getToken(USDT, addedValue)
      ],
      [
        getAction('Take'),
        getToken(USDT, addedValue),
        getLabel('from'),
        getAddressVisualization(spender)
      ],
      [
        getAction('Move'),
        getToken(USDT, addedValue),
        getLabel('from'),
        getAddressVisualization(spender),
        getLabel('to'),
        getAddressVisualization(USDT)
      ],
      [
        getAction('Transfer'),
        getToken(USDT, addedValue),
        getLabel('to'),
        getAddressVisualization(spender)
      ],
      [
        getAction('Send'),
        getToken(USDT, addedValue),
        getLabel('to'),
        getAddressVisualization(spender)
      ]
    ]

    compareHumanizerVisualizations(irCalls, expectedHumanization)
  })

  test('genericErc721Humanizer', () => {
    accountOp.calls = [...transactions.erc721]
    const irCalls = genericErc721Humanizer(accountOp, accountOp.calls)

    compareHumanizerVisualizations(irCalls, [
      [
        getAction('Grant approval'),
        getLabel('for'),
        getToken('0x59468516a8259058bad1ca5f8f4bff190d30e066', 1n),
        getLabel('to'),
        getAddressVisualization(spender)
      ],
      [
        getAction('Revoke approval'),
        getLabel('for'),
        getToken('0x59468516a8259058bad1ca5f8f4bff190d30e066', 1n)
      ],
      [
        getAction('Grant approval', { warning: true }),
        getLabel('for all NFTs of'),
        getAddressVisualization('0x59468516a8259058bad1ca5f8f4bff190d30e066'),
        getLabel('to'),
        getAddressVisualization(spender)
      ],
      [
        getAction('Revoke approval'),
        getLabel('for all nfts from'),
        getAddressVisualization('0x59468516a8259058bad1ca5f8f4bff190d30e066'),
        getLabel('for'),
        getAddressVisualization(spender)
      ],
      [
        getAction('Send'),
        getToken('0x59468516a8259058bad1ca5f8f4bff190d30e066', 0n),
        getLabel('to'),
        getAddressVisualization(spender)
      ],
      [
        getAction('Transfer'),
        getToken('0x59468516a8259058bad1ca5f8f4bff190d30e066', 0n),
        getLabel('from'),
        getAddressVisualization('0xC89B38119C58536d818f3Bf19a9E3870828C1994'),
        getLabel('to'),
        getAddressVisualization(spender)
      ],
      [
        getAction('Transfer'),
        getToken('0x59468516a8259058bad1ca5f8f4bff190d30e066', 0n),
        getLabel('from'),
        getAddressVisualization('0xC89B38119C58536d818f3Bf19a9E3870828C1994'),
        getLabel('to'),
        getAddressVisualization(spender)
      ]
    ])
  })
})
