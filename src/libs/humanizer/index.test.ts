import { ethers } from 'ethers'
import fetch from 'node-fetch'
import { describe, expect, jest, test } from '@jest/globals'

import { HumanizerVisualization, IrCall, IrMessage } from 'libs/humanizer/interfaces'
import { Message, TypedMessage } from 'interfaces/userRequest'
import { Key } from 'libs/keystore/keystore'
import { ErrorRef } from 'controllers/eventEmitter'
import humanizerJSON from '../../consts/humanizerInfo.json'
import { Storage } from '../../interfaces/storage'
import { AccountOp } from '../accountOp/accountOp'
import { produceMemoryStore } from '../../../test/helpers'
import { Account } from '../../interfaces/account'
import { callsHumanizer, messageHumanizer } from '.'

const HUMANIZER_META_KEY = 'HumanizerMeta'

// const address1 = '0x6942069420694206942069420694206942069420'
const address2 = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa'
const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

const humanizerMeta = humanizerJSON
const accountOp: AccountOp = {
  accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  networkId: '1',
  // this may not be defined, in case the user has not picked a key yet
  signingKeyAddr: null,
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

const accounts: Account[] = [
  {
    addr: '0xAAbBbC841F29Dc6b09EF9f6c8fd59DA807bc6248',
    label: 'First account',
    pfp: 'string',
    associatedKeys: ['string[]'],
    creation: null
  }
]
const keys: Key[] = [
  {
    addr: '0xABcdeF398CBb1285Eeb2DC42be2c429eB1d55f02',
    type: 'internal',
    label: 'Second account',
    isExternallyStored: true,
    meta: null
  }
]
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
  ],
  unknownFuncSelector: [
    {
      to: '0x519856887AF544De7e67f51A4F2271521b01432b',
      value: BigInt(0),
      data: '0xd96a094a0000000000000000000000000000000000000000000000000000000064c233bf'
    }
  ],

  accountOrKeyArg: [
    // approve erc-20 token USDT
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: '0x095ea7b3000000000000000000000000aabbbC841f29Dc6B09eF9F6c8fD59da807Bc6248000000000000000000000000000000000000000000000000000000003b9aca00'
    },
    {
      to: '0xdac17f958d2ee523a2206206994597c13d831ec7',
      value: BigInt(0),
      data: '0x095ea7b3000000000000000000000000ABcdeF398CBb1285Eeb2DC42be2c429eB1d55f02000000000000000000000000000000000000000000000000000000003b9aca00'
    }
  ]
}

const emitError = jest.fn((err: ErrorRef) => {
  console.log(err)
})
describe('HumanizerController', () => {
  let storage: Storage
  beforeEach(async () => {
    storage = produceMemoryStore()
    await storage.set(HUMANIZER_META_KEY, humanizerMeta)
    accountOp.calls = []
    accountOp.humanizerMeta = humanizerJSON
  })

  test('generic humanize', async () => {
    // const ir: Ir = []
    const expectedVisualizations = [
      [
        { type: 'action', content: 'Send' },
        {
          type: 'token',
          address: '0x0000000000000000000000000000000000000000',
          amount: 1000000000000000000n
        },
        { type: 'label', content: 'to' },
        {
          type: 'address',
          address: '0xc4Ce03B36F057591B2a360d773eDB9896255051e'
        }
      ],
      [
        { type: 'action', content: 'Grant approval' },
        { type: 'label', content: 'for' },
        {
          type: 'nft',
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
          // id: 115792089237316195423570985008687907853269984665640564039457584007913129639935n
        },
        { type: 'label', content: 'to' },
        {
          type: 'address',
          address: '0xE5c783EE536cf5E63E792988335c4255169be4E1',
          name: 'OpenSea (old)'
          //   name: '0xE5c...4E1'
        }
      ]
    ]
    const onUpdate = jest.fn((newCalls: IrCall[]) => {
      newCalls.forEach((call, i) =>
        call.fullVisualization?.forEach((v, j) =>
          expect(v).toMatchObject(expectedVisualizations[i][j])
        )
      )
    })
    accountOp.calls = [...transactions.generic]
    await callsHumanizer(accountOp, [], storage, fetch, onUpdate, emitError)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  test('unknown func selector humanize with asyncop', async () => {
    const expectedVisualizations = [
      { type: 'action', content: 'Call buy(uint256)' },
      { type: 'label', content: 'from' },
      {
        type: 'address',
        address: '0x519856887AF544De7e67f51A4F2271521b01432b'
      }
    ]
    let iterations = 0
    const onUpdate = jest.fn((newCalls: IrCall[]) => {
      if (iterations === 0) {
        expect(newCalls[0]?.fullVisualization?.length).toBe(3)
        expect(newCalls[0]?.fullVisualization?.[0]).toMatchObject({
          type: 'action',
          content: 'Unknown action'
        })
      } else if (iterations === 1) {
        expect(newCalls[0]?.fullVisualization?.length).toBe(3)
        newCalls[0]?.fullVisualization?.forEach((v: HumanizerVisualization, i: number) =>
          expect(v).toMatchObject(expectedVisualizations[i])
        )
      }
      iterations += 1
    })
    accountOp.calls = [...transactions.unknownFuncSelector]
    await callsHumanizer(accountOp, [], storage, fetch, onUpdate, emitError)
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })
})

describe('TypedMessages', () => {
  let storage: Storage
  beforeEach(() => {
    storage = produceMemoryStore()
  })
  test('simple humanization', async () => {
    const message = {
      details: [
        {
          token: WETH_ADDRESS,
          amount: ethers.parseEther('1'),
          expiration: 968187600n,
          nonce: 1n
        },
        {
          token: WETH_ADDRESS,
          amount: ethers.parseEther('0.5'),
          expiration: 969187600n,
          nonce: 2n
        }
      ],
      spender: address2,
      sigDeadline: 968187600n
    }
    const tmTemplate: TypedMessage = {
      kind: 'typedMessage',
      domain: {
        name: 'random contract',
        version: '1',
        chainId: 1n,
        verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
        salt: '1'
      },
      types: { PermitBatch: [{ name: 'details', type: 'PermitDetails[]' }] },
      message,
      primaryType: 'Permit'
    }
    // public humanizeMessages(accountOp: AccountOp, messages: Message[]) {
    const messages: Message[] = [
      {
        id: 1,
        accountAddr: accountOp.accountAddr,
        content: tmTemplate,
        signature: null
      },
      {
        id: 2,
        accountAddr: accountOp.accountAddr,
        content: {
          kind: 'message',
          message: 'random message'
        },
        signature: null
      }
    ]
    const expectedVisualizations = [
      { type: 'label', content: 'Permit #1' },
      { type: 'action', content: 'Permit' },
      {
        type: 'address',
        address: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
        name: 'Permi 2 contract'
      },
      { type: 'label', content: 'to use' },
      {
        type: 'token',
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        amount: 1000000000000000000n,
        decimals: 18,
        readableAmount: '1.0',
        symbol: 'WETH'
      },
      { type: 'label', content: 'for time period' },
      { type: 'label', content: 'already expired' },
      { type: 'label', content: 'this whole signatuere' },
      { type: 'label', content: 'already expired' },
      { type: 'label', content: 'Permit #2' },
      { type: 'action', content: 'Permit' },
      {
        type: 'address',
        address: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
        name: 'Permi 2 contract'
      },
      { type: 'label', content: 'to use' },
      {
        type: 'token',
        address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        amount: 500000000000000000n,
        decimals: 18,
        readableAmount: '0.5',
        symbol: 'WETH'
      },
      { type: 'label', content: 'for time period' },
      { type: 'label', content: 'already expired' },
      { type: 'label', content: 'this whole signatuere' },
      { type: 'label', content: 'already expired' }
    ]
    const onUpdate = jest.fn((newMessage: IrMessage) => {
      if (newMessage.id === 1)
        newMessage.fullVisualization?.forEach((v, i) =>
          expect(expectedVisualizations[i]).toMatchObject(v)
        )
      if (newMessage.id === 2)
        expect(newMessage.fullVisualization).toEqual([
          { type: 'action', content: 'Sign message:' },
          { type: 'label', content: 'random message' }
        ])
    })

    await messageHumanizer(messages[0], [], storage, fetch, onUpdate, emitError)
    await messageHumanizer(messages[1], [], storage, fetch, onUpdate, emitError)
    // two times from first message, one from the second
    expect(onUpdate).toHaveBeenCalledTimes(3)
  })
})

describe('with (Account | Key)[] arg', () => {
  let storage: Storage
  beforeEach(async () => {
    storage = produceMemoryStore()
    await storage.set(HUMANIZER_META_KEY, humanizerMeta)
    accountOp.calls = []
    accountOp.humanizerMeta = humanizerJSON
  })
  test('with calls', async () => {
    const expectedVisualizations = [
      [
        { type: 'action', content: 'Grant approval' },
        { type: 'label', content: 'for' },
        { type: 'nft' },
        { type: 'label', content: 'to' },
        { name: 'First account' }
      ],
      [
        { type: 'action', content: 'Grant approval' },
        { type: 'label', content: 'for' },
        { type: 'nft' },
        { type: 'label', content: 'to' },
        { name: 'Second account' }
      ]
    ]
    accountOp.calls = [...transactions.accountOrKeyArg]

    const onUpdate = jest.fn((newCalls: IrCall[]) => {
      newCalls.forEach((c, i) =>
        c.fullVisualization?.forEach((v, j) =>
          expect(v).toMatchObject(expectedVisualizations[i][j])
        )
      )
    })
    await callsHumanizer(accountOp, [...accounts, ...keys], storage, fetch, onUpdate, emitError)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })
})
