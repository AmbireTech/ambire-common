import { ethers } from 'ethers'
import fetch from 'node-fetch'

import { describe, expect, test } from '@jest/globals'

import { FEE_COLLECTOR } from '../../consts/addresses'
import _humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { ErrorRef } from '../../controllers/eventEmitter/eventEmitter'
import { AccountOp } from '../accountOp/accountOp'
import { humanizeCalls, visualizationToText } from './humanizerFuncs'
import { humanizerCallModules as humanizerModules } from './index'
import { HumanizerFragment, HumanizerMeta, HumanizerVisualization, IrCall } from './interfaces'
import { aaveHumanizer } from './modules/Aave'
import { privilegeHumanizer } from './modules/privileges'
import { sushiSwapModule } from './modules/sushiSwapModule'
import { uniswapHumanizer } from './modules/Uniswap'
// import { oneInchHumanizer } from './modules/oneInch'
import { WALLETModule } from './modules/WALLET'
import { wrappingModule } from './modules/wrapped'
import { parseCalls } from './parsers'
import { humanizerMetaParsing } from './parsers/humanizerMetaParsing'
import { getAction, getLabel, getToken, integrateFragments } from './utils'

const humanizerInfo = _humanizerInfo as HumanizerMeta
const TETHER_ADDRESS = '0xdac17f958d2ee523a2206206994597c13d831ec7'
const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const accountOp: AccountOp = {
  accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  networkId: 'ethereum',
  // networkId: 'polygon',
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
const transactions: { [key: string]: Array<IrCall> } = {
  uniV3: [
    // first part of this has recipient 0x000...000. idk why
    // muticall
    {
      to: '0xe592427a0aece92de3edee1f18e0157c05861564',
      value: 0n,
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000104414bf3890000000000000000000000008a3c710e41cd95799c535f22dbae371d7c858651000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000064e5d5e7000000000000000000000000000000000000000000000ac44eff60b2f4be486300000000000000000000000000000000000000000000000001ea0706751c1289000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004449404b7c00000000000000000000000000000000000000000000000001ea0706751c1289000000000000000000000000bc5a0707cc6c731debea1f0388a4240df93259e400000000000000000000000000000000000000000000000000000000'
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
  weth: [
    // deposit
    {
      to: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      value: 1000000000000000000n,
      data: '0xd0e30db0'
    },
    // withdraw
    {
      to: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      value: 1000000000000000000n,
      data: '0x2e1a7d4d000000000000000000000000000000000000000000000000001f9e80ba804000'
    },
    // should not enter weth module, should be Call deposit(), a func not in UniV3
    {
      to: '0xe592427a0aece92de3edee1f18e0157c05861564',
      value: 1000000000000000000n,
      data: '0xd0e30db0'
    }
  ],
  aaveLendingPoolV2: [
    // deposit
    {
      to: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
      value: 0n,
      data: '0xe8eda9df000000000000000000000000ae7ab96520de3a18e5e111b5eaab095312d7fe84000000000000000000000000000000000000000000000000a2a6775fd59004660000000000000000000000007f4cf2e68f968cc050b3783268c474a15b8bdc2e0000000000000000000000000000000000000000000000000000000000000000'
    },
    // withdraw
    {
      to: '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9',
      value: 0n,
      data: '0x69328dec000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000000000000000000000008bc110db7029197c3621bea8092ab1996d5dd7be'
    }
  ],
  aaveWethGatewayV2: [
    // deposit
    {
      to: '0xcc9a0B7c43DC2a5F023Bb9b738E45B0Ef6B06E04',
      value: 135592697552000000n,
      data: '0x474cf53d0000000000000000000000007d2768de32b0b80b7a3454c06bdac94a69ddc7a900000000000000000000000047c353467326e6bd0c01e728e8f7d1a06a84939500000000000000000000000000000000000000000000000000000000000000bb'
    },
    // withdraw
    {
      to: '0xcc9a0B7c43DC2a5F023Bb9b738E45B0Ef6B06E04',
      value: 0n,
      data: '0x80500d200000000000000000000000007d2768de32b0b80b7a3454c06bdac94a69ddc7a9000000000000000000000000000000000000000000000000000000001c378a430000000000000000000000000df1a69fcdf15fec04e37aa5eca4268927b111e7'
    }
  ],
  WALLET: [
    // enter
    {
      to: '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935',
      value: 0n,
      data: '0xa59f3e0c00000000000000000000000000000000000000000000021e19e0c9bab2400000'
    }, // leave
    {
      to: '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935',
      value: 0n,
      data: '0x9b4ee06400000000000000000000000000000000000000000002172be687fbab0bd4bfd10000000000000000000000000000000000000000000000000000000000000000'
    }, // rage leave
    {
      to: '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935',
      value: 0n,
      data: '0x8a07b41900000000000000000000000000000000000000000000006d7daaded78ae996310000000000000000000000000000000000000000000000000000000000000000'
    }
  ],
  sushiSwapCalls: [
    {
      to: '0xE7eb31f23A5BefEEFf76dbD2ED6AdC822568a5d2',
      value: 0n,
      data: '0x2646478b0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000016bcc41e900000000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a06300000000000000000000000000000000000000000000000000013d425a52399d0000000000000000000000006969174fd72466430a46e18234d0b530c9fd5f4900000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000042020d500B1d8E8eF31E21C99d1Db9A6444d3ADf127001ffff008929D3FEa77398F64448c85015633c2d6472fB29016969174FD72466430a46e18234D0b530c9FD5f49000000000000000000000000000000000000000000000000000000000000'
    }
  ],
  gasTank: [
    {
      to: FEE_COLLECTOR,
      value: 500000000000000000n,
      data: '0x'
    },
    {
      to: '0x2791bca1f2de4661ed88a30c99a7a9449aa84174',
      value: 0n,
      data: '0xa9059cbb000000000000000000000000942f9ce5d9a33a82f88d233aeb3292e68023034800000000000000000000000000000000000000000000000000000000000003e8'
    }
  ],
  privileges: [
    {
      to: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      value: 0n,
      data: '0x0d5828d40000000000000000000000005ff137d4b0fdcd49dca30c7cf57e578a026d27890000000000000000000000000000000000000000000000000000000000007171'
    },
    {
      to: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      value: 0n,
      data: '0x0d5828d40000000000000000000000006969174FD72466430a46e18234D0b530c9FD5f490000000000000000000000000000000000000000000000000000000000000001'
    },
    {
      to: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      value: 0n,
      data: '0x0d5828d40000000000000000000000006969174FD72466430a46e18234D0b530c9FD5f490000000000000000000000000000000000000000000000000000000000000000'
    }
  ]
}

let emitedErrors: ErrorRef[] = []
const moockEmitError = (e: ErrorRef) => emitedErrors.push(e)
const standartOptions = { fetch, emitError: moockEmitError }
describe('module tests', () => {
  beforeEach(async () => {
    accountOp.calls = []
    emitedErrors = []
  })

  // TODO: look into improper texification for  unrecognized tokens
  test('visualization to text', async () => {
    const expectedTexification = [
      'Swap 50844.919041919270406243 XLRT for at least 0.137930462904193673 ETH and send it to 0x0000000000000000000000000000000000000000 (Blackhole) already expired',
      'Swap 0.941 WETH for at least 5158707941840645403045 0x6e975115250b05c828ecb8ededb091975fc20a5d token and send it to 0xbb6c8c037b9cc3bf1a4c4188d92e5d86bfce76a8 already expired',
      'Swap 422.775565331912310692 SHARES for at least 2454.922038 USDC and send it to 0xca124b356bf11dc153b886ecb4596b5cb9395c41 already expired',
      'Swap up to 4825320403256397423633 0x6e975115250b05c828ecb8ededb091975fc20a5d token for 0.941 WETH and send it to 0xbb6c8c037b9cc3bf1a4c4188d92e5d86bfce76a8 already expired',
      'Swap 0.0001 ETH for at least 0.178131 USDC already expired',
      'Swap 100.0 USDC for at least 0.072003605256085551 MKR and send it to 0x02a3109c4ce8354ee771feac419b5da04ef15761 already expired',
      'Approved Uniswap to use the following token via signed message.',
      'Swap 0.01 USDC for at least 0.01033797938413311 ETH already expired',
      'Wrap 1.0 ETH',
      'Unwrap 0.0089 ETH',
      'Call deposit() from 0xe592427a0aece92de3edee1f18e0157c05861564 (Uniswap) and Send 1.0 ETH',
      'Deposit 11.72018633376687831 STETH to Aave lending pool on befalf of 0x7f4cf2e68f968cc050b3783268c474a15b8bdc2e',
      'Withdraw all USDC from Aave lending pool on befalf of 0x8bc110db7029197c3621bea8092ab1996d5dd7be',
      'Deposit 0.135592697552 ETH to Aave lending pool on befalf of 0x47c353467326e6bd0c01e728e8f7d1a06a849395',
      'Withdraw 0.000000000473401923 ETH from Aave lending pool on befalf of 0x0df1a69fcdf15fec04e37aa5eca4268927b111e7',
      'Deposit 10000.0 WALLET to 0x47cd7e91c3cbaaf266369fe8518345fc4fc12935 (WALLET Staking Pool)',
      'Leave with 2527275.889852892335882193 WALLET 0x47cd7e91c3cbaaf266369fe8518345fc4fc12935 (WALLET Staking Pool)',
      'Rage leave with 2019.750399052452828721 WALLET 0x47cd7e91c3cbaaf266369fe8518345fc4fc12935 (WALLET Staking Pool)',
      'Swap 0.0004 WMATIC for 0.000348830169184669 DAI and send it to 0x6969174fd72466430a46e18234d0b530c9fd5f49',
      'Fuel gas tank with 0.5 ETH',
      'Fuel gas tank with 0.001 USDC.e',
      'Enable 0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789 (Account abstraction entry point v0.6.0)',
      'Update access status of 0x6969174fd72466430a46e18234d0b530c9fd5f49 to regular access',
      'Revoke access of 0x6969174fd72466430a46e18234d0b530c9fd5f49'
    ]
    const allCalls = Object.keys(transactions)
      .map((key: string) => transactions[key])
      .flat()
    accountOp.calls = allCalls
    let [irCalls, asyncOps] = humanizeCalls(
      accountOp,
      humanizerModules,
      humanizerInfo,
      standartOptions
    )
    // irCalls.forEach((c: IrCall, i) => {
    //   console.log(c.fullVisualization, i)
    // })
    let [parsedCalls, newAsyncOps] = parseCalls(
      accountOp,
      irCalls,
      [humanizerMetaParsing],
      humanizerInfo,
      standartOptions
    )
    irCalls = parsedCalls
    asyncOps.push(...newAsyncOps)
    const frags: HumanizerFragment[] = (await Promise.all(asyncOps)).filter(
      (x) => x
    ) as HumanizerFragment[]
    // @TODO use new combination function
    const newHumanizerMeta = integrateFragments(humanizerInfo as HumanizerMeta, frags)
    ;[irCalls, asyncOps] = humanizeCalls(
      accountOp,
      humanizerModules,
      newHumanizerMeta,
      standartOptions
    )
    ;[parsedCalls, newAsyncOps] = parseCalls(
      accountOp,
      irCalls,
      [humanizerMetaParsing],
      humanizerInfo,
      standartOptions
    )
    irCalls = parsedCalls
    asyncOps.push(...newAsyncOps)
    const res = irCalls.map((call: IrCall) => visualizationToText(call, standartOptions))
    expect(expectedTexification.length).toBe(res.length)
    expectedTexification.forEach((et: string, i: number) => expect(res[i]).toEqual(et))
  })
  test('uniV3', () => {
    const expectedhumanization = [
      [
        { type: 'action', content: 'Swap' },
        {
          type: 'token',
          address: '0x8a3c710e41cd95799c535f22dbae371d7c858651',
          amount: 50844919041919270406243n
        },
        { type: 'label', content: 'for at least' },
        {
          type: 'token',
          address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          amount: 137930462904193673n
        },
        { type: 'label', content: 'and send it to' },
        {
          type: 'address',
          address: '0x0000000000000000000000000000000000000000'
        },
        { type: 'deadline', amount: 1692784103000n }
      ],
      [
        { type: 'action', content: 'Unwrap' },
        {
          type: 'token',
          address: '0x0000000000000000000000000000000000000000',
          amount: 137930462904193673n
        },
        { type: 'label', content: 'and send it to' },
        {
          type: 'address',
          address: '0xbc5a0707cc6c731debea1f0388a4240df93259e4'
        }
      ],
      [
        { type: 'action', content: 'Swap' },
        {
          type: 'token',
          address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          amount: 941000000000000000n
        },
        { type: 'label', content: 'for at least' },
        {
          type: 'token',
          address: '0x6e975115250b05c828ecb8ededb091975fc20a5d',
          amount: 5158707941840645403045n
        },
        { type: 'label', content: 'and send it to' },
        {
          type: 'address',
          address: '0xbb6c8c037b9cc3bf1a4c4188d92e5d86bfce76a8'
        },
        { type: 'deadline', amount: 1692786121000n }
      ],
      [
        { type: 'action', content: 'Swap' },
        {
          type: 'token',
          address: '0xebb82c932759b515b2efc1cfbb6bf2f6dbace404',
          amount: 422775565331912310692n
        },
        { type: 'label', content: 'for at least' },
        {
          type: 'token',
          address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          amount: 2454922038n
        },
        { type: 'label', content: 'and send it to' },
        {
          type: 'address',
          address: '0xca124b356bf11dc153b886ecb4596b5cb9395c41'
        },
        { type: 'deadline', amount: 1692781751000n }
      ],
      [
        { type: 'action', content: 'Swap up to' },
        {
          type: 'token',
          address: '0x6e975115250b05c828ecb8ededb091975fc20a5d',
          amount: 4825320403256397423633n
        },
        { type: 'label', content: 'for' },
        {
          type: 'token',
          address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          amount: 941000000000000000n
        },
        { type: 'label', content: 'and send it to' },
        {
          type: 'address',
          address: '0xbb6c8c037b9cc3bf1a4c4188d92e5d86bfce76a8'
        },
        { type: 'deadline', amount: 1692784529000n }
      ],
      // problematic one
      [
        { type: 'action', content: 'Wrap' },
        {
          type: 'token',
          address: '0x0000000000000000000000000000000000000000',
          amount: 100000000000000n
        }
      ],
      [
        { type: 'action', content: 'Swap' },
        {
          type: 'token',
          address: '0x4200000000000000000000000000000000000006',
          amount: 100000000000000n
        },
        { type: 'label', content: 'for at least' },
        {
          type: 'token',
          address: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
          amount: 178131n
        },
        { type: 'deadline', amount: 1699015475000n }
      ],
      [
        { type: 'action', content: 'Swap' },
        {
          type: 'token',
          address: '0xff970a61a04b1ca14834a43f5de4533ebddb5cc8',
          amount: 100000000n
        },
        { type: 'label', content: 'for at least' },
        {
          type: 'token',
          address: '0x2e9a6df78e42a30712c10a9dc4b1c8656f8f2879',
          amount: 72003605256085551n
        },
        { type: 'label', content: 'and send it to' },
        {
          type: 'address',
          address: '0x02a3109c4ce8354ee771feac419b5da04ef15761'
        },
        { type: 'deadline', amount: 1700232005000n }
      ],
      [
        {
          type: 'label',
          content: 'Approved Uniswap to use the following token via signed message.'
        }
      ],
      [
        { type: 'action', content: 'Swap' },
        {
          type: 'token',
          address: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
          amount: 10000n
        },
        { type: 'label', content: 'for at least' },
        {
          type: 'token',
          address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
          amount: 10337979384133110n
        },
        { type: 'deadline', amount: 1708105881000n }
      ],
      [
        { type: 'action', content: 'Unwrap' },
        {
          type: 'token',
          address: '0x0000000000000000000000000000000000000000',
          amount: 10337979384133110n
        },
        { type: 'label', content: 'and send it to' },
        {
          type: 'address',
          address: '0x0000000000000000000000000000000000000001'
        }
      ]
    ]
    accountOp.calls = [...transactions.uniV3]
    let irCalls: IrCall[] = accountOp.calls
    ;[irCalls] = uniswapHumanizer(accountOp, irCalls, humanizerInfo, {
      emitedError: moockEmitError
    })
    expect(irCalls.length).toBe(expectedhumanization.length)
    irCalls.forEach((c, i) => {
      expect(c?.fullVisualization?.length).toEqual(expectedhumanization[i].length)
      c?.fullVisualization?.forEach((v: HumanizerVisualization, j: number) => {
        expect(v).toMatchObject(expectedhumanization[i][j])
      })
    })
  })
  test('WETH', () => {
    accountOp.calls = [...transactions.weth]
    let irCalls: IrCall[] = accountOp.calls
    ;[irCalls] = wrappingModule(accountOp, irCalls, humanizerInfo)
    expect(irCalls[0].fullVisualization?.length).toBe(2)
    expect(irCalls[0]?.fullVisualization![0]).toMatchObject({ type: 'action', content: 'Wrap' })
    expect(irCalls[0]?.fullVisualization![1]).toMatchObject({
      type: 'token',
      address: '0x0000000000000000000000000000000000000000',
      amount: transactions.weth[0].value
    })

    expect(irCalls[1].fullVisualization?.length).toBe(2)
    expect(irCalls[1]?.fullVisualization![0]).toMatchObject({ type: 'action', content: 'Unwrap' })
    expect(irCalls[1]?.fullVisualization![1]).toMatchObject({
      type: 'token',
      address: '0x0000000000000000000000000000000000000000',
      amount: 8900000000000000n
    })
    expect(irCalls[2]?.fullVisualization).toBeUndefined()
  })

  test('SWAP WRAP/UNWRAPS', () => {
    const placeholder = '0x123456789'
    const calls: IrCall[] = [
      {
        to: placeholder,
        data: placeholder,
        value: 0n,
        fullVisualization: [
          getAction('Swap'),
          getToken(TETHER_ADDRESS, 1000000000n),
          getLabel(placeholder),
          getToken(WETH_ADDRESS, 1000000000n)
        ]
      },
      {
        to: WETH_ADDRESS,
        data: placeholder,
        value: 0n,
        fullVisualization: [getAction('Unwrap'), getToken(ethers.ZeroAddress, 1000000000n)]
      }
    ]

    const expectedHumanization = [
      { type: 'action', content: 'Swap' },
      {
        type: 'token',
        address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
        amount: 1000000000n
      },
      { type: 'label', content: '0x123456789' },
      {
        type: 'token',
        address: '0x0000000000000000000000000000000000000000',
        amount: 1000000000n
      }
    ]

    const [newCalls] = wrappingModule(accountOp, calls, humanizerInfo)
    expect(newCalls.length).toBe(1)
    newCalls[0].fullVisualization?.map((v, i) => expect(v).toMatchObject(expectedHumanization[i]))
  })

  test('AAVE', () => {
    const expectedhumanization = [
      [
        { content: 'Deposit' },
        { type: 'token' },
        { content: 'to Aave lending pool' },
        { content: 'on befalf of' },
        { type: 'address' }
      ],
      [
        { content: 'Withdraw' },
        { type: 'token' },
        { content: 'from Aave lending pool' },
        { content: 'on befalf of' },
        { type: 'address' }
      ],
      [
        { content: 'Deposit' },
        { type: 'token' },
        { content: 'to Aave lending pool' },
        { content: 'on befalf of' },
        { type: 'address' }
      ],
      [
        { content: 'Withdraw' },
        { type: 'token' },
        { content: 'from Aave lending pool' },
        { content: 'on befalf of' },
        { type: 'address' }
      ]
    ]
    accountOp.calls = [...transactions.aaveLendingPoolV2, ...transactions.aaveWethGatewayV2]
    let irCalls: IrCall[] = accountOp.calls
    ;[irCalls] = aaveHumanizer(accountOp, irCalls, humanizerInfo)
    irCalls.forEach((c, i) =>
      c?.fullVisualization?.forEach((v: HumanizerVisualization, j: number) =>
        expect(v).toMatchObject(expectedhumanization[i][j])
      )
    )
  })
  test('WALLET', () => {
    const expectedhumanization = [
      [
        { type: 'action', content: 'Deposit' },
        {
          type: 'token',
          address: '0x88800092ff476844f74dc2fc427974bbee2794ae',
          amount: 10000000000000000000000n
        },
        { type: 'label', content: 'to' },
        {
          type: 'address',
          address: '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935'
        }
      ],
      [
        { type: 'action', content: 'Leave' },
        { type: 'label', content: 'with' },
        {
          type: 'token',
          address: '0x88800092ff476844f74dc2fc427974bbee2794ae',
          amount: 2527275889852892335882193n
        },
        {
          type: 'address',
          address: '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935'
        }
      ],
      [
        { type: 'action', content: 'Rage leave' },
        { type: 'label', content: 'with' },
        {
          type: 'token',
          address: '0x88800092ff476844f74dc2fc427974bbee2794ae',
          amount: 2019750399052452828721n
        },
        {
          type: 'address',
          address: '0x47cd7e91c3cbaaf266369fe8518345fc4fc12935'
        }
      ]
    ]
    accountOp.calls = [...transactions.WALLET]
    let irCalls: IrCall[] = accountOp.calls
    ;[irCalls] = WALLETModule(accountOp, irCalls, humanizerInfo)

    irCalls.forEach((c, i) =>
      c?.fullVisualization?.forEach((v: HumanizerVisualization, j: number) =>
        expect(v).toMatchObject(expectedhumanization[i][j])
      )
    )
  })

  test('SushiSwap RouteProcessor', () => {
    const expectedhumanization: Partial<HumanizerVisualization>[] = [
      { type: 'action', content: 'Swap' },
      {
        type: 'token',
        address: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
        amount: 400000000000000n
      },
      { type: 'label', content: 'for' },
      {
        type: 'token',
        address: '0x8f3cf7ad23cd3cadbd9735aff958023239c6a063',
        amount: 348830169184669n
      }
    ]
    accountOp.calls = [...transactions.sushiSwapCalls]
    let irCalls: IrCall[] = accountOp.calls
    ;[irCalls] = sushiSwapModule(accountOp, irCalls, humanizerInfo)
    expect(irCalls.length).toBe(1)
    expectedhumanization.forEach((h: Partial<HumanizerVisualization>, i: number) => {
      expect(irCalls[0]?.fullVisualization?.[i]).toMatchObject(h)
    })
  })

  test('Privilege Humanizer', async () => {
    const expectedhumanization: Partial<HumanizerVisualization>[][] = [
      [
        { type: 'action', content: 'Enable' },
        {
          type: 'address',
          address: '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789'
        }
      ],
      [
        { type: 'action', content: 'Update access status' },
        { type: 'label', content: 'of' },
        {
          type: 'address',
          address: '0x6969174fd72466430a46e18234d0b530c9fd5f49'
        },
        { type: 'label', content: 'to' },
        {
          type: 'label',
          content: 'regular access'
        }
      ],
      [
        { type: 'action', content: 'Revoke access' },
        { type: 'label', content: 'of' },
        {
          type: 'address',
          address: '0x6969174fd72466430a46e18234d0b530c9fd5f49'
        }
      ]
    ]
    accountOp.calls = [...transactions.privileges]
    let irCalls: IrCall[] = accountOp.calls
    ;[irCalls] = privilegeHumanizer(accountOp, irCalls, humanizerInfo)

    expect(irCalls.length).toBe(expectedhumanization.length)
    expectedhumanization.forEach(
      (callHumanization: Partial<HumanizerVisualization>[], i: number) => {
        callHumanization.forEach((h: Partial<HumanizerVisualization>, j: number) =>
          expect(irCalls[i]?.fullVisualization?.[j]).toMatchObject(h)
        )
      }
    )
  })
})
