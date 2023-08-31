import { describe, expect, test } from '@jest/globals'

import fetch from 'node-fetch'
import { ErrorRef } from 'controllers/eventEmitter'
import { AccountOp } from '../accountOp/accountOp'
import { callsToIr, humanize, visualizationToText } from '.'

import { uniswapHumanizer } from './modules/Uniswap'
import { HumanizerVisualization, Ir, IrCall } from './interfaces'
import { wethHumanizer } from './modules/weth'
import { aaveHumanizer } from './modules/Aave'
import { yearnVaultModule } from './modules/yearnTesseractVault'
import { genericErc20Humanizer, genericErc721Humanizer, tokenParsing } from './modules/tokens'
import { oneInchHumanizer } from './modules/oneInch'
import { WALLETModule } from './modules/WALLET'
import { fallbackHumanizer } from './modules/fallBackHumanizer'
import { nameParsing } from './modules/nameParsing'

// @TODO add oneinchtests
const humanizerInfo = require('../../consts/humanizerInfo.json')

const humanizerModules: Function[] = [
  genericErc20Humanizer,
  genericErc721Humanizer,
  uniswapHumanizer,
  wethHumanizer,
  aaveHumanizer,
  oneInchHumanizer,
  WALLETModule,
  yearnVaultModule,
  fallbackHumanizer,
  nameParsing,
  tokenParsing
]

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
  ]
}

let emitedErrors = []
const moockEmitError = (e: ErrorRef) => emitedErrors.push(e)
const standartOptions = { fetch, emitError: moockEmitError }
describe('module tests', () => {
  beforeEach(async () => {
    accountOp.humanizerMeta = { ...humanizerInfo }
    accountOp.calls = []
    emitedErrors = []
  })

  test('visualization to text', async () => {
    const expectedTexification = [
      'Swap 50844.919041919270406243 XLRT for at least 0.137930462904193673 ETH and send it to 0x0000000000000000000000000000000000000000 (0x000...000) already expired',
      'Swap 0.941 WETH for at least 5158707941840645403045 0x6E975115250B05C828ecb8edeDb091975Fc20a5d token and send it to 0xbb6C8c037b9Cc3bF1a4C4188d92e5D86bfCE76A8 (0xbb6...6A8) already expired',
      'Swap 422.775565331912310692 SHARES for at least 2454.922038 USDC and send it to 0xca124B356bf11dc153B886ECB4596B5cb9395C41 (0xca1...C41) already expired',
      'Swap up to 4825320403256397423633 0x6E975115250B05C828ecb8edeDb091975Fc20a5d token for 0.941 WETH and send it to 0xbb6C8c037b9Cc3bF1a4C4188d92e5D86bfCE76A8 (0xbb6...6A8) already expired',
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
      'Approve 0xC92E8bdf79f0507f65a392b0ab4667716BFE0110 (Gnosis Protocol) for 33427.0 yDAI'
    ]
    const allCalls = Object.keys(transactions)
      .map((key: string) => transactions[key])
      .flat()
    accountOp.calls = allCalls
    let [ir, asyncOps] = humanize(accountOp, humanizerModules, standartOptions)
    ;(await Promise.all(asyncOps)).forEach((a) => {
      if (a) accountOp.humanizerMeta = { ...accountOp.humanizerMeta, [a.key]: a.value }
    })
    ;[ir, asyncOps] = humanize(accountOp, humanizerModules, standartOptions)
    const fragments = (await Promise.all(asyncOps)).filter((f) => f)
    fragments.forEach((f) => {
      if (f) accountOp.humanizerMeta = { ...accountOp.humanizerMeta, [f.key]: f.value }
    })
    ;[ir, asyncOps] = humanize(accountOp, humanizerModules, standartOptions)

    const res = ir.calls.map((call: IrCall) => visualizationToText(call, standartOptions))
    expectedTexification.forEach((et: string, i: number) => expect(res[i]).toEqual(et))
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
          address: '0x0000000000000000000000000000000000000000',
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
      ]
    ]
    accountOp.calls = [...transactions.uniV3]
    let ir: Ir = callsToIr(accountOp)
    ;[ir] = uniswapHumanizer(accountOp, ir)
    ir.calls.forEach((c, i) => {
      expect(c?.fullVisualization?.length).toEqual(expectedhumanization[i].length)
      c?.fullVisualization?.forEach((v: HumanizerVisualization, j: number) => {
        expect(v).toEqual(expectedhumanization[i][j])
      })
    })
  })
  test('WETH', () => {
    accountOp.calls = [...transactions.weth]
    let ir: Ir = callsToIr(accountOp)
    ;[ir] = wethHumanizer(accountOp, ir)
    expect(ir.calls[0]?.fullVisualization).toEqual([
      { type: 'action', content: 'Wrap' },
      {
        type: 'token',
        address: '0x0000000000000000000000000000000000000000',
        amount: transactions.weth[0].value
      }
    ])
    expect(ir.calls[1]?.fullVisualization).toEqual([
      { type: 'action', content: 'Unwrap' },
      {
        type: 'token',
        address: '0x0000000000000000000000000000000000000000',
        amount: 8900000000000000n
      }
    ])
    expect(ir.calls[2]?.fullVisualization).toBeUndefined()
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
    let ir: Ir = callsToIr(accountOp)
    ;[ir] = aaveHumanizer(accountOp, ir)
    ir.calls.forEach((c, i) =>
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
    let ir: Ir = callsToIr(accountOp)
    ;[ir] = WALLETModule(accountOp, ir)

    ir.calls.forEach((c, i) =>
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
    let ir: Ir = callsToIr(accountOp)
    ;[ir] = yearnVaultModule(accountOp, ir)
    ir.calls.forEach((call, i) =>
      call?.fullVisualization?.forEach((v: HumanizerVisualization, j: number) =>
        expect(v).toMatchObject(expectedhumanization[i][j])
      )
    )
  })
})
