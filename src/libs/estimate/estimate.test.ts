import { JsonRpcProvider, AbiCoder } from 'ethers'
import { describe, expect } from '@jest/globals'
import fetch from 'node-fetch'
import { estimate, EstimateResult } from './estimate'

import { networks } from '../../consts/networks'
import { Portfolio } from '../portfolio/portfolio'

const ethereum = networks.find((x) => x.id === 'ethereum')
if (!ethereum) throw new Error('no eth')
const provider = new JsonRpcProvider(ethereum.rpcUrl)

const account = {
  addr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
  label: '',
  pfp: '',
  associatedKeys: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
  creation: {
    factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
    bytecode:
      '0x7f28d4ea8f825adb036e9b306b2269570e63d2aa5bd10751437d98ed83551ba1cd7fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
  }
}
const to = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'

const tomorrowHex = Math.floor((Date.now() + 86400000) / 1000).toString(16)
// 64 chars expire hex
// we set swap deadline always for tomorrow, in order to prevent the test failure with 'TRANSACTION TOO OLD'
const expire = '0'.repeat(64 - tomorrowHex.length) + tomorrowHex

// USDT -> USDC swap
// Fee tokens: USDT, USDC
const data = `0x5ae401dc${expire}00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000a07d75aacefd11b425af7181958f0f85c312f14300000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000c33d9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000`

const SPOOF_SIGTYPE = '03'
const spoofSig =
  new AbiCoder().encode(['address'], ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E']) + SPOOF_SIGTYPE

const nativeToCheck = [
  '0x0000000000000000000000000000000000000001',
  '0x942f9CE5D9a33a82F88D233AEb3292E680230348'
]
const feeTokens = [
  '0x0000000000000000000000000000000000000000',
  '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
]

const portfolio = new Portfolio(fetch, provider, ethereum)

describe('estimate', () => {
  const checkBalance = (
    responseTokens: EstimateResult['nativeAssetBalances'],
    tokenAddresses: string[]
  ) => {
    tokenAddresses.forEach((tokenAddress) => {
      expect(responseTokens.find((t) => t.address === tokenAddress)!.balance).toBeGreaterThan(0n)
    })
  }

  it('estimates gasUsage, fee and native tokens outcome', async () => {
    const op = {
      accountAddr: account.addr,
      signingKeyAddr: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'ethereum',
      nonce: null, // does not matter when estimating
      signature: spoofSig,
      calls: [{ to, value: BigInt(0), data }],
      accountOpToExecuteBefore: null
    }

    const portfolioResponse = await portfolio.get('0xa07D75aacEFd11b425AF7181958F0F85c312f143')
    const usdt = portfolioResponse.tokens.find(
      (token) => token.address === '0xdAC17F958D2ee523a2206206994597C13D831ec7'
    )
    const usdc = portfolioResponse.tokens.find(
      (token) => token.address === '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    )

    const response = await estimate(provider, ethereum, account, op, nativeToCheck, feeTokens)
    const usdtOutcome = response.feeTokenOutcome.find(
      (token) => token.address === '0xdAC17F958D2ee523a2206206994597C13D831ec7'
    )
    const usdcOutcome = response.feeTokenOutcome.find(
      (token) => token.address === '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    )

    // This is the min gas unit we can spend, but we expect more than that having in mind that multiple computations happens in the Contract
    expect(response.gasUsed).toBeGreaterThan(21000n)
    // As we swap 1 USDT for 1 USDC, we expect the estimate (outcome) balance of USDC to be greater than before the estimate (portfolio value)
    expect(usdcOutcome!.balance).toBeGreaterThan(usdc!.amount)
    expect(usdtOutcome!.balance).toBeLessThan(usdt!.amount)
    checkBalance(response.nativeAssetBalances, nativeToCheck)
  })

  it('estimates with `accountOpToExecuteBefore`', async () => {
    const op = {
      accountAddr: account.addr,
      signingKeyAddr: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'ethereum',
      nonce: null, // does not matter when estimating
      signature: spoofSig,
      calls: [{ to, value: BigInt(0), data }],
      accountOpToExecuteBefore: null
    }

    const opWithExecuteBefore = {
      accountAddr: account.addr,
      signingKeyAddr: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'ethereum',
      nonce: null, // does not matter when estimating
      signature: spoofSig,
      calls: [{ to, value: BigInt(0), data }],
      accountOpToExecuteBefore: {
        accountAddr: account.addr,
        signingKeyAddr: null,
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'ethereum',
        // @TODO - read it from Contract
        nonce: 360,
        signature: spoofSig,
        calls: [{ to, value: BigInt(0), data }],
        accountOpToExecuteBefore: null
      }
    }

    const response = await estimate(provider, ethereum, account, op, nativeToCheck, feeTokens)
    const responseWithExecuteBefore = await estimate(
      provider,
      ethereum,
      account,
      opWithExecuteBefore,
      nativeToCheck,
      feeTokens,
      { calculateRefund: true }
    )

    // Gas used in case of `accountOpToExecuteBefore` should be greater, because more AccountOps are simulated
    expect(responseWithExecuteBefore.gasUsed).toBeGreaterThan(response.gasUsed)
  })
})
