/* eslint no-console: "off" */

import { AbiCoder, Contract, ethers, Interface, parseEther, ZeroAddress } from 'ethers'
import fetch from 'node-fetch'

import { describe, expect } from '@jest/globals'
import structuredClone from '@ungap/structured-clone'

import AmbireAccount from '../../../contracts/compiled/AmbireAccount.json'
import ERC20 from '../../../contracts/compiled/IERC20.json'
import { getNonce } from '../../../test/helpers'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { networks } from '../../consts/networks'
import { Account, AccountStates } from '../../interfaces/account'
import { dedicatedToOneSAPriv, Key } from '../../interfaces/keystore'
import { Network } from '../../interfaces/network'
import { getRpcProvider } from '../../services/provider'
import { getSmartAccount } from '../account/account'
import { AccountOp } from '../accountOp/accountOp'
import { Call } from '../accountOp/types'
import { getAccountState } from '../accountState/accountState'
import { Portfolio } from '../portfolio/portfolio'
import { estimate, estimate4337 } from './estimate'

const ethereum = networks.find((x) => x.id === 'ethereum')!
ethereum.areContractsDeployed = true
const optimism = networks.find((x) => x.id === 'optimism')
const arbitrum = networks.find((x) => x.id === 'arbitrum')!
arbitrum.areContractsDeployed = true
const avalanche = networks.find((x) => x.id === 'avalanche')!
avalanche.areContractsDeployed = true
const polygon = networks.find((x) => x.id === 'polygon')
if (!ethereum || !optimism || !arbitrum || !avalanche || !polygon) throw new Error('no network')
const provider = getRpcProvider(ethereum.rpcUrls, ethereum.chainId)
const providerOptimism = getRpcProvider(optimism.rpcUrls, optimism.chainId)
const providerArbitrum = getRpcProvider(arbitrum.rpcUrls, arbitrum.chainId)
// const providerAvalanche = getRpcProvider(avalanche.rpcUrls, avalanche.chainId)
const providerPolygon = getRpcProvider(polygon.rpcUrls, polygon.chainId)
const addrWithDeploySignature = '0x52C37FD54BD02E9240e8558e28b11e0Dc22d8e85'

const smartAccDeployed: Account = {
  addr: '0x8E5F6c1F0b134657A546932C3eC9169E1633a39b',
  initialPrivileges: [
    [
      '0xBd84Cc40a5b5197B5B61919c22A55e1c46d2A3bb',
      '0x0000000000000000000000000000000000000000000000000000000000000002'
    ]
  ],
  creation: {
    factoryAddr: AMBIRE_ACCOUNT_FACTORY,
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027ff33cc417366b7e38d2706a67ab46f85465661c28b864b521441180d15df82251553d602d80604d3d3981f3363d3d373d3d3d363d731cde6a53e9a411eaaf9d11e3e8c653a3e379d5355af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  associatedKeys: ['0xBd84Cc40a5b5197B5B61919c22A55e1c46d2A3bb']
}

// Used to determine if an account is view-only or not
// and subsequently if it should be included in the fee payment options
const MOCK_KEYSTORE_KEYS: Key[] = [
  {
    addr: '0x71c3D24a627f0416db45107353d8d0A5ae0401ae',
    type: 'trezor',
    dedicatedToOneSA: true,
    isExternallyStored: true,
    meta: {
      deviceId: 'doesnt-matter',
      deviceModel: 'doesnt-matter',
      hdPathTemplate: "m/44'/60'/0'/0/<account>",
      index: 2
    }
  },
  {
    type: 'internal',
    addr: '0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E',
    dedicatedToOneSA: false,
    meta: null,
    isExternallyStored: false
  },
  {
    type: 'internal',
    addr: '0x141A14B5C4dbA2aC7a7943E02eDFE2E7eDfdA28F',
    dedicatedToOneSA: false,
    meta: null,
    isExternallyStored: false
  },
  {
    type: 'internal',
    addr: '0x0000000000000000000000000000000000000001',
    dedicatedToOneSA: false,
    meta: null,
    isExternallyStored: false
  },
  {
    type: 'internal',
    addr: '0xa8eEaC54343F94CfEEB3492e07a7De72bDFD118a',
    dedicatedToOneSA: false,
    meta: null,
    isExternallyStored: false
  },
  {
    type: 'internal',
    addr: addrWithDeploySignature,
    dedicatedToOneSA: true,
    meta: null,
    isExternallyStored: false
  }
]

const v1Acc: Account = {
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

// View only, because its key isn't in MOCK_KEYSTORE_KEYS
const viewOnlyAcc = {
  addr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
  creation: null,
  initialPrivileges: [],
  associatedKeys: ['0x77777777789A8BBEE6C64381e5E89E501fb0e4c8']
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
  {
    address: '0x0000000000000000000000000000000000000000',
    amount: 1n,
    symbol: 'ETH',
    networkId: 'ethereum',
    decimals: 18,
    priceIn: [],
    flags: {
      onGasTank: false,
      rewardsType: null,
      canTopUpGasTank: true,
      isFeeToken: true
    }
  },
  {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    amount: 1n,
    symbol: 'USDT',
    networkId: 'ethereum',
    decimals: 6,
    priceIn: [],
    flags: {
      onGasTank: false,
      rewardsType: null,
      canTopUpGasTank: true,
      isFeeToken: true
    }
  },
  {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    amount: 1n,
    symbol: 'USDC',
    networkId: 'ethereum',
    decimals: 6,
    priceIn: [],
    flags: {
      onGasTank: false,
      rewardsType: null,
      canTopUpGasTank: true,
      isFeeToken: true
    }
  }
]

// const feeTokensAvalanche = [
//   {
//     address: '0x0000000000000000000000000000000000000000',
//     amount: 1n,
//     symbol: 'AVAX',
//     networkId: 'avalanche',
//     decimals: 18,
//     priceIn: [],
//     flags: {
//       onGasTank: false,
//       rewardsType: null,
//       canTopUpGasTank: true,
//       isFeeToken: true
//     }
//   },
//   {
//     address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
//     amount: 1n,
//     symbol: 'USDC',
//     networkId: 'avalanche',
//     decimals: 6,
//     priceIn: [],
//     flags: {
//       onGasTank: false,
//       rewardsType: null,
//       canTopUpGasTank: true,
//       isFeeToken: true
//     }
//   }
// ]

const portfolio = new Portfolio(fetch, provider, ethereum)

const providers = Object.fromEntries(
  networks.map((network) => [network.id, getRpcProvider(network.rpcUrls, network.chainId)])
)
const getAccountsInfo = async (accounts: Account[]): Promise<AccountStates> => {
  const result = await Promise.all(
    networks.map((network) => getAccountState(providers[network.id], network, accounts))
  )
  const states = accounts.map((acc: Account, accIndex: number) => {
    return [
      acc.addr,
      Object.fromEntries(
        networks.map((network: Network, netIndex: number) => {
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
  it('[EOA]:Ethereum | gasUsage and native balance for a normal transfer', async () => {
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

    const call: Call = {
      to: '0xf7bB3EEF4ffA13ce037E3E5b6a59340c7e0f3941',
      value: BigInt(1),
      data: '0x'
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
      MOCK_KEYSTORE_KEYS,
      op,
      accountStates,
      [],
      feeTokens
    )

    expect(response.gasUsed).toBe(21000n)
    expect(response.feePaymentOptions![0].availableAmount).toBeGreaterThan(0)
    expect(response.feePaymentOptions![0].token).not.toBe(undefined)
    expect(response.feePaymentOptions![0].token).not.toBe(null)
    expect(response.currentAccountNonce).toBeGreaterThan(1)
    expect(response.error).toBe(null)
  })

  it('[EOA]:Polygon | sends all his available native and estimation should return a 0 balance available for fee but still a 21K gasUsed as we are doing a normal transfer', async () => {
    const addr = '0xa8eEaC54343F94CfEEB3492e07a7De72bDFD118a'
    const EOAAccount: Account = {
      addr,
      associatedKeys: [addr],
      initialPrivileges: [],
      creation: null
    }

    // send all the native balance the user has in a call
    const nativeBalance = await providerPolygon.getBalance(addr)
    const call = {
      to: '0xf7bB3EEF4ffA13ce037E3E5b6a59340c7e0f3941',
      value: nativeBalance,
      data: '0x'
    }

    const op = {
      accountAddr: EOAAccount.addr,
      signingKeyAddr: null,
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'polygon',
      nonce: null,
      signature: null,
      calls: [call],
      accountOpToExecuteBefore: null
    }

    const accountStates = await getAccountsInfo([EOAAccount])
    const response = await estimate(
      providerPolygon,
      polygon,
      EOAAccount,
      MOCK_KEYSTORE_KEYS,
      op,
      accountStates,
      [],
      feeTokens
    )

    expect(response.gasUsed).toBe(21000n)
    expect(response.feePaymentOptions![0].availableAmount).toBe(0n)
    expect(response.error).toBe(null)
  })

  it("[EOA]:Polygon | shouldn't return an error if there is a valid txn but with no native to pay the fee as it is handled in signAccountOp", async () => {
    const addr = '0x952064055eFE9dc8b261510869B032068c8699bB'
    const EOAAccount: Account = {
      addr,
      associatedKeys: [addr],
      initialPrivileges: [],
      creation: null
    }

    // this should be a valid txn
    // sending 0.00001 USDC to 0xf7bB3EEF4ffA13ce037E3E5b6a59340c7e0f3941
    // so addr should posses that amount
    const ERC20Interface = new Interface(ERC20.abi)
    const call = {
      to: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      value: 0n,
      data: ERC20Interface.encodeFunctionData('transfer', [
        '0xf7bB3EEF4ffA13ce037E3E5b6a59340c7e0f3941',
        1n
      ])
    }

    const op = {
      accountAddr: EOAAccount.addr,
      signingKeyAddr: null,
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'polygon',
      nonce: null,
      signature: null,
      calls: [call],
      accountOpToExecuteBefore: null
    }

    const accountStates = await getAccountsInfo([EOAAccount])
    const response = await estimate(
      providerPolygon,
      polygon,
      EOAAccount,
      MOCK_KEYSTORE_KEYS,
      op,
      accountStates,
      [],
      feeTokens
    )

    expect(response.gasUsed).toBeGreaterThan(0n)
    expect(response.feePaymentOptions[0].availableAmount).toBe(0n)
    expect(response.error).toBe(null)
  })

  it('[EOA]:Polygon | should throw an error if there is an invalid txn and gasUsed should be 0', async () => {
    const addr = '0x952064055eFE9dc8b261510869B032068c8699bB'
    const EOAAccount: Account = {
      addr,
      associatedKeys: [addr],
      initialPrivileges: [],
      creation: null
    }

    // this should be an invalid txn
    const ERC20Interface = new Interface(ERC20.abi)
    const call = {
      to: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      value: 0n,
      data: ERC20Interface.encodeFunctionData('transfer', [
        '0xf7bB3EEF4ffA13ce037E3E5b6a59340c7e0f3941',
        1000000000n // 10K USDC
      ])
    }

    const op = {
      accountAddr: EOAAccount.addr,
      signingKeyAddr: null,
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'polygon',
      nonce: null,
      signature: null,
      calls: [call],
      accountOpToExecuteBefore: null
    }

    const accountStates = await getAccountsInfo([EOAAccount])
    const response = await estimate(
      providerPolygon,
      polygon,
      EOAAccount,
      MOCK_KEYSTORE_KEYS,
      op,
      accountStates,
      [],
      feeTokens
    )

    expect(response.gasUsed).toBe(0n)
    expect(response.error).not.toBe(null)
  })

  it('[v1] estimates gasUsage, fee and native tokens outcome', async () => {
    const op = {
      accountAddr: v1Acc.addr,
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

    const accountStates = await getAccountsInfo([v1Acc])
    const response = await estimate(
      provider,
      ethereum,
      v1Acc,
      MOCK_KEYSTORE_KEYS,
      op,
      accountStates,
      nativeToCheck,
      feeTokens
    )
    const usdtOutcome = response.feePaymentOptions!.find(
      (option) => option.token.address === '0xdAC17F958D2ee523a2206206994597C13D831ec7'
    )
    const usdcOutcome = response.feePaymentOptions!.find(
      (option) => option.token.address === '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    )

    console.log(response.error)

    // This is the min gas unit we can spend, but we expect more than that having in mind that multiple computations happens in the Contract
    expect(response.gasUsed).toBeGreaterThan(21000n)
    // As we swap 1 USDC for 1 USDT, we expect the estimate (outcome) balance of USDT to be greater than before the estimate (portfolio value)
    expect(usdtOutcome!.availableAmount).toBeGreaterThan(usdt?.amount || 0n)
    expect(usdcOutcome!.availableAmount).toBeLessThan(usdc!.amount)
    expect(response.currentAccountNonce).toBeGreaterThan(1)

    expect(usdtOutcome!.token).not.toBe(undefined)
    expect(usdtOutcome!.token).not.toBe(null)

    // make sure there's a native fee payment option in the same acc addr
    const noFeePaymentViewOnlyAcc = response.feePaymentOptions.find(
      (opt) => opt.paidBy === v1Acc.addr && opt.token.address === ethers.ZeroAddress
    )
    expect(noFeePaymentViewOnlyAcc).not.toBe(undefined)

    // make sure everything but the view only acc exists as a few option
    const feePaymentAddrOne = response.feePaymentOptions.find(
      (opt) => opt.paidBy === nativeToCheck[0].addr && opt.token.address === ethers.ZeroAddress
    )
    expect(feePaymentAddrOne).not.toBe(undefined)
    const feePaymentAddrTwo = response.feePaymentOptions.find(
      (opt) => opt.paidBy === nativeToCheck[1].addr && opt.token.address === ethers.ZeroAddress
    )
    expect(feePaymentAddrTwo).not.toBe(undefined)

    // the view only should be undefined
    const viewOnlyAccOption = response.feePaymentOptions.find(
      (opt) => opt.paidBy === viewOnlyAcc.addr && opt.token.address === ethers.ZeroAddress
    )
    expect(viewOnlyAccOption).toBe(undefined)
  })

  it('[v1] estimates correctly by passing multiple view only accounts to estimation and removing the fee options for them as they are not valid', async () => {
    const op = {
      accountAddr: v1Acc.addr,
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

    const accountStates = await getAccountsInfo([v1Acc])
    const response = await estimate(
      provider,
      ethereum,
      v1Acc,
      MOCK_KEYSTORE_KEYS,
      op,
      accountStates,
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
      MOCK_KEYSTORE_KEYS,
      op,
      accountStates,
      nativeToCheck,
      feeTokens
    )

    // make sure we display the view only account payment option
    const viewOnlyAccOption = response.feePaymentOptions.find(
      (opt) => opt.paidBy === viewOnlyAcc.addr
    )
    expect(viewOnlyAccOption).not.toBe(undefined)
  })

  it('[v1] estimates with `accountOpToExecuteBefore`', async () => {
    const op = {
      accountAddr: v1Acc.addr,
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
      accountAddr: v1Acc.addr,
      signingKeyAddr: null,
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'ethereum',
      nonce: 1n,
      signature: spoofSig,
      calls: [{ to, value: BigInt(0), data }],
      accountOpToExecuteBefore: {
        accountAddr: v1Acc.addr,
        signingKeyAddr: null,
        signingKeyType: null,
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'ethereum',
        nonce: await getNonce(v1Acc.addr, provider),
        signature: spoofSig,
        calls: [{ to, value: BigInt(0), data }],
        accountOpToExecuteBefore: null
      }
    }

    const accountStates = await getAccountsInfo([v1Acc])
    const response = await estimate(
      provider,
      ethereum,
      v1Acc,
      MOCK_KEYSTORE_KEYS,
      op,
      accountStates,
      nativeToCheck,
      feeTokens
    )
    const responseWithExecuteBefore = await estimate(
      provider,
      ethereum,
      v1Acc,
      MOCK_KEYSTORE_KEYS,
      opWithExecuteBefore,
      accountStates,
      nativeToCheck,
      feeTokens,
      { calculateRefund: true }
    )

    // Gas used in case of `accountOpToExecuteBefore` should be greater, because more AccountOps are simulated
    expect(responseWithExecuteBefore.gasUsed).toBeGreaterThan(response.gasUsed)
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
      MOCK_KEYSTORE_KEYS,
      opOptimism,
      accountStates,
      nativeToCheck,
      feeTokens
    )

    response.feePaymentOptions.forEach((feeToken) => {
      expect(feeToken.addedNative).toBeGreaterThan(0n)
    })
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
      MOCK_KEYSTORE_KEYS,
      opArbitrum,
      accountStates,
      nativeToCheck,
      feeTokens
    )

    response.feePaymentOptions.map((option) => expect(option.addedNative).toBeGreaterThan(0n))
  })

  it('[ERC-4337]:Optimism | not deployed | should work', async () => {
    const privs = [
      {
        addr: addrWithDeploySignature,
        hash: dedicatedToOneSAPriv
      }
    ]
    const smartAcc = await getSmartAccount(privs)
    const opOptimism: AccountOp = {
      accountAddr: smartAcc.addr,
      signingKeyAddr: smartAcc.associatedKeys[0],
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'optimism',
      nonce: 0n,
      signature: '0x',
      calls: [{ to: FEE_COLLECTOR, value: 1n, data: '0x' }],
      accountOpToExecuteBefore: null,
      meta: {
        entryPointAuthorization:
          '0x05404ea5dfa13ddd921cda3f587af6927cc127ee174b57c9891491bfc1f0d3d005f649f8a1fc9147405f064507bae08816638cfc441c4d0dc4eb6640e16621991b01'
      }
    }
    const accountStates = await getAccountsInfo([smartAcc])
    const response = await estimate(
      providerOptimism,
      optimism,
      smartAcc,
      MOCK_KEYSTORE_KEYS,
      opOptimism,
      accountStates,
      nativeToCheck,
      feeTokens,
      { is4337Broadcast: true }
    )

    expect(response.error).toBe(null)

    expect(response.erc4337GasLimits).not.toBe(undefined)
    expect(BigInt(response.erc4337GasLimits!.callGasLimit)).toBeGreaterThan(0n)
    expect(BigInt(response.erc4337GasLimits!.verificationGasLimit)).toBeGreaterThan(0n)
    expect(BigInt(response.erc4337GasLimits!.preVerificationGas)).toBeGreaterThan(0n)
    expect(BigInt(response.erc4337GasLimits!.paymasterPostOpGasLimit)).toBeGreaterThan(0n)
    expect(BigInt(response.erc4337GasLimits!.paymasterVerificationGasLimit)).toBeGreaterThan(0n)

    expect(response.feePaymentOptions.length).toBeGreaterThan(0)
    expect(response.feePaymentOptions![0].token).not.toBe(undefined)
    expect(response.feePaymentOptions![0].token).not.toBe(null)
  })

  it('[ERC-4337]:Optimism | not deployed | should fail with an inner call failure but otherwise estimation should work', async () => {
    const privs = [
      {
        addr: addrWithDeploySignature,
        hash: dedicatedToOneSAPriv
      }
    ]
    const smartAcc = await getSmartAccount(privs)
    const opOptimism: AccountOp = {
      accountAddr: smartAcc.addr,
      signingKeyAddr: smartAcc.associatedKeys[0],
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'optimism',
      nonce: 0n,
      signature: '0x',
      calls: [{ to: FEE_COLLECTOR, value: parseEther('1'), data: '0x' }],
      accountOpToExecuteBefore: null,
      meta: {
        entryPointAuthorization:
          '0x05404ea5dfa13ddd921cda3f587af6927cc127ee174b57c9891491bfc1f0d3d005f649f8a1fc9147405f064507bae08816638cfc441c4d0dc4eb6640e16621991b01'
      }
    }
    const accountStates = await getAccountsInfo([smartAcc])
    const response = await estimate(
      providerOptimism,
      optimism,
      smartAcc,
      MOCK_KEYSTORE_KEYS,
      opOptimism,
      accountStates,
      nativeToCheck,
      feeTokens,
      { is4337Broadcast: true }
    )

    expect(response.error).not.toBe(null)
    expect(response.error?.message).toBe('Insufficient funds for intristic transaction cost')

    expect(response.erc4337GasLimits).not.toBe(undefined)
    expect(BigInt(response.erc4337GasLimits!.callGasLimit)).toBe(0n)
    expect(BigInt(response.erc4337GasLimits!.verificationGasLimit)).toBe(0n)
    expect(BigInt(response.erc4337GasLimits!.preVerificationGas)).toBe(0n)
    expect(BigInt(response.erc4337GasLimits!.paymasterPostOpGasLimit)).toBe(0n)
    expect(BigInt(response.erc4337GasLimits!.paymasterVerificationGasLimit)).toBe(0n)

    expect(response.feePaymentOptions.length).toBeGreaterThan(0)
    expect(response.feePaymentOptions![0].token).not.toBe(undefined)
    expect(response.feePaymentOptions![0].token).not.toBe(null)
  })

  it('[ERC-4337]:Optimism | deployed account | should work', async () => {
    const ambAcc = new Contract(smartAccDeployed.addr, AmbireAccount.abi, providerOptimism)
    const nonce = await ambAcc.nonce()
    const opOptimism: AccountOp = {
      accountAddr: smartAccDeployed.addr,
      signingKeyAddr: smartAccDeployed.associatedKeys[0],
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'optimism',
      nonce,
      signature: '0x',
      calls: [{ to: FEE_COLLECTOR, value: 1n, data: '0x' }],
      accountOpToExecuteBefore: null
    }
    const accountStates = await getAccountsInfo([smartAccDeployed])
    const response = await estimate(
      // it doesn't matter in this case
      providerOptimism,
      optimism,
      smartAccDeployed,
      MOCK_KEYSTORE_KEYS,
      opOptimism,
      accountStates,
      nativeToCheck,
      feeTokens,
      { is4337Broadcast: true }
    )

    expect(response.error).toBe(null)

    expect(response.erc4337GasLimits).not.toBe(undefined)
    expect(BigInt(response.erc4337GasLimits!.callGasLimit)).toBeGreaterThan(0n)
    expect(BigInt(response.erc4337GasLimits!.verificationGasLimit)).toBeGreaterThan(0n)
    expect(BigInt(response.erc4337GasLimits!.preVerificationGas)).toBeGreaterThan(0n)
    expect(BigInt(response.erc4337GasLimits!.paymasterPostOpGasLimit)).toBeGreaterThan(0n)
    expect(BigInt(response.erc4337GasLimits!.paymasterVerificationGasLimit)).toBeGreaterThan(0n)

    expect(response.feePaymentOptions.length).toBeGreaterThan(0)
    expect(response.feePaymentOptions![0].token).not.toBe(undefined)
    expect(response.feePaymentOptions![0].token).not.toBe(null)
  })

  it('[EOA-for-SA]:Arbitrum | should return native fee payment options even if hasRelayer = false', async () => {
    const clonedArb = structuredClone(arbitrum)
    clonedArb.hasRelayer = false
    clonedArb.erc4337.enabled = false

    const opArbitrum: AccountOp = {
      accountAddr: trezorSlot6v2NotDeployed.addr,
      signingKeyAddr: trezorSlot6v2NotDeployed.associatedKeys[0],
      signingKeyType: null,
      gasLimit: null,
      gasFeePayment: null,
      networkId: 'arbitrum',
      nonce: 0n,
      signature: spoofSig,
      calls: [{ to, value: BigInt(100000000000), data: '0x' }],
      accountOpToExecuteBefore: null
    }
    const accountStates = await getAccountsInfo([trezorSlot6v2NotDeployed])
    const response = await estimate(
      providerArbitrum,
      clonedArb,
      trezorSlot6v2NotDeployed,
      MOCK_KEYSTORE_KEYS,
      opArbitrum,
      accountStates,
      nativeToCheck,
      feeTokens,
      { is4337Broadcast: false }
    )

    expect(response.feePaymentOptions.length).toBeGreaterThan(0)
    expect(response.feePaymentOptions[0].token).not.toBe(null)
    expect(response.feePaymentOptions[0].token).not.toBe(undefined)
    expect(response.feePaymentOptions[0].token.address).toBe(ZeroAddress)
  })

  it('[ERC-4337]:Arbitrum | should fail because of a broken provider but still return fee options', async () => {
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
    const brokenProvider = getRpcProvider(arbitrum.rpcUrls, arbitrum.chainId)
    const handler2 = {
      get(target: any, prop: any) {
        if (prop === 'send') throw new Error('no sends')
      }
    }
    const proxyProvider = new Proxy(brokenProvider, handler2)
    const response = await estimate4337(
      trezorSlot6v2NotDeployed,
      opArbitrum,
      opArbitrum.calls,
      accountStates,
      arbitrum,
      proxyProvider,
      feeTokens,
      'latest'
    )

    expect(response.error).not.toBe(null)
    expect(response.error?.message).toBe('no sends')

    expect(response.feePaymentOptions.length).toBeGreaterThan(0)

    expect(response.erc4337GasLimits).not.toBe(undefined)
    expect(BigInt(response.erc4337GasLimits!.callGasLimit)).toBe(0n)
    expect(BigInt(response.erc4337GasLimits!.verificationGasLimit)).toBe(0n)
    expect(BigInt(response.erc4337GasLimits!.preVerificationGas)).toBe(0n)
  })

  it('estimates a polygon request with insufficient funds for txn and estimation should fail with transaction reverted', async () => {
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
      MOCK_KEYSTORE_KEYS,
      opPolygonFailBzNoFunds,
      accountStates,
      nativeToCheck,
      feeTokens
    )
    expect(response.error).not.toBe(null)
    expect(response.error?.message).toBe('Transaction reverted: invalid call in the bundle')
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
      MOCK_KEYSTORE_KEYS,
      opPolygonFailBzNoFunds,
      accountStates,
      nativeToCheck,
      feeTokens
    )
    expect(response.error).not.toBe(null)
    expect(response.error?.message).toBe('Your signer address is not authorized')
  })

  it('[v1] estimates an expired uniswap swap and it should display error properly', async () => {
    const op = {
      accountAddr: v1Acc.addr,
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

    const accountStates = await getAccountsInfo([v1Acc])
    const response = await estimate(
      provider,
      ethereum,
      v1Acc,
      MOCK_KEYSTORE_KEYS,
      op,
      accountStates,
      nativeToCheck,
      feeTokens
    )

    expect(response.error).not.toBe(null)
    expect(response.error?.message).toBe('Swap expired')
  })
})
