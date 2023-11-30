import { AbiCoder, JsonRpcProvider } from 'ethers'
import fetch from 'node-fetch'

import { describe, expect } from '@jest/globals'

import { getNonce } from '../../../test/helpers'
import { networks } from '../../consts/networks'
import { Account, AccountStates } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { getAccountState } from '../accountState/accountState'
import { Portfolio } from '../portfolio/portfolio'
import { estimate, EstimateResult } from './estimate'

const ethereum = networks.find((x) => x.id === 'ethereum')
const optimism = networks.find((x) => x.id === 'optimism')
if (!ethereum || !optimism) throw new Error('no network')
const provider = new JsonRpcProvider(ethereum.rpcUrl)
const providerOptimism = new JsonRpcProvider(optimism.rpcUrl)

const account = {
  addr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
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

// USDC -> USDT swap
// Fee tokens: USDC, USDT
const data = `0x5ae401dc${expire}00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000a07d75aacefd11b425af7181958f0f85c312f14300000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000c33d9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000`

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

const providers = Object.fromEntries(
  networks.map((network) => [network.id, new JsonRpcProvider(network.rpcUrl)])
)
const getAccountsInfo = async (accounts: Account[]): Promise<AccountStates> => {
  const result = await Promise.all(
    networks.map((network) => getAccountState(providers[network.id], network, accounts))
  )
  const states = accounts.map((acc: Account, accIndex: number) => {
    return [
      acc.addr,
      Object.fromEntries(
        networks.map((network: NetworkDescriptor, netIndex: number) => {
          return [network.id, result[netIndex][accIndex]]
        })
      )
    ]
  })
  return Object.fromEntries(states)
}

describe('estimate', () => {
  const checkNativeBalance = (
    responseTokens: EstimateResult['feePaymentOptions'],
    tokenAddresses: string[]
  ) => {
    tokenAddresses.forEach((tokenAddress) => {
      expect(
        responseTokens!.find((t) => t.paidBy === tokenAddress)!.availableAmount
      ).toBeGreaterThan(0n)
    })
  }

  it('estimates gasUsage and native balance for EOA', async () => {
    const EOAAccount = {
      addr: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
      associatedKeys: ['0x40b38765696e3d5d8d9d834d8aad4bb6e418e489'],
      creation: null
    }

    const call = {
      to: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
      value: BigInt(1),
      data: '0xabc5345e000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000020000000000000000000000000e750fff1aa867dfb52c9f98596a0fab5e05d30a60000000000000000000000000000000000000000000000000de0b6b3a764000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000'
    }

    const op = {
      accountAddr: EOAAccount.addr,
      signingKeyAddr: null,
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'ethereum',
      nonce: null,
      signature: null,
      calls: [call],
      accountOpToExecuteBefore: null
    }

    const accountStates = await getAccountsInfo([EOAAccount])
    const response = await estimate(
      provider,
      ethereum,
      EOAAccount,
      op,
      accountStates[EOAAccount.addr][ethereum.id],
      [],
      []
    )

    // This is the min gas unit we can spend
    expect(response.gasUsed).toBeGreaterThan(21000n)
    expect(response.feePaymentOptions![0].availableAmount).toBeGreaterThan(0)
    expect(response.nonce).toBeGreaterThan(1)
  })

  it('estimates gasUsage, fee and native tokens outcome', async () => {
    const op = {
      accountAddr: account.addr,
      signingKeyAddr: null,
      signingKeyType: null,
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

    const accountStates = await getAccountsInfo([account])
    const response = await estimate(
      provider,
      ethereum,
      account,
      op,
      accountStates[account.addr][ethereum.id],
      nativeToCheck,
      feeTokens
    )
    const usdtOutcome = response.feePaymentOptions!.find(
      (token) => token.address === '0xdAC17F958D2ee523a2206206994597C13D831ec7'
    )
    const usdcOutcome = response.feePaymentOptions!.find(
      (token) => token.address === '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    )

    // This is the min gas unit we can spend, but we expect more than that having in mind that multiple computations happens in the Contract
    expect(response.gasUsed).toBeGreaterThan(21000n)
    // As we swap 1 USDC for 1 USDT, we expect the estimate (outcome) balance of USDT to be greater than before the estimate (portfolio value)
    expect(usdtOutcome!.availableAmount).toBeGreaterThan(usdt?.amount || 0n)
    expect(usdcOutcome!.availableAmount).toBeLessThan(usdc!.amount)
    checkNativeBalance(response.feePaymentOptions, nativeToCheck)
    expect(response.nonce).toBeGreaterThan(1)
  })

  it('estimates with `accountOpToExecuteBefore`', async () => {
    const op = {
      accountAddr: account.addr,
      signingKeyAddr: null,
      signingKeyType: null,
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
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'ethereum',
      nonce: null, // does not matter when estimating
      signature: spoofSig,
      calls: [{ to, value: BigInt(0), data }],
      accountOpToExecuteBefore: {
        accountAddr: account.addr,
        signingKeyAddr: null,
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'ethereum',
        nonce: await getNonce(account.addr, provider),
        signature: spoofSig,
        calls: [{ to, value: BigInt(0), data }],
        accountOpToExecuteBefore: null
      }
    }

    const accountStates = await getAccountsInfo([account])
    const response = await estimate(
      provider,
      ethereum,
      account,
      op,
      accountStates[account.addr][ethereum.id],
      nativeToCheck,
      feeTokens
    )
    const responseWithExecuteBefore = await estimate(
      provider,
      ethereum,
      account,
      opWithExecuteBefore,
      accountStates[account.addr][ethereum.id],
      nativeToCheck,
      feeTokens,
      { calculateRefund: true }
    )

    // Gas used in case of `accountOpToExecuteBefore` should be greater, because more AccountOps are simulated
    expect(responseWithExecuteBefore.gasUsed).toBeGreaterThan(response.gasUsed)
  })

  it('estimates with `addedNative`', async () => {
    const accountOptimism = {
      addr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      associatedKeys: ['0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175'],
      creation: {
        factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
        bytecode:
          '0x7f00000000000000000000000000000000000000000000000000000000000000017fc00d23fd13e6cc01978ac25779646c3ba8aa974211c51a8b0f257a4593a6b7d3553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
        salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
      }
    }

    const dataOptimism = `0x5ae401dc${expire}00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000420000000000000000000000000000000000004200000000000000000000000094b008aa00579c1307b0ef2c499ad98a8ce58e580000000000000000000000000000000000000000000000000000000000000bb8000000000000000000000000b674f3fd5f43464db0448a57529eaf37f04ccea50000000000000000000000000000000000000000000000000de0b6b3a7640000000000000000000000000000000000000000000000000000000000000012dde3000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000`

    const opOptimism = {
      accountAddr: accountOptimism.addr,
      signingKeyAddr: accountOptimism.associatedKeys[0],
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'optimism',
      nonce: null, // does not matter when estimating
      signature: spoofSig,
      calls: [{ to, value: BigInt(0), data: dataOptimism }],
      accountOpToExecuteBefore: null
    }

    const accountStates = await getAccountsInfo([accountOptimism])
    const response = await estimate(
      providerOptimism,
      optimism,
      accountOptimism,
      opOptimism,
      accountStates[accountOptimism.addr][optimism.id],
      nativeToCheck,
      feeTokens
    )

    expect(response.addedNative).toBeGreaterThan(0n)
  })
})
