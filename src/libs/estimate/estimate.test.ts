/* eslint no-console: "off" */

import { AbiCoder, ethers, JsonRpcProvider } from 'ethers'
import { AccountOp } from 'libs/accountOp/accountOp'
import fetch from 'node-fetch'

import { describe, expect } from '@jest/globals'

import { trezorSlot7v24337Deployed } from '../../../test/config'
import { getNonce } from '../../../test/helpers'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { AMBIRE_PAYMASTER } from '../../consts/deploy'
import { networks } from '../../consts/networks'
import { Account, AccountStates } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { getAccountState } from '../accountState/accountState'
import { Portfolio } from '../portfolio/portfolio'
import { estimate } from './estimate'

const ethereum = networks.find((x) => x.id === 'ethereum')
const optimism = networks.find((x) => x.id === 'optimism')
const arbitrum = networks.find((x) => x.id === 'arbitrum')
const avalanche = networks.find((x) => x.id === 'avalanche')
const polygon = networks.find((x) => x.id === 'polygon')
if (!ethereum || !optimism || !arbitrum || !avalanche || !polygon) throw new Error('no network')
const provider = new JsonRpcProvider(ethereum.rpcUrl)
const providerOptimism = new JsonRpcProvider(optimism.rpcUrl)
const providerArbitrum = new JsonRpcProvider(arbitrum.rpcUrl)
const providerAvalanche = new JsonRpcProvider(avalanche.rpcUrl)
const providerPolygon = new JsonRpcProvider(polygon.rpcUrl)

const account: Account = {
  addr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
  associatedKeys: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E'],
  initialPrivileges: [
    [
      '0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E',
      '0x0000000000000000000000000000000000000000000000000000000000000001'
    ]
  ],
  creation: {
    factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
    bytecode:
      '0x7f28d4ea8f825adb036e9b306b2269570e63d2aa5bd10751437d98ed83551ba1cd7fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
  }
}
const to = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'

const tomorrowHex = Math.floor((Date.now() + 86400000) / 1000).toString(16)
const yesterdayHex = Math.floor((Date.now() - 86400000) / 1000).toString(16)
// 64 chars expire hex
// we set swap deadline always for tomorrow, in order to prevent the test failure with 'TRANSACTION TOO OLD'
const expire = '0'.repeat(64 - tomorrowHex.length) + tomorrowHex

// USDC -> USDT swap
// Fee tokens: USDC, USDT
const data = `0x5ae401dc${expire}00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000a07d75aacefd11b425af7181958f0f85c312f14300000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000c33d9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000`

const expired = '0'.repeat(64 - yesterdayHex.length) + yesterdayHex
const expiredData = `0x5ae401dc${expired}00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec700000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000a07d75aacefd11b425af7181958f0f85c312f14300000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000c33d9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000`

const SPOOF_SIGTYPE = '03'
const spoofSig =
  new AbiCoder().encode(['address'], ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E']) + SPOOF_SIGTYPE

const viewOnlyAcc = {
  addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
  creation: null,
  initialPrivileges: [],
  associatedKeys: [] // this means it's a view only acc
}
const nativeToCheck: Account[] = [
  {
    addr: '0x0000000000000000000000000000000000000001',
    initialPrivileges: [],
    associatedKeys: ['0x0000000000000000000000000000000000000001'],
    creation: null
  },
  {
    addr: FEE_COLLECTOR,
    initialPrivileges: [],
    associatedKeys: ['0x0000000000000000000000000000000000000001'],
    creation: null
  },
  viewOnlyAcc
]
const feeTokens = [
  { address: '0x0000000000000000000000000000000000000000', isGasTank: false, amount: 1n },
  { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', isGasTank: false, amount: 1n },
  { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', isGasTank: false, amount: 1n }
]

const feeTokensAvalanche = [
  { address: '0x0000000000000000000000000000000000000000', isGasTank: false, amount: 1n },
  { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', isGasTank: false, amount: 1n }
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

const smartAccountv2eip712: Account = {
  addr: '0x4AA524DDa82630cE769e5C9d7ec7a45B94a41bc6',
  associatedKeys: ['0x141A14B5C4dbA2aC7a7943E02eDFE2E7eDfdA28F'],
  creation: {
    factoryAddr: '0xa8202f888b9b2dfa5ceb2204865018133f6f179a',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027fa70e7c3e588683d0493e3cad10209993d632b6631bc4637b53a4174bad869718553d602d80604d3d3981f3363d3d373d3d3d363d730e370942ebe4d026d05d2cf477ff386338fc415a5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  initialPrivileges: []
}

const trezorSlot6v2NotDeployed: Account = {
  addr: '0x29e54b17CAe69edaf2D7138053c23436aac1B379',
  associatedKeys: ['0x71c3D24a627f0416db45107353d8d0A5ae0401ae'],
  creation: {
    factoryAddr: '0xa8202f888b9b2dfa5ceb2204865018133f6f179a',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027f3369d2838e4eeae4638428c523923f47cfb9039c70a8c40d546493e82c7ba866553d602d80604d3d3981f3363d3d373d3d3d363d730e370942ebe4d026d05d2cf477ff386338fc415a5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  initialPrivileges: []
}

describe('estimate', () => {
  it('estimates gasUsage and native balance for EOA', async () => {
    const EOAAccount: Account = {
      addr: '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
      associatedKeys: ['0x40b38765696e3d5d8d9d834d8aad4bb6e418e489'],
      initialPrivileges: [
        [
          '0x40b38765696e3d5d8d9d834d8aad4bb6e418e489',
          '0x0000000000000000000000000000000000000000000000000000000000000001'
        ]
      ],
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
      nonce: 1n,
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
    expect(response.nonce).toBeGreaterThan(1)

    // make sure there's a native fee payment option in the same acc addr
    const noFeePaymentViewOnlyAcc = response.feePaymentOptions.find(
      (opt) => opt.paidBy === account.addr && opt.address === ethers.ZeroAddress
    )
    expect(noFeePaymentViewOnlyAcc).not.toBe(undefined)

    // make sure everything but the view only acc exists as a few option
    const feePaymentAddrOne = response.feePaymentOptions.find(
      (opt) => opt.paidBy === nativeToCheck[0].addr && opt.address === ethers.ZeroAddress
    )
    expect(feePaymentAddrOne).not.toBe(undefined)
    const feePaymentAddrTwo = response.feePaymentOptions.find(
      (opt) => opt.paidBy === nativeToCheck[1].addr && opt.address === ethers.ZeroAddress
    )
    expect(feePaymentAddrTwo).not.toBe(undefined)

    // the view only should be undefined
    const viewOnlyAccOption = response.feePaymentOptions.find(
      (opt) => opt.paidBy === viewOnlyAcc.addr && opt.address === ethers.ZeroAddress
    )
    expect(viewOnlyAccOption).toBe(undefined)
  })

  it('estimates correctly by passing multiple view only accounts to estimation and removing the fee options for them as they are not valid', async () => {
    const op = {
      accountAddr: account.addr,
      signingKeyAddr: null,
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'ethereum',
      nonce: 1n,
      signature: spoofSig,
      calls: [{ to, value: BigInt(0), data }],
      accountOpToExecuteBefore: null
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

    const viewOnlyAccOption = response.feePaymentOptions.find(
      (opt) => opt.paidBy === viewOnlyAcc.addr
    )
    // view only accounts shouldn't appear as payment options for other accounts
    expect(viewOnlyAccOption).toBe(undefined)
  })

  it('estimate a view only account op', async () => {
    const op = {
      accountAddr: viewOnlyAcc.addr,
      signingKeyAddr: null,
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'ethereum',
      nonce: 1n,
      signature: spoofSig,
      calls: [{ to, value: BigInt(1), data: '0x' }],
      accountOpToExecuteBefore: null
    }

    const accountStates = await getAccountsInfo([viewOnlyAcc])
    const response = await estimate(
      provider,
      ethereum,
      viewOnlyAcc,
      op,
      accountStates[viewOnlyAcc.addr][ethereum.id],
      nativeToCheck,
      feeTokens
    )

    // make sure we display the view only account payment option
    const viewOnlyAccOption = response.feePaymentOptions.find(
      (opt) => opt.paidBy === viewOnlyAcc.addr
    )
    expect(viewOnlyAccOption).not.toBe(undefined)
  })

  it('estimates with `accountOpToExecuteBefore`', async () => {
    const op = {
      accountAddr: account.addr,
      signingKeyAddr: null,
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'ethereum',
      nonce: 1n,
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
      nonce: 1n,
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

    expect(response.arbitrumL1FeeIfArbitrum.noFee).toEqual(0n)
    expect(response.arbitrumL1FeeIfArbitrum.withFee).toEqual(0n)
  })

  it('estimates with `addedNative`', async () => {
    const accountOptimism: Account = {
      addr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      associatedKeys: ['0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175'],
      initialPrivileges: [
        [
          '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175',
          '0x0000000000000000000000000000000000000000000000000000000000000001'
        ]
      ],
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
      nonce: 1n,
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

    response.feePaymentOptions.forEach((feeToken) => {
      expect(feeToken.addedNative).toBeGreaterThan(0n)
    })

    expect(response.arbitrumL1FeeIfArbitrum.noFee).toEqual(0n)
    expect(response.arbitrumL1FeeIfArbitrum.withFee).toEqual(0n)
  })

  it('estimates an arbitrum request', async () => {
    const opArbitrum = {
      accountAddr: smartAccountv2eip712.addr,
      signingKeyAddr: smartAccountv2eip712.associatedKeys[0],
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'arbitrum',
      nonce: 1n,
      signature: spoofSig,
      calls: [{ to, value: BigInt(100000000000), data: '0x' }],
      accountOpToExecuteBefore: null
    }

    const accountStates = await getAccountsInfo([smartAccountv2eip712])
    const response = await estimate(
      providerArbitrum,
      arbitrum,
      smartAccountv2eip712,
      opArbitrum,
      accountStates[smartAccountv2eip712.addr][arbitrum.id],
      nativeToCheck,
      feeTokens
    )

    expect(response.arbitrumL1FeeIfArbitrum.noFee).toBeGreaterThan(0n)
    expect(response.arbitrumL1FeeIfArbitrum.withFee).toBeGreaterThan(0n)
  })

  it('estimates an arbitrum 4337 request that should fail with paymaster deposit too low', async () => {
    const opArbitrum: AccountOp = {
      accountAddr: trezorSlot6v2NotDeployed.addr,
      signingKeyAddr: trezorSlot6v2NotDeployed.associatedKeys[0],
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'arbitrum',
      nonce: 1n,
      signature: spoofSig,
      calls: [{ to, value: BigInt(100000000000), data: '0x' }],
      accountOpToExecuteBefore: null
    }
    const accountStates = await getAccountsInfo([trezorSlot6v2NotDeployed])
    const response = await estimate(
      providerArbitrum,
      arbitrum,
      trezorSlot6v2NotDeployed,
      opArbitrum,
      accountStates[trezorSlot6v2NotDeployed.addr][arbitrum.id],
      nativeToCheck,
      feeTokens,
      { is4337Broadcast: true }
    )
    expect(response.error).not.toBe(null)
    expect(response.error?.message).toBe(
      `Paymaster with address ${AMBIRE_PAYMASTER} does not have enough funds to execute this request. Please contact support`
    )
  })

  it('estimates a 4337 request on the avalanche chain with an initCode and 4337 activator that results in a good erc-4337 estimation but a failure in the calls as the account does not have any funds', async () => {
    const opAvalanche: AccountOp = {
      accountAddr: trezorSlot6v2NotDeployed.addr,
      signingKeyAddr: trezorSlot6v2NotDeployed.associatedKeys[0],
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: avalanche.id,
      nonce: 0n,
      signature: '0x',
      calls: [{ to: account.addr, value: BigInt(100000000000), data: '0x' }],
      accountOpToExecuteBefore: null
    }
    const accountStates = await getAccountsInfo([trezorSlot6v2NotDeployed])
    const accountState = accountStates[trezorSlot6v2NotDeployed.addr][avalanche.id]

    const response = await estimate(
      providerAvalanche,
      avalanche,
      trezorSlot6v2NotDeployed,
      opAvalanche,
      accountState,
      nativeToCheck,
      feeTokensAvalanche,
      { is4337Broadcast: true }
    )

    expect(response.arbitrumL1FeeIfArbitrum.noFee).toEqual(0n)
    expect(response.arbitrumL1FeeIfArbitrum.withFee).toEqual(0n)

    expect(response.erc4337estimation).not.toBe(null)
    expect(response.erc4337estimation?.gasUsed).toBeGreaterThan(0n)
    expect(response.erc4337estimation!.userOp.paymasterAndData).toEqual('0x')
    expect(BigInt(response.erc4337estimation!.userOp.verificationGasLimit)).toBeGreaterThan(5000n)
    expect(BigInt(response.erc4337estimation!.userOp.callGasLimit)).toBeGreaterThan(10000n)

    expect(response.feePaymentOptions.length).toBeGreaterThan(0)
    response.feePaymentOptions.forEach((opt) => {
      expect(opt.addedNative).toBe(0n)
      // no basic acc payment
      expect(opt.paidBy).toBe(trezorSlot6v2NotDeployed.addr)
    })

    // because the account does not have any funds, the call should result in a failure
    // and execution should be stopped
    expect(response.error).not.toBe(null)
    expect(response.error?.message).toBe(
      `Estimation failed for ${opAvalanche.accountAddr} on ${opAvalanche.networkId}`
    )
  })

  it('estimates a 4337 request on the avalanche chain with a deployed account paying in native', async () => {
    const opAvalanche: AccountOp = {
      accountAddr: trezorSlot7v24337Deployed.addr,
      signingKeyAddr: trezorSlot7v24337Deployed.associatedKeys[0],
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'avalanche',
      nonce: 0n,
      signature: '0x',
      calls: [{ to, value: BigInt(100000000000), data: '0x' }],
      accountOpToExecuteBefore: null
    }
    const accountStates = await getAccountsInfo([trezorSlot7v24337Deployed])
    const accountState = accountStates[trezorSlot7v24337Deployed.addr][avalanche.id]

    const response = await estimate(
      providerAvalanche,
      avalanche,
      trezorSlot7v24337Deployed,
      opAvalanche,
      accountState,
      nativeToCheck,
      feeTokensAvalanche,
      { is4337Broadcast: true }
    )

    expect(response.arbitrumL1FeeIfArbitrum.noFee).toEqual(0n)
    expect(response.arbitrumL1FeeIfArbitrum.withFee).toEqual(0n)

    expect(response.erc4337estimation).not.toBe(null)
    expect(response.erc4337estimation?.gasUsed).toBeGreaterThan(0n)
    expect(response.erc4337estimation!.userOp.paymasterAndData).toEqual('0x')
    expect(BigInt(response.erc4337estimation!.userOp.verificationGasLimit)).toBeGreaterThan(5000n)
    expect(BigInt(response.erc4337estimation!.userOp.callGasLimit)).toBeGreaterThan(10000n)

    expect(response.feePaymentOptions.length).toBeGreaterThan(0)
    response.feePaymentOptions.forEach((opt) => {
      expect(opt.addedNative).toBe(0n)
      // no basic acc payment
      expect(opt.paidBy).toBe(trezorSlot7v24337Deployed.addr)
    })

    expect(response.error).toBe(null)
  })

  it('estimates a polygon request with insufficient funds for txn and estimation should fail with estimation failed', async () => {
    const opPolygonFailBzNoFunds: AccountOp = {
      accountAddr: smartAccountv2eip712.addr,
      signingKeyAddr: smartAccountv2eip712.associatedKeys[0],
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: polygon.id,
      nonce: 1n,
      signature: '0x',
      calls: [{ to: trezorSlot6v2NotDeployed.addr, value: ethers.parseEther('10'), data: '0x' }],
      accountOpToExecuteBefore: null
    }
    const accountStates = await getAccountsInfo([smartAccountv2eip712])

    const response = await estimate(
      providerPolygon,
      polygon,
      smartAccountv2eip712,
      opPolygonFailBzNoFunds,
      accountStates[smartAccountv2eip712.addr][polygon.id],
      nativeToCheck,
      feeTokens
    )
    expect(response.error).not.toBe(null)
    expect(response.error?.message).toBe(
      `Estimation failed for ${opPolygonFailBzNoFunds.accountAddr} on ${opPolygonFailBzNoFunds.networkId}`
    )
  })

  it('estimates a polygon request with wrong signer and estimation should fail with insufficient privileges', async () => {
    const opPolygonFailBzNoFunds: AccountOp = {
      accountAddr: smartAccountv2eip712.addr,
      signingKeyAddr: trezorSlot6v2NotDeployed.associatedKeys[0],
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: polygon.id,
      nonce: 1n,
      signature: '0x',
      calls: [{ to: trezorSlot6v2NotDeployed.addr, value: 100000n, data: '0x' }],
      accountOpToExecuteBefore: null
    }
    const accountStates = await getAccountsInfo([smartAccountv2eip712])

    const response = await estimate(
      providerPolygon,
      polygon,
      { ...smartAccountv2eip712, associatedKeys: [trezorSlot6v2NotDeployed.associatedKeys[0]] },
      opPolygonFailBzNoFunds,
      accountStates[smartAccountv2eip712.addr][polygon.id],
      nativeToCheck,
      feeTokens
    )
    expect(response.error).not.toBe(null)
    expect(response.error?.message).toBe('Your signer address is not authorized')
  })

  it('estimates an expired uniswap swap and it should display error properly', async () => {
    const op = {
      accountAddr: account.addr,
      signingKeyAddr: null,
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'ethereum',
      nonce: 1n,
      signature: '0x',
      calls: [{ to, value: BigInt(0), data: expiredData }],
      accountOpToExecuteBefore: null
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

    expect(response.error).not.toBe(null)
    expect(response.error?.message).toBe('Swap expired')
  })
})
