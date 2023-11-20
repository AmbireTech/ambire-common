import fetch from 'node-fetch'
import { describe, expect, test } from '@jest/globals'
import { ethers } from 'ethers'

import { ErrorRef } from '../../controllers/eventEmitter'
import { AccountOp } from '../accountOp/accountOp'
import { humanizeCalls, visualizationToText } from './humanizerFuncs'
import { HumanizerCallModule, HumanizerVisualization, IrCall } from './interfaces'
import { aaveHumanizer } from './modules/Aave'
import { fallbackHumanizer } from './modules/fallBackHumanizer'
import { genericErc20Humanizer, genericErc721Humanizer } from './modules/tokens'
import { uniswapHumanizer } from './modules/Uniswap'
// import { oneInchHumanizer } from './modules/oneInch'
import { WALLETModule } from './modules/WALLET'
import { wrappingModule } from './modules/wrapped'
import { yearnVaultModule } from './modules/yearnTesseractVault'
import { parseCalls } from './parsers'
import { nameParsing } from './parsers/nameParsing'
import { tokenParsing } from './parsers/tokenParsing'
import { getAction, getLabel, getToken } from './utils'
import { sushiSwapModule } from './modules/sushiSwapModule'

const humanizerInfo = require('../../consts/humanizerInfo.json')

const humanizerModules: HumanizerCallModule[] = [
  genericErc20Humanizer,
  genericErc721Humanizer,
  uniswapHumanizer,
  wrappingModule,
  aaveHumanizer,
  // oneInchHumanizer,
  WALLETModule,
  yearnVaultModule,
  fallbackHumanizer
]
const TETHER_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
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
  accountOpToExecuteBefore: null,
  // This is fed into the humanizer to help visualize the accountOp
  // This can contain info like the value of specific share tokens at the time of signing,
  // or any other data that needs to otherwise be retrieved in an async manner and/or needs to be
  // "remembered" at the time of signing in order to visualize history properly
  humanizerMeta: {}
}
const transactions: { [key: string]: Array<IrCall> } = {
  uniV3: [
    // first part of this has recipient 0x000...000. idk why
    // muticall
    {
      to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      value: 0n,
      data: '0xac9650d800000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000104414bf3890000000000000000000000008a3c710e41cd95799c535f22dbae371d7c858651000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2000000000000000000000000000000000000000000000000000000000000271000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000064e5d5e7000000000000000000000000000000000000000000000ac44eff60b2f4be486300000000000000000000000000000000000000000000000001ea0706751c1289000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004449404b7c00000000000000000000000000000000000000000000000001ea0706751c1289000000000000000000000000bc5a0707cc6c731debea1f0388a4240df93259e400000000000000000000000000000000000000000000000000000000'
    },
    // exactInputSingle
    {
      to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      value: 0n,
      data: '0x414bf389000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20000000000000000000000006e975115250b05c828ecb8ededb091975fc20a5d00000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000bb6c8c037b9cc3bf1a4c4188d92e5d86bfce76a80000000000000000000000000000000000000000000000000000000064e5ddc90000000000000000000000000000000000000000000000000d0f1a83ada48000000000000000000000000000000000000000000000000117a7744519162631a50000000000000000000000000000000000000000000000000000000000000000'
    },
    // exactInput
    {
      to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
      value: 0n,
      data: '0xc04b8d59000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000ca124b356bf11dc153b886ecb4596b5cb9395c410000000000000000000000000000000000000000000000000000000064e5ccb7000000000000000000000000000000000000000000000016eb3088b55b95bfa400000000000000000000000000000000000000000000000000000000925323360000000000000000000000000000000000000000000000000000000000000042ebb82c932759b515b2efc1cfbb6bf2f6dbace404002710c02aaa39b223fe8d0a0e5c4f27ead9083c756cc20001f4a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000000'
    },
    // exactOutputSingle
    {
      to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
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
    }
  ],
  weth: [
    // deposit
    {
      to: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      value: 1000000000000000000n,
      data: '0xd0e30db0'
    },
    // withdraw
    {
      to: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      value: 1000000000000000000n,
      data: '0x2e1a7d4d000000000000000000000000000000000000000000000000001f9e80ba804000'
    },
    // should not enter weth module, should be Call deposit(), a func not in UniV3
    {
      to: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
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
      to: '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935',
      value: 0n,
      data: '0xa59f3e0c00000000000000000000000000000000000000000000021e19e0c9bab2400000'
    }, // leave
    {
      to: '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935',
      value: 0n,
      data: '0x9b4ee06400000000000000000000000000000000000000000002172be687fbab0bd4bfd10000000000000000000000000000000000000000000000000000000000000000'
    }, // rage leave
    {
      to: '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935',
      value: 0n,
      data: '0x8a07b41900000000000000000000000000000000000000000000006d7daaded78ae996310000000000000000000000000000000000000000000000000000000000000000'
    }
  ],
  yearn: [
    // deposit dai
    {
      to: '0xda816459f1ab5631232fe5e97a05bbbb94970c95',
      value: 0n,
      data: '0x6e553f6500000000000000000000000000000000000000000000002567ac70392b880000000000000000000000000000c4a6bb5139123bd6ba0cf387828a9a3a73ef8d1e00000000000000000000000000000000000000000000000000000000'
    },
    // withdraw
    {
      to: '0xdA816459F1AB5631232FE5e97a05BBBb94970c95',
      value: 0n,
      data: '0x2e1a7d4d000000000000000000000000000000000000000000000506c08e407186fe9165'
    },
    // approve
    {
      to: '0xdA816459F1AB5631232FE5e97a05BBBb94970c95',
      value: 0n,
      data: '0x095ea7b3000000000000000000000000c92e8bdf79f0507f65a392b0ab4667716bfe011000000000000000000000000000000000000000000000071414d02429e66c0000'
    }
  ],
  sushiSwapCalls: [
    {
      to: '0xE7eb31f23A5BefEEFf76dbD2ED6AdC822568a5d2',
      value: 0n,
      data: '0x2646478b0000000000000000000000000d500b1d8e8ef31e21c99d1db9a6444d3adf127000000000000000000000000000000000000000000000000000016bcc41e900000000000000000000000000008f3cf7ad23cd3cadbd9735aff958023239c6a06300000000000000000000000000000000000000000000000000013d425a52399d0000000000000000000000006969174fd72466430a46e18234d0b530c9fd5f4900000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000042020d500B1d8E8eF31E21C99d1Db9A6444d3ADf127001ffff008929D3FEa77398F64448c85015633c2d6472fB29016969174FD72466430a46e18234D0b530c9FD5f49000000000000000000000000000000000000000000000000000000000000'
    }
  ]
}

let emitedErrors: ErrorRef[] = []
const moockEmitError = (e: ErrorRef) => emitedErrors.push(e)
const standartOptions = { fetch, emitError: moockEmitError }
describe('module tests', () => {
  beforeEach(async () => {
    accountOp.humanizerMeta = { ...humanizerInfo }
    accountOp.calls = []
    emitedErrors = []
  })

  // TODO: look into improper texification for  unrecognized tokens
  test('visualization to text', async () => {
    const expectedTexification = [
      'Swap 50844.919041919270406243 XLRT for at least 0.137930462904193673 ETH and send it to 0x0000000000000000000000000000000000000000 (0x000...000) already expired',
      'Swap 0.941 WETH for at least 5158707941840645403045 0x6E975115250B05C828ecb8edeDb091975Fc20a5d token and send it to 0xbb6C8c037b9Cc3bF1a4C4188d92e5D86bfCE76A8 (0xbb6...6A8) already expired',
      'Swap 422.775565331912310692 SHARES for at least 2454.922038 USDC and send it to 0xca124B356bf11dc153B886ECB4596B5cb9395C41 (0xca1...C41) already expired',
      'Swap up to 4825320403256397423633 0x6E975115250B05C828ecb8edeDb091975Fc20a5d token for 0.941 WETH and send it to 0xbb6C8c037b9Cc3bF1a4C4188d92e5D86bfCE76A8 (0xbb6...6A8) already expired',
      'Swap 0.0001 ETH for at least 0.178131 USDC already expired',
      'Swap 100.0 USDC for at least 72003605256085551 0x2e9a6Df78E42a30712c10a9Dc4b1C8656f8F2879 token and send it to 0x02a3109c4CE8354Ee771fEaC419B5da04Ef15761 (0x02a...761) already expired',
      'Wrap 1.0 ETH',
      'Unwrap 0.0089 ETH',
      'Call deposit() from 0xE592427A0AEce92De3Edee1F18E0157C05861564 (Uniswap) and Send 1.0 ETH',
      'Deposit 11.72018633376687831 STETH to Aave lending pool on befalf of 0x7F4cF2E68f968cc050B3783268C474a15b8BDC2e (0x7F4...C2e)',
      'Withdraw all USDC from Aave lending pool on befalf of 0x8BC110Db7029197C3621bEA8092aB1996D5DD7BE (0x8BC...7BE)',
      'Deposit 0.135592697552 ETH to Aave lending pool on befalf of 0x47c353467326E6Bd0c01E728E8F7D1A06A849395 (0x47c...395)',
      'Withdraw 0.000000000473401923 ETH from Aave lending pool on befalf of 0x0DF1A69fCDf15FEC04e37Aa5ECA4268927B111e7 (0x0DF...1e7)',
      'Deposit 10000.0 WALLET to 0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935 (WALLET Staking Pool)',
      'Leave with 2527275.889852892335882193 WALLET 0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935 (WALLET Staking Pool)',
      'Rage leave with 2019.750399052452828721 WALLET 0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935 (WALLET Staking Pool)',
      'Deposit 690.0 yDAI to 0xdA816459F1AB5631232FE5e97a05BBBb94970c95 (Yearn DAI Vault)',
      'Withdraw 23736.387977148798767461 yDAI from 0xdA816459F1AB5631232FE5e97a05BBBb94970c95 (Yearn DAI Vault)',
      'Approve 0xC92E8bdf79f0507f65a392b0ab4667716BFE0110 (CowSwap) for 33427.0 yDAI'
    ]
    const allCalls = Object.keys(transactions)
      .map((key: string) => transactions[key])
      .flat()
    accountOp.calls = allCalls
    let [irCalls, asyncOps] = humanizeCalls(accountOp, humanizerModules, standartOptions)
    let [parsedCalls, newAsyncOps] = parseCalls(
      accountOp,
      irCalls,
      [nameParsing, tokenParsing],
      standartOptions
    )
    irCalls = parsedCalls
    asyncOps.push(...newAsyncOps)
    ;(await Promise.all(asyncOps)).forEach((a) => {
      if (a) accountOp.humanizerMeta = { ...accountOp.humanizerMeta, [a.key]: a.value }
    })
    ;[irCalls, asyncOps] = humanizeCalls(accountOp, humanizerModules, standartOptions)
    ;[parsedCalls, newAsyncOps] = parseCalls(
      accountOp,
      irCalls,
      [nameParsing, tokenParsing],
      standartOptions
    )
    irCalls = parsedCalls
    asyncOps.push(...newAsyncOps)
    const res = irCalls.map((call: IrCall) => visualizationToText(call, standartOptions))

    expectedTexification.forEach((et: string, i: number) => expect(et).toEqual(res[i]))
  })
  test('uniV3', () => {
    const expectedhumanization = [
      [
        { type: 'action', content: 'Swap' },
        {
          type: 'token',
          address: '0x8a3C710E41cD95799C535f22DBaE371D7C858651',
          amount: 50844919041919270406243n
        },
        { type: 'label', content: 'for at least' },
        {
          type: 'token',
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          amount: 137930462904193673n
        },
        { type: 'label', content: 'and send it to' },
        {
          type: 'address',
          address: '0x0000000000000000000000000000000000000000'
        },
        { type: 'label', content: 'already expired' }
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
          address: '0xBc5A0707cc6c731debEA1f0388a4240Df93259E4'
        }
      ],
      [
        { type: 'action', content: 'Swap' },
        {
          type: 'token',
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          amount: 941000000000000000n
        },
        { type: 'label', content: 'for at least' },
        {
          type: 'token',
          address: '0x6E975115250B05C828ecb8edeDb091975Fc20a5d',
          amount: 5158707941840645403045n
        },
        { type: 'label', content: 'and send it to' },
        {
          type: 'address',
          address: '0xbb6C8c037b9Cc3bF1a4C4188d92e5D86bfCE76A8'
        },
        { type: 'label', content: 'already expired' }
      ],
      [
        { type: 'action', content: 'Swap' },
        {
          type: 'token',
          address: '0xebB82c932759B515B2efc1CfBB6BF2F6dbaCe404',
          amount: 422775565331912310692n
        },
        { type: 'label', content: 'for at least' },
        {
          type: 'token',
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
          amount: 2454922038n
        },
        { type: 'label', content: 'and send it to' },
        {
          type: 'address',
          address: '0xca124B356bf11dc153B886ECB4596B5cb9395C41'
        },
        { type: 'label', content: 'already expired' }
      ],
      [
        { type: 'action', content: 'Swap up to' },
        {
          type: 'token',
          address: '0x6E975115250B05C828ecb8edeDb091975Fc20a5d',
          amount: 4825320403256397423633n
        },
        { type: 'label', content: 'for' },
        {
          type: 'token',
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
          amount: 941000000000000000n
        },
        { type: 'label', content: 'and send it to' },
        {
          type: 'address',
          address: '0xbb6C8c037b9Cc3bF1a4C4188d92e5D86bfCE76A8'
        },
        { type: 'label', content: 'already expired' }
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
          address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
          amount: 178131n
        },
        { type: 'label', content: 'already expired' }
      ],
      [
        { type: 'action', content: 'Swap' },
        {
          type: 'token',
          address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
          amount: 100000000n
        },
        { type: 'label', content: 'for at least' },
        {
          type: 'token',
          address: '0x2e9a6Df78E42a30712c10a9Dc4b1C8656f8F2879',
          amount: 72003605256085551n
        },
        { type: 'label', content: 'and send it to' },
        {
          type: 'address',
          address: '0x02a3109c4CE8354Ee771fEaC419B5da04Ef15761'
        },
        { type: 'label', content: 'already expired' }
      ]
    ]
    accountOp.calls = [...transactions.uniV3]
    let irCalls: IrCall[] = accountOp.calls
    ;[irCalls] = uniswapHumanizer(accountOp, irCalls, { emitedError: moockEmitError })
    expect(irCalls.length).toBe(expectedhumanization.length)
    irCalls.forEach((c, i) => {
      expect(c?.fullVisualization?.length).toEqual(expectedhumanization[i].length)
      c?.fullVisualization?.forEach((v: HumanizerVisualization, j: number) => {
        expect(v).toEqual(expectedhumanization[i][j])
      })
    })
  })
  test('WETH', () => {
    accountOp.calls = [...transactions.weth]
    let irCalls: IrCall[] = accountOp.calls
    ;[irCalls] = wrappingModule(accountOp, irCalls)
    expect(irCalls[0]?.fullVisualization).toEqual([
      { type: 'action', content: 'Wrap' },
      {
        type: 'token',
        address: '0x0000000000000000000000000000000000000000',
        amount: transactions.weth[0].value
      }
    ])
    expect(irCalls[1]?.fullVisualization).toEqual([
      { type: 'action', content: 'Unwrap' },
      {
        type: 'token',
        address: '0x0000000000000000000000000000000000000000',
        amount: 8900000000000000n
      }
    ])
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
        address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        amount: 1000000000n
      },
      { type: 'label', content: '0x123456789' },
      {
        type: 'token',
        address: '0x0000000000000000000000000000000000000000',
        amount: 1000000000n
      }
    ]

    const [newCalls] = wrappingModule(accountOp, calls)
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
    ;[irCalls] = aaveHumanizer(accountOp, irCalls)
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
          address: '0x88800092fF476844f74dC2FC427974BBee2794Ae',
          amount: 10000000000000000000000n
        },
        { type: 'label', content: 'to' },
        {
          type: 'address',
          address: '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935'
        }
      ],
      [
        { type: 'action', content: 'Leave' },
        { type: 'label', content: 'with' },
        {
          type: 'token',
          address: '0x88800092fF476844f74dC2FC427974BBee2794Ae',
          amount: 2527275889852892335882193n
        },
        {
          type: 'address',
          address: '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935'
        }
      ],
      [
        { type: 'action', content: 'Rage leave' },
        { type: 'label', content: 'with' },
        {
          type: 'token',
          address: '0x88800092fF476844f74dC2FC427974BBee2794Ae',
          amount: 2019750399052452828721n
        },
        {
          type: 'address',
          address: '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935'
        }
      ]
    ]
    accountOp.calls = [...transactions.WALLET]
    let irCalls: IrCall[] = accountOp.calls
    ;[irCalls] = WALLETModule(accountOp, irCalls)

    irCalls.forEach((c, i) =>
      c?.fullVisualization?.forEach((v: HumanizerVisualization, j: number) =>
        expect(v).toMatchObject(expectedhumanization[i][j])
      )
    )
  })
  test('yearn', () => {
    accountOp.calls = [...transactions.yearn]
    const expectedhumanization = [
      [
        { content: 'Deposit' },
        { type: 'token', symbol: 'yDAI' },
        { content: 'to' },
        { address: '0xdA816459F1AB5631232FE5e97a05BBBb94970c95' }
      ],
      [
        { content: 'Withdraw' },
        { type: 'token', symbol: 'yDAI' },
        { content: 'from' },
        { address: '0xdA816459F1AB5631232FE5e97a05BBBb94970c95' }
      ],
      [
        { content: 'Approve' },
        { address: '0xC92E8bdf79f0507f65a392b0ab4667716BFE0110' },
        { content: 'for' },
        { type: 'token', symbol: 'yDAI' }
      ]
    ]
    let irCalls: IrCall[] = accountOp.calls
    ;[irCalls] = yearnVaultModule(accountOp, irCalls)
    irCalls.forEach((call, i) =>
      call?.fullVisualization?.forEach((v: HumanizerVisualization, j: number) =>
        expect(v).toMatchObject(expectedhumanization[i][j])
      )
    )
  })
  test('SushiSwap RouteProcessor', () => {
    const expectedhumanization: HumanizerVisualization[] = [
      { type: 'action', content: 'Swap' },
      {
        type: 'token',
        address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
        amount: 400000000000000n
      },
      { type: 'label', content: 'for' },
      {
        type: 'token',
        address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063',
        amount: 348830169184669n
      }
    ]
    accountOp.calls = [...transactions.sushiSwapCalls]
    let irCalls: IrCall[] = accountOp.calls
    ;[irCalls] = sushiSwapModule(accountOp, irCalls)
    expect(irCalls.length).toBe(1)
    expectedhumanization.forEach((h: HumanizerVisualization, i: number) => {
      expect(irCalls[0]?.fullVisualization?.[i]).toMatchObject(h)
    })
  })
})
