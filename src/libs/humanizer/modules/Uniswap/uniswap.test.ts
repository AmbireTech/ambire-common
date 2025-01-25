import { ZeroAddress } from 'ethers'

import { expect } from '@jest/globals'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerMeta, HumanizerVisualization, IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getRecipientText,
  getToken
} from '../../utils'
import { uniswapHumanizer } from '.'

const transactions = {
  firstBatch: [
    // Swap exact WALLET for x  USDC
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
  ],
  secondBatch: [
    // first part of this has recipient 0x000...000. idk why
    // muticall
    {
      to: '0xe592427a0aece92de3edee1f18e0157c05861564',
      value: 0n,
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000104414bf3890000000000000000000000008a3c710e41cd95799c535f22dbae371d7c858651000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000064e5d5e7000000000000000000000000000000000000000000000ac44eff60b2f4be486300000000000000000000000000000000000000000000000001ea0706751c1289000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004449404b7c00000000000000000000000000000000000000000000000001ea0706751c1289000000000000000000000000B674F3fd5F43464dB0448a57529eAF37F04cceA500000000000000000000000000000000000000000000000000000000'
    },
    // exactInputSingle
    {
      to: '0xe592427a0aece92de3edee1f18e0157c05861564',
      value: 0n,
      data: '0x414bf389000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000006e975115250b05c828ecb8ededb091975fc20a5d00000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000bb6c8c037b9cc3bf1a4c4188d92e5d86bfce76a80000000000000000000000000000000000000000000000000000000064e5ddc90000000000000000000000000000000000000000000000000d0f1a83ada48000000000000000000000000000000000000000000000000117a7744519162631a50000000000000000000000000000000000000000000000000000000000000000'
    },
    // exactInput
    {
      to: '0xe592427a0aece92de3edee1f18e0157c05861564',
      value: 0n,
      data: '0xc04b8d59000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000ca124b356bf11dc153b886ecb4596b5cb9395c410000000000000000000000000000000000000000000000000000000064e5ccb7000000000000000000000000000000000000000000000016eb3088b55b95bfa400000000000000000000000000000000000000000000000000000000925323360000000000000000000000000000000000000000000000000000000000000042ebb82c932759b515b2efc1cfbb6bf2f6dbace404002710c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000000'
    },
    // exactOutputSingle
    {
      to: '0xe592427a0aece92de3edee1f18e0157c05861564',
      value: 0n,
      data: '0xdb3e21980000000000000000000000006e975115250b05c828ecb8ededb091975fc20a5d000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc200000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000bb6c8c037b9cc3bf1a4c4188d92e5d86bfce76a80000000000000000000000000000000000000000000000000000000064e5d7910000000000000000000000000000000000000000000000000d0f1a83ada4800000000000000000000000000000000000000000000000010594c5cd1e563664110000000000000000000000000000000000000000000000000000000000000000'
    },
    // problematic Call execute(bytes,bytes[],uint256) from 0xeC8...3e4
    {
      to: '0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4',
      value: 100000000000000n,
      data: '0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000006544eb3300000000000000000000000000000000000000000000000000000000000000040b000604000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002800000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000005af3107a40000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000005af3107a4000000000000000000000000000000000000000000000000000000000000002b7d300000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002b42000000000000000000000000000000000000060001f40b2c639c533813f4aa9d7837caf62653d097ff8500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff85000000000000000000000000d4ce1f1b8640c1988360a6729d9a73c85a0c80a3000000000000000000000000000000000000000000000000000000000000000f00000000000000000000000000000000000000000000000000000000000000600000000000000000000000000b2c639c533813f4aa9d7837caf62653d097ff850000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000002b7d3'
    },
    {
      to: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
      value: 0n,
      data: '0x5ae401dc0000000000000000000000000000000000000000000000000000000065577b450000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000124b858183f0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000008000000000000000000000000002a3109c4ce8354ee771feac419b5da04ef157610000000000000000000000000000000000000000000000000000000005f5e10000000000000000000000000000000000000000000000000000ffcee5c1d6202f0000000000000000000000000000000000000000000000000000000000000042ff970a61a04b1ca14834a43f5de4533ebddb5cc80001f482af49447d8a07e3bd95bd0d56f35241523fbab10027102e9a6df78e42a30712c10a9dc4b1c8656f8f287900000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    },
    // multicall with typed data signature
    {
      to: '0x643770E279d5D0733F21d6DC03A8efbABf3255B4',
      value: 0n,
      data: '0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000065cfa09900000000000000000000000000000000000000000000000000000000000000030a000c00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001e0000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000001600000000000000000000000003c499c542cef5e3811e1192ce70d8cc03d5c3359000000000000000000000000ffffffffffffffffffffffffffffffffffffffff0000000000000000000000000000000000000000000000000000000065f72aff0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000643770e279d5d0733f21d6dc03a8efbabf3255b40000000000000000000000000000000000000000000000000000000065cfa50700000000000000000000000000000000000000000000000000000000000000e0000000000000000000000000000000000000000000000000000000000000004187f8e3fd141a1d34658366ac8b3a1254c581fa087f43b539933a32561fb6638956c28fc6681ce67fa0fd946a3de61ff11633ea07572b12b1534b239e81c5600e1b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000027100000000000000000000000000000000000000000000000000024ba5664e2f5f600000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002b3c499c542cef5e3811e1192ce70d8cc03d5c33590001f40d500b1d8e8ef31e21c99d1db9a6444d3adf1270000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000024ba5664e2f5f6'
    }
  ],
  reduce: [
    // swap is split into wrap and 2 swaps, total of 3 subcalls from the multicall
    {
      to: '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad',
      value: 40000000000000000000n,
      data: '0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000667195d300000000000000000000000000000000000000000000000000000000000000050b08000604000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000220000000000000000000000000000000000000000000000000000000000000036000000000000000000000000000000000000000000000000000000000000003e0000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000022b1c8c1227a00000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000020f5b1eaad8d800000000000000000000000000000000000000000009709c1c233c5dbd0524336a0f00000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000761d38e5ddf6ccf6cf7c55759d5210750b5d60f3000000000000000000000000000000000000000000000000000000000000012000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000001bc16d674ec8000000000000000000000000000000000000000000007e9b02785c11302ffa0094d500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000042c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48002710761d38e5ddf6ccf6cf7c55759d5210750b5d60f30000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000761d38e5ddf6ccf6cf7c55759d5210750b5d60f3000000000000000000000000000000fee13a103a10d593b9ae06b3e05f2e7e1c00000000000000000000000000000000000000000000000000000000000000190000000000000000000000000000000000000000000000000000000000000060000000000000000000000000761d38e5ddf6ccf6cf7c55759d5210750b5d60f300000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000009e92c7d41e8484ad0a00858dc'
    },
    {
      to: '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
      value: 8123440160495934950000n,
      data: '0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000066c5c76b00000000000000000000000000000000000000000000000000000000000000050b0105040c000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000022000000000000000000000000000000000000000000000000000000000000002a00000000000000000000000000000000000000000000000000000000000000320000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000b460694200cdc9700000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000007d7b90d00000000000000000000000000000000000000000000000000b460694200cdc9700000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000002bdac17f958d2ee523a2206206994597c13d831ec7000064c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000060000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000000000fee13a103a10d593b9ae06b3e05f2e7e1c0000000000000000000000000000000000000000000000000000000000501bd00000000000000000000000000000000000000000000000000000000000000060000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec70000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000007d2b7500000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000'
    }
  ],
  liquidity: [
    {
      to: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
      value: 6904077431543n,
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001e0000000000000000000000000000000000000000000000000000000000000016488316456000000000000000000000000420000000000000000000000000000000000000600000000000000000000000042000000000000000000000000000000000000420000000000000000000000000000000000000000000000000000000000000bb80000000000000000000000000000000000000000000000000000000000010680000000000000000000000000000000000000000000000000000000000001395c000000000000000000000000000000000000000000000000000006477b1532f7000000000000000000000000000000000000000000000000002386f26fc0fb37000000000000000000000000000000000000000000000000000006398832c336000000000000000000000000000000000000000000000000002332282c76bce20000000000000000000000006969174fd72466430a46e18234d0b530c9fd5f490000000000000000000000000000000000000000000000000000000066e4233100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000412210e8a00000000000000000000000000000000000000000000000000000000'
    }
  ]
}

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

describe('uniswap', () => {
  test('uniV3', () => {
    const expectedhumanization = [
      [
        getAction('Swap'),
        getToken('0x8a3c710e41cd95799c535f22dbae371d7c858651', 50844919041919270406243n),
        getLabel('for at least'),
        getToken('0x0000000000000000000000000000000000000000', 137930462904193673n),
        getDeadline(1692784103n)
      ],
      [
        getAction('Swap'),
        getToken('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 941000000000000000n),
        getLabel('for at least'),
        getToken('0x6e975115250b05c828ecb8ededb091975fc20a5d', 5158707941840645403045n),
        getLabel('and send it to'),
        getAddressVisualization('0xbb6c8c037b9cc3bf1a4c4188d92e5d86bfce76a8'),
        getDeadline(1692786121n)
      ],
      [
        getAction('Swap'),
        getToken('0xebb82c932759b515b2efc1cfbb6bf2f6dbace404', 422775565331912310692n),
        getLabel('for at least'),
        getToken('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 2454922038n),
        getLabel('and send it to'),
        getAddressVisualization('0xca124b356bf11dc153b886ecb4596b5cb9395c41'),
        getDeadline(1692781751n)
      ],
      [
        getAction('Swap up to'),
        getToken('0x6e975115250b05c828ecb8ededb091975fc20a5d', 4825320403256397423633n),
        getLabel('for'),
        getToken('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 941000000000000000n),
        getLabel('and send it to'),
        getAddressVisualization('0xbb6c8c037b9cc3bf1a4c4188d92e5d86bfce76a8'),
        getDeadline(1692784529n)
      ],
      [
        getAction('Swap'),
        getToken('0x0000000000000000000000000000000000000000', 100000000000000n),
        getLabel('for at least'),
        getToken('0x0b2c639c533813f4aa9d7837caf62653d097ff85', 178131n),
        getDeadline(1699015475n)
      ],
      [
        getAction('Swap'),
        getToken('0xff970a61a04b1ca14834a43f5de4533ebddb5cc8', 100000000n),
        getLabel('for at least'),
        getToken('0x2e9a6df78e42a30712c10a9dc4b1c8656f8f2879', 72003605256085551n),
        getLabel('and send it to'),
        getAddressVisualization('0x02a3109c4ce8354ee771feac419b5da04ef15761'),
        getDeadline(1700232005n)
      ],
      [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(
          '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
          1461501637330902918203684832716283019655932542975n
        ),
        getLabel('to'),
        getAddressVisualization('0x643770e279d5d0733f21d6dc03a8efbabf3255b4'),
        getLabel('and'),
        getAction('Swap'),
        getToken('0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', 10000n),
        getLabel('for at least'),
        getToken('0x0000000000000000000000000000000000000000', 10337979384133110n),
        getDeadline(1708105881n)
      ]
    ]
    accountOp.calls = [...transactions.secondBatch]
    let irCalls: IrCall[] = accountOp.calls
    irCalls = uniswapHumanizer(accountOp, irCalls, humanizerInfo as HumanizerMeta, {})
    expect(irCalls.length).toBe(expectedhumanization.length)
    compareHumanizerVisualizations(irCalls, expectedhumanization as HumanizerVisualization[][])
  })

  test('uniSwap', () => {
    accountOp.calls = [...transactions.firstBatch]
    const irCalls = uniswapHumanizer(accountOp, accountOp.calls, humanizerInfo as HumanizerMeta)
    const expectedVisualization = [
      [
        getAction('Swap'),
        getToken('0x88800092ff476844f74dc2fc427974bbee2794ae', 1000000000000000000000n),
        getLabel('for at least'),
        getToken('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 8605812n),
        getDeadline(1690449491n)
      ],
      [
        getAction('Swap up to'),
        getToken('0xade00c28244d5ce17d72e40330b1c318cd12b7c3', 700615739821805074156n),
        getLabel('for'),
        getToken('0x6b175474e89094c44da98b954eedeac495271d0f', 100000000000000000000n),
        getDeadline(1690448831n)
      ],
      [
        getAction('Swap up to'),
        getToken('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', 1843430147568080264n),
        getLabel('for'),
        getToken('0x046eee2cc3188071c02bfc1745a6b17c656e3f3d', 21436976040000000000000n),
        getLabel('and send it to'),
        getAddressVisualization('0x5a5be6b067d6b5b018adbcd27ee6972105b3b400'),
        getDeadline(1691677015n),
        getLabel('and'),
        getAction('Refund')
      ]
    ]
    expect(irCalls.length).toEqual(expectedVisualization.length)
    compareHumanizerVisualizations(irCalls, expectedVisualization as HumanizerVisualization[][])
  })
  test('Reduce', () => {
    accountOp.calls = [...transactions.reduce]
    const irCalls = uniswapHumanizer(accountOp, accountOp.calls, humanizerInfo as HumanizerMeta)
    const expectedVisualization = [
      [
        getAction('Swap'),
        getToken(ZeroAddress, 40000000000000000000n),
        getLabel('for at least'),
        getToken('0x761d38e5ddf6ccf6cf7c55759d5210750b5d60f3', 787087015436983109239662968548n),
        getDeadline(1718719955n)
      ],
      [
        getAction('Swap up to'),
        getToken(ZeroAddress, 812344016049593495n),
        getLabel('for'),
        getToken('0xdac17f958d2ee523a2206206994597c13d831ec7', 2100000000n),
        getDeadline(1724237675n)
      ]
    ]
    expect(irCalls.length).toEqual(expectedVisualization.length)

    compareHumanizerVisualizations(irCalls, expectedVisualization as HumanizerVisualization[][])
  })
  test('Liquidity', async () => {
    accountOp.calls = [...transactions.liquidity]
    const irCalls = uniswapHumanizer(accountOp, accountOp.calls, humanizerInfo as HumanizerMeta)
    const expectedVisualization = [
      [
        getAction('Add liquidity'),
        getToken('0x4200000000000000000000000000000000000006', 6844167930678n),
        getToken('0x4200000000000000000000000000000000000042', 9906772310932706n),
        getLabel('pair'),
        ...getRecipientText(ZeroAddress, '0x6969174fd72466430a46e18234d0b530c9fd5f49'),
        getDeadline(1726227249n),
        getLabel('and'),
        getAction('Withdraw'),
        getToken(ZeroAddress, 6904077431543n)
      ]
    ]
    expect(irCalls.length).toEqual(expectedVisualization.length)
    compareHumanizerVisualizations(irCalls, expectedVisualization as HumanizerVisualization[][])
  })
})
