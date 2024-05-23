/* eslint no-console: "off" */

import { ethers } from 'ethers'
import fetch from 'node-fetch'

import { describe, expect, jest, test } from '@jest/globals'
import structuredClone from '@ungap/structured-clone'

import { trezorSlot7v24337Deployed } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { FEE_COLLECTOR } from '../../consts/addresses'
import humanizerJSON from '../../consts/humanizer/humanizerInfo.json'
import { networks } from '../../consts/networks'
import { Account, AccountStates } from '../../interfaces/account'
import { NetworkDescriptor, NetworkId } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { AccountOp, accountOpSignableHash } from '../../libs/accountOp/accountOp'
import { getAccountState } from '../../libs/accountState/accountState'
import { estimate } from '../../libs/estimate/estimate'
import { EstimateResult } from '../../libs/estimate/interfaces'
import * as gasPricesLib from '../../libs/gasPrice/gasPrice'
import { HUMANIZER_META_KEY } from '../../libs/humanizer'
import { KeystoreSigner } from '../../libs/keystoreSigner/keystoreSigner'
import { TokenResult } from '../../libs/portfolio'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { getTypedData } from '../../libs/signMessage/signMessage'
import { getRpcProvider } from '../../services/provider'
import { KeystoreController } from '../keystore/keystore'
import { PortfolioController } from '../portfolio/portfolio'
import { SettingsController } from '../settings/settings'
import { getFeeSpeedIdentifier } from './helper'
import { SignAccountOpController } from './signAccountOp'

global.structuredClone = structuredClone as any

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
        networks.map((network: NetworkDescriptor, netIndex: number) => {
          return [network.id, result[netIndex][accIndex]]
        })
      )
    ]
  })
  return Object.fromEntries(states)
}

const createAccountOp = (
  account: Account,
  networkId: NetworkId = 'ethereum'
): {
  op: AccountOp
  nativeToCheck: Account[]
  feeTokens: TokenResult[]
} => {
  const to = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'

  const tomorrowHex = Math.floor((Date.now() + 86400000) / 1000).toString(16)
  // 64 chars expire hex
  // we set swap deadline always for tomorrow, in order to prevent the test failure with 'TRANSACTION TOO OLD'
  const expire = '0'.repeat(64 - tomorrowHex.length) + tomorrowHex

  // USDT -> USDC swap
  // Fee tokens: USDT, USDC
  const data = `0x5ae401dc${expire}00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000a07d75aacefd11b425af7181958f0f85c312f14300000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000c33d9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000`

  const nativeToCheck: Account[] = [
    {
      addr: '0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0',
      associatedKeys: ['0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0'],
      initialPrivileges: [],
      creation: null
    }
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
    }
  ]

  const op: AccountOp = {
    accountAddr: account.addr,
    signingKeyAddr: null,
    signingKeyType: null,
    gasLimit: null,
    gasFeePayment: null,
    networkId,
    nonce: 0n, // does not matter when estimating
    calls: [{ to, value: BigInt(0), data }],
    accountOpToExecuteBefore: null,
    signature: null
  }

  return { op, nativeToCheck, feeTokens }
}

const createEOAAccountOp = (account: Account) => {
  const to = '0x0000000000000000000000000000000000000000'

  const data = '0x'

  const nativeToCheck: Account[] = [
    {
      addr: account.addr,
      associatedKeys: [account.addr],
      initialPrivileges: [],
      creation: null
    }
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
    }
  ]

  const op = {
    accountAddr: account.addr,
    signingKeyAddr: null,
    signingKeyType: null,
    gasLimit: null,
    gasFeePayment: null,
    networkId: 'ethereum',
    nonce: null, // does not matter when estimating
    calls: [{ to, value: BigInt(1), data }],
    accountOpToExecuteBefore: null,
    signature: null
  }

  return { op, nativeToCheck, feeTokens }
}

const humanizerMeta = humanizerJSON

const eoaSigner = {
  privKey: '0x1941fd49fae923cae5ba789ac8ed2662066861960c7aa339443e76d309a80f6f',
  keyPublicAddress: '0x16c81367c30c71d6B712355255A07FCe8fd3b5bB',
  pass: 'testpass'
}

// add the eoaSigner as an associatedKey
trezorSlot7v24337Deployed.associatedKeys.push(eoaSigner.keyPublicAddress)

const eoaAccount: Account = {
  addr: eoaSigner.keyPublicAddress,
  associatedKeys: [eoaSigner.keyPublicAddress],
  initialPrivileges: [],
  creation: null
}

const trezorEoa: Account = {
  addr: '0x71c3D24a627f0416db45107353d8d0A5ae0401ae',
  associatedKeys: ['0x71c3D24a627f0416db45107353d8d0A5ae0401ae'],
  initialPrivileges: [],
  creation: null
}

const otherEoa: Account = {
  addr: '0x71c3D24a627f0416db45107353d8d0A5ae0402ae',
  associatedKeys: ['0x71c3D24a627f0416db45107353d8d0A5ae0401ae'],
  initialPrivileges: [],
  creation: null
}

const smartAccount: Account = {
  addr: '0x4AA524DDa82630cE769e5C9d7ec7a45B94a41bc6',
  associatedKeys: ['0x141A14B5C4dbA2aC7a7943E02eDFE2E7eDfdA28F', eoaSigner.keyPublicAddress],
  creation: {
    factoryAddr: '0xa8202f888b9b2dfa5ceb2204865018133f6f179a',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000027fa70e7c3e588683d0493e3cad10209993d632b6631bc4637b53a4174bad869718553d602d80604d3d3981f3363d3d373d3d3d363d730e370942ebe4d026d05d2cf477ff386338fc415a5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000000'
  },
  initialPrivileges: [
    [
      '0x141A14B5C4dbA2aC7a7943E02eDFE2E7eDfdA28F',
      '0x0000000000000000000000000000000000000000000000000000000000000001'
    ]
  ]
}

const v1Account = {
  addr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
  associatedKeys: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E', eoaSigner.keyPublicAddress],
  initialPrivileges: [],
  creation: {
    factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
    bytecode:
      '0x7f28d4ea8f825adb036e9b306b2269570e63d2aa5bd10751437d98ed83551ba1cd7fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
  }
}

const nativeFeeToken: TokenResult = {
  address: '0x0000000000000000000000000000000000000000',
  symbol: 'ETH',
  amount: 1000n,
  networkId: 'ethereum',
  decimals: Number(18),
  priceIn: [{ baseCurrency: 'usd', price: 5000 }],
  flags: {
    onGasTank: false,
    rewardsType: null,
    canTopUpGasTank: true,
    isFeeToken: true
  }
}

// const nativeFeeTokenAvalanche: TokenResult = {
//   address: '0x0000000000000000000000000000000000000000',
//   symbol: 'AVAX',
//   amount: 1000n,
//   networkId: 'avalanche',
//   decimals: Number(18),
//   priceIn: [{ baseCurrency: 'usd', price: 100 }],
//   flags: {
//     onGasTank: false,
//     rewardsType: null,
//     canTopUpGasTank: true,
//     isFeeToken: true
//   }
// }

const nativeFeeTokenPolygon: TokenResult = {
  address: '0x0000000000000000000000000000000000000000',
  symbol: 'MATIC',
  amount: 1000n,
  networkId: 'polygon',
  decimals: Number(18),
  priceIn: [{ baseCurrency: 'usd', price: 5000 }],
  flags: {
    onGasTank: false,
    rewardsType: null,
    canTopUpGasTank: true,
    isFeeToken: true
  }
}

const gasTankToken: TokenResult = {
  address: '0x0000000000000000000000000000000000000000',
  symbol: 'MATIC',
  amount: 323871237812612123123n,
  networkId: 'polygon',
  decimals: Number(18),
  priceIn: [{ baseCurrency: 'usd', price: 5000 }],
  flags: {
    onGasTank: true,
    rewardsType: null,
    canTopUpGasTank: true,
    isFeeToken: true
  }
}

const usdcFeeToken: TokenResult = {
  amount: 54409383n,
  networkId: 'polygon',
  decimals: Number(6),
  priceIn: [{ baseCurrency: 'usd', price: 1.0 }],
  symbol: 'USDC',
  address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
  flags: {
    onGasTank: false,
    rewardsType: null,
    canTopUpGasTank: true,
    isFeeToken: true
  }
}

const init = async (
  account: Account,
  accountOp: {
    op: AccountOp
    nativeToCheck: Account[]
    feeTokens: TokenResult[]
  },
  signer: any,
  estimationMock?: EstimateResult,
  gasPricesMock?: gasPricesLib.GasRecommendation[]
) => {
  const storage: Storage = produceMemoryStore()
  await storage.set(HUMANIZER_META_KEY, humanizerMeta)

  const keystore = new KeystoreController(storage, { internal: KeystoreSigner })
  await keystore.addSecret('passphrase', signer.pass, '', false)
  await keystore.unlockWithSecret('passphrase', signer.pass)

  await keystore.addKeys([{ privateKey: signer.privKey, dedicatedToOneSA: true }])

  const { op, nativeToCheck, feeTokens } = accountOp
  const network = networks.find((x) => x.id === op.networkId)!
  const provider = getRpcProvider(network.rpcUrls, network.chainId)
  const accounts = [account]
  const accountStates = await getAccountsInfo(accounts)

  const prices = gasPricesMock || (await gasPricesLib.getGasPriceRecommendations(provider, network))

  const estimation =
    estimationMock ||
    (await estimate(
      provider,
      network,
      account,
      keystore.keys,
      op,
      accountStates,
      nativeToCheck,
      feeTokens
    ))

  const settings = new SettingsController(storage)
  settings.providers = providers
  const portfolio = new PortfolioController(storage, settings, 'https://staging-relayer.ambire.com')
  await portfolio.updateSelectedAccount(accounts, networks, account.addr)

  if (portfolio.latest?.[account.addr][op.networkId]!.result) {
    portfolio!.latest[account.addr][op.networkId]!.result!.tokens = [
      {
        amount: 1n,
        networkId: op.networkId,
        decimals: Number(18),
        symbol: 'ETH',
        address: '0x0000000000000000000000000000000000000000',
        flags: {
          onGasTank: false,
          rewardsType: null,
          canTopUpGasTank: true,
          isFeeToken: true
        },
        priceIn: [{ baseCurrency: 'usd', price: 1000.0 }] //  For the sake of simplicity we mocked 1 ETH = 1000 USD
      },
      {
        amount: 54409383n,
        networkId: op.networkId,
        decimals: Number(6),
        symbol: 'USDC',
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        flags: {
          onGasTank: false,
          rewardsType: null,
          canTopUpGasTank: true,
          isFeeToken: true
        },
        priceIn: [{ baseCurrency: 'usd', price: 1.0 }]
      }
    ]
  }

  const callRelayer = relayerCall.bind({ url: '', fetch })
  const controller = new SignAccountOpController(
    keystore,
    portfolio,
    settings,
    {},
    account,
    accountStates,
    networks.find((n) => n.id === op.networkId)!,
    op,
    storage,
    fetch,
    callRelayer
  )

  return { controller, prices, estimation }
}

describe('SignAccountOp Controller ', () => {
  test('Default options', async () => {
    // Please note that in this test case, we intentionally refrain from mocking the estimation and gasPrices libraries.
    // The reason is that we aim to simulate the signing process as realistically as possible and prefer to depend on the actual underlying libraries rather than using mocks.
    const { controller, estimation, prices } = await init(
      v1Account,
      createAccountOp(v1Account),
      eoaSigner
    )

    controller.update({
      gasPrices: prices,
      estimation
    })

    // It sets a default signer
    expect(controller.accountOp.signingKeyAddr).toEqual(eoaSigner.keyPublicAddress)
    expect(controller.accountOp.signingKeyType).toEqual('internal')
  })

  test('Signing [EOA]: EOA account paying with a native token', async () => {
    const { controller, estimation, prices } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        gasUsed: 10000n,
        currentAccountNonce: 0,
        feePaymentOptions: [
          {
            paidBy: eoaAccount.addr,
            availableAmount: 1000000000000000000n, // 1 ETH
            gasUsed: 0n,
            addedNative: 5000n,
            token: {
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
            }
          }
        ],
        error: null
      },
      [
        {
          name: 'slow',
          baseFeePerGas: 100n,
          maxPriorityFeePerGas: 100n
        },
        {
          name: 'medium',
          baseFeePerGas: 200n,
          maxPriorityFeePerGas: 200n
        },
        {
          name: 'fast',
          baseFeePerGas: 300n,
          maxPriorityFeePerGas: 300n
        },
        {
          name: 'ape',
          baseFeePerGas: 400n,
          maxPriorityFeePerGas: 400n
        }
      ]
    )

    controller.update({
      gasPrices: prices,
      estimation,
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal',
      feeToken: nativeFeeToken,
      paidBy: eoaAccount.addr
    })

    await controller.sign()

    if (!controller.accountOp?.signature) {
      console.log('Signing errors:', controller.errors)
      throw new Error('Signing failed!')
    }

    expect(controller.accountOp.gasFeePayment).toEqual({
      paidBy: eoaAccount.addr,
      isERC4337: false,
      isGasTank: false,
      inToken: '0x0000000000000000000000000000000000000000',
      amount: 6005000n, // ((300 + 300) × 10000) + 10000, i.e. ((baseFee + priorityFee) * gasUsed) + addedNative
      simulatedGasLimit: 10000n, // 10000, i.e. gasUsed,
      maxPriorityFeePerGas: 300n,
      gasPrice: 600n
    })

    expect(controller.accountOp.signature).toEqual('0x') // broadcasting and signRawTransaction is handled in main controller
    expect(controller.status).toEqual({ type: 'done' })
  })

  test('Signing [EOA]: should return an error if the availableAmount is 0', async () => {
    const { controller, estimation, prices } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        gasUsed: 10000n,
        currentAccountNonce: 0,
        feePaymentOptions: [
          {
            paidBy: eoaAccount.addr,
            availableAmount: 0n,
            gasUsed: 0n,
            addedNative: 5000n,
            token: {
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
            }
          }
        ],
        // even if availableAmount is 0, there is no error from the
        // estimation. It is singAccountOp's responsibility to disable signing
        error: null
      },
      [
        {
          name: 'slow',
          baseFeePerGas: 100n,
          maxPriorityFeePerGas: 100n
        },
        {
          name: 'medium',
          baseFeePerGas: 200n,
          maxPriorityFeePerGas: 200n
        },
        {
          name: 'fast',
          baseFeePerGas: 300n,
          maxPriorityFeePerGas: 300n
        },
        {
          name: 'ape',
          baseFeePerGas: 400n,
          maxPriorityFeePerGas: 400n
        }
      ]
    )

    controller.update({
      gasPrices: prices,
      estimation,
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal',
      feeToken: nativeFeeToken,
      paidBy: eoaAccount.addr
    })

    const errors = controller.errors
    expect(errors.length).toBe(1)
    expect(errors[0]).toBe('Insufficient funds to cover the fee.')

    await controller.sign()
    expect(controller.status?.type).toBe('unable-to-sign')
  })

  test('Signing [EOA]: should return an error if the availableAmount is lower than required', async () => {
    const { controller, estimation, prices } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        gasUsed: 10000n,
        currentAccountNonce: 0,
        feePaymentOptions: [
          {
            paidBy: eoaAccount.addr,
            availableAmount: 1n,
            gasUsed: 0n,
            addedNative: 5000n,
            token: {
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
            }
          }
        ],
        // even if availableAmount is lower than required, there is no error in
        // the estimation. SingAccountOp should disable signing
        error: null
      },
      [
        {
          name: 'slow',
          baseFeePerGas: 100n,
          maxPriorityFeePerGas: 100n
        },
        {
          name: 'medium',
          baseFeePerGas: 200n,
          maxPriorityFeePerGas: 200n
        },
        {
          name: 'fast',
          baseFeePerGas: 300n,
          maxPriorityFeePerGas: 300n
        },
        {
          name: 'ape',
          baseFeePerGas: 400n,
          maxPriorityFeePerGas: 400n
        }
      ]
    )

    controller.update({
      gasPrices: prices,
      estimation,
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal',
      feeToken: nativeFeeToken,
      paidBy: eoaAccount.addr
    })

    const errors = controller.errors
    expect(errors.length).toBe(1)
    expect(errors[0]).toBe('Insufficient funds to cover the fee.')

    await controller.sign()
    expect(controller.status?.type).toBe('unable-to-sign')
  })

  test('Signing [Relayer]: Smart account paying with ERC-20 token.', async () => {
    const networkId = 'polygon'
    const network = networks.find((net) => net.id === networkId)!
    const { controller, estimation, prices } = await init(
      smartAccount,
      createAccountOp(smartAccount, network.id),
      eoaSigner,
      {
        gasUsed: 50000n,
        currentAccountNonce: 0,
        feePaymentOptions: [
          {
            paidBy: smartAccount.addr,
            availableAmount: 500000000n,
            gasUsed: 25000n,
            addedNative: 0n,
            token: {
              address: '0x0000000000000000000000000000000000000000',
              amount: 1n,
              symbol: 'matic',
              networkId: 'polygon',
              decimals: 18,
              priceIn: [],
              flags: {
                onGasTank: false,
                rewardsType: null,
                canTopUpGasTank: true,
                isFeeToken: true
              }
            }
          },
          {
            paidBy: smartAccount.addr,
            availableAmount: 500000000n,
            gasUsed: 50000n,
            addedNative: 0n,
            token: {
              address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
              amount: 1n,
              symbol: 'usdt',
              networkId: 'polygon',
              decimals: 6,
              priceIn: [
                {
                  baseCurrency: 'usd',
                  price: 1
                }
              ],
              flags: {
                onGasTank: false,
                rewardsType: null,
                canTopUpGasTank: true,
                isFeeToken: true
              }
            }
          },
          {
            paidBy: smartAccount.addr,
            availableAmount: 500000000n,
            gasUsed: 25000n,
            addedNative: 0n,
            token: {
              address: usdcFeeToken.address,
              amount: 1n,
              symbol: 'usdc',
              networkId: 'polygon',
              decimals: 6,
              priceIn: [
                {
                  baseCurrency: 'usd',
                  price: 1
                }
              ],
              flags: {
                onGasTank: false,
                rewardsType: null,
                canTopUpGasTank: true,
                isFeeToken: true
              }
            }
          }
        ],
        error: null
      },
      [
        {
          name: 'slow',
          baseFeePerGas: 1000000000n,
          maxPriorityFeePerGas: 1000000000n
        },
        {
          name: 'medium',
          baseFeePerGas: 2000000000n,
          maxPriorityFeePerGas: 2000000000n
        },
        {
          name: 'fast',
          baseFeePerGas: 5000000000n,
          maxPriorityFeePerGas: 5000000000n
        },
        {
          name: 'ape',
          baseFeePerGas: 7000000000n,
          maxPriorityFeePerGas: 7000000000n
        }
      ]
    )

    // We are mocking estimation and prices values, in order to validate the gas prices calculation in the test.
    // Knowing the exact amount of estimation and gas prices, we can predict GasFeePayment values.
    jest.spyOn(gasPricesLib, 'getCallDataAdditionalByNetwork').mockReturnValue(25000n)

    controller.update({
      gasPrices: prices,
      estimation
    })

    controller.update({
      feeToken: usdcFeeToken,
      paidBy: smartAccount.addr,
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal'
    })

    expect(controller.availableFeeOptions.length).toBe(3)
    controller.availableFeeOptions.forEach((option) => {
      const identifier = getFeeSpeedIdentifier(option, smartAccount.addr)
      expect(controller.feeSpeeds[identifier]).not.toBe(undefined)
      expect(controller.feeSpeeds[identifier].length).not.toBe(0)
    })

    await controller.sign()

    if (!controller.accountOp?.signature) {
      console.log('Signing errors:', controller.errors)
      throw new Error('Signing failed!')
    }

    expect(controller.accountOp!.gasFeePayment?.isERC4337).toBe(false)
    expect(controller.accountOp!.gasFeePayment?.paidBy).toBe(smartAccount.addr)

    const typedData = getTypedData(
      network.chainId,
      controller.accountOp.accountAddr,
      ethers.hexlify(accountOpSignableHash(controller.accountOp, network.chainId))
    )
    delete typedData.types.EIP712Domain
    const unwrappedSig = controller.accountOp.signature.slice(0, -2)
    const signerAddr = ethers.verifyTypedData(
      typedData.domain,
      typedData.types,
      typedData.message,
      unwrappedSig
    )

    // We expect the transaction to be signed with the passed signer address (keyPublicAddress)
    expect(eoaAccount.addr).toEqual(signerAddr)
    // If signing is successful, we expect controller's status to be done
    expect(controller.status).toEqual({ type: 'done' })

    // USDC decimals 6, that's why we divide by 1e6
    const fee = controller.accountOp!.gasFeePayment!.amount / BigInt(1e6)

    // We expect fee of $1 USDC
    expect(fee.toString()).toEqual('1')

    // We expect the fee payment call to be added.
    // TODO: here we can extend the validation a bit.
    expect(controller.accountOp.feeCall!.to).toEqual(controller.accountOp.gasFeePayment!.inToken)

    // We expect the signature to be wrapped with an Ambire type. More info: wrapEthSign().
    expect(controller.accountOp?.signature.slice(-2)).toEqual('01')
  })

  test('Signing [Relayer]: should return an error if paying with ERC-20 token but no priceIn | nativeRatio available.', async () => {
    const networkId = 'polygon'
    const network = networks.find((net) => net.id === networkId)!
    const feeTokenResult = {
      address: usdcFeeToken.address,
      amount: 1n,
      symbol: 'usdc',
      networkId: 'polygon',
      decimals: 6,
      // we make the priceIn empty for this test
      priceIn: [],
      flags: {
        onGasTank: false,
        rewardsType: null,
        canTopUpGasTank: true,
        isFeeToken: true
      }
    }
    const { controller, estimation, prices } = await init(
      smartAccount,
      createAccountOp(smartAccount, network.id),
      eoaSigner,
      {
        gasUsed: 50000n,
        currentAccountNonce: 0,
        feePaymentOptions: [
          {
            paidBy: smartAccount.addr,
            availableAmount: 500000000n,
            gasUsed: 50000n,
            addedNative: 0n,
            token: feeTokenResult
          }
        ],
        error: null
      },
      [
        {
          name: 'slow',
          baseFeePerGas: 1000000000n,
          maxPriorityFeePerGas: 1000000000n
        },
        {
          name: 'medium',
          baseFeePerGas: 2000000000n,
          maxPriorityFeePerGas: 2000000000n
        },
        {
          name: 'fast',
          baseFeePerGas: 5000000000n,
          maxPriorityFeePerGas: 5000000000n
        },
        {
          name: 'ape',
          baseFeePerGas: 7000000000n,
          maxPriorityFeePerGas: 7000000000n
        }
      ]
    )

    // We are mocking estimation and prices values, in order to validate the gas prices calculation in the test.
    // Knowing the exact amount of estimation and gas prices, we can predict GasFeePayment values.
    jest.spyOn(gasPricesLib, 'getCallDataAdditionalByNetwork').mockReturnValue(25000n)

    controller.update({
      gasPrices: prices,
      estimation,
      feeToken: feeTokenResult,
      paidBy: smartAccount.addr,
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal'
    })

    expect(controller.availableFeeOptions.length).toBe(1)
    const identifier = getFeeSpeedIdentifier(controller.availableFeeOptions[0], smartAccount.addr)
    expect(controller.feeSpeeds[identifier]).not.toBe(undefined)
    expect(controller.feeSpeeds[identifier].length).toBe(0)

    const errors = controller.errors
    expect(errors.length).toBe(1)
    expect(errors[0]).toBe(
      `Currently, ${controller.availableFeeOptions[0].token.symbol} is unavailable as a fee token as we're experiencing troubles fetching its price. Please select another or contact support`
    )

    await controller.sign()
    expect(controller.accountOp?.signature).toBe(null)
  })

  test('Signing [Relayer]: Smart account paying with gas tank.', async () => {
    const networkId = 'polygon'
    const network = networks.find((net) => net.id === networkId)!
    const { controller, estimation, prices } = await init(
      smartAccount,
      createAccountOp(smartAccount, network.id),
      eoaSigner,
      {
        gasUsed: 50000n,
        currentAccountNonce: 0,
        feePaymentOptions: [
          {
            paidBy: smartAccount.addr,
            availableAmount: 5000000000000000000n,
            gasUsed: 25000n,
            addedNative: 0n,
            token: {
              address: '0x0000000000000000000000000000000000000000',
              amount: 1n,
              symbol: 'matic',
              networkId: 'polygon',
              decimals: 18,
              priceIn: [],
              flags: {
                onGasTank: true,
                rewardsType: null,
                canTopUpGasTank: true,
                isFeeToken: true
              }
            }
          },
          {
            paidBy: smartAccount.addr,
            availableAmount: 500000000n,
            gasUsed: 50000n,
            addedNative: 0n,
            token: {
              address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
              amount: 1n,
              symbol: 'usdt',
              networkId: 'polygon',
              decimals: 6,
              priceIn: [],
              flags: {
                onGasTank: false,
                rewardsType: null,
                canTopUpGasTank: true,
                isFeeToken: true
              }
            }
          },
          {
            paidBy: smartAccount.addr,
            availableAmount: 500000000n,
            gasUsed: 25000n,
            addedNative: 0n,
            token: {
              address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
              amount: 1n,
              symbol: 'usdc',
              networkId: 'polygon',
              decimals: 6,
              priceIn: [],
              flags: {
                onGasTank: false,
                rewardsType: null,
                canTopUpGasTank: true,
                isFeeToken: true
              }
            }
          }
        ],
        error: null
      },
      [
        {
          name: 'slow',
          baseFeePerGas: 1000000000n,
          maxPriorityFeePerGas: 1000000000n
        },
        {
          name: 'medium',
          baseFeePerGas: 2000000000n,
          maxPriorityFeePerGas: 2000000000n
        },
        {
          name: 'fast',
          baseFeePerGas: 5000000000n,
          maxPriorityFeePerGas: 5000000000n
        },
        {
          name: 'ape',
          baseFeePerGas: 7000000000n,
          maxPriorityFeePerGas: 7000000000n
        }
      ]
    )

    // We are mocking estimation and prices values, in order to validate the gas prices calculation in the test.
    // Knowing the exact amount of estimation and gas prices, we can predict GasFeePayment values.
    jest.spyOn(gasPricesLib, 'getCallDataAdditionalByNetwork').mockReturnValue(25000n)

    controller.update({
      gasPrices: prices,
      estimation
    })

    // @ts-ignore
    controller.update({
      feeToken: gasTankToken,
      paidBy: smartAccount.addr,
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal'
    })

    await controller.sign()

    if (!controller.accountOp?.signature) {
      console.log('Signing errors:', controller.errors)
      throw new Error('Signing failed!')
    }
    const typedData = getTypedData(
      network.chainId,
      controller.accountOp.accountAddr,
      ethers.hexlify(accountOpSignableHash(controller.accountOp, network.chainId))
    )
    delete typedData.types.EIP712Domain
    const unwrappedSig = controller.accountOp.signature.slice(0, -2)
    const signerAddr = ethers.verifyTypedData(
      typedData.domain,
      typedData.types,
      typedData.message,
      unwrappedSig
    )

    // We expect the transaction to be signed with the passed signer address (keyPublicAddress)
    expect(eoaAccount.addr).toEqual(signerAddr)
    // If signing is successful, we expect controller's status to be done
    expect(controller.status).toEqual({ type: 'done' })

    // We expect the fee payment call to be added.
    const abiCoder = new ethers.AbiCoder()
    expect(controller.accountOp.feeCall!.to).toEqual(FEE_COLLECTOR)
    expect(controller.accountOp.feeCall!.value).toEqual(0n)
    expect(controller.accountOp.feeCall!.data).toEqual(
      abiCoder.encode(
        ['string', 'uint256', 'string'],
        ['gasTank', controller.accountOp!.gasFeePayment!.amount, 'MATIC']
      )
    )

    // We expect the signature to be wrapped with an Ambire type. More info: wrapEthSign().
    expect(controller.accountOp?.signature.slice(-2)).toEqual('01')
  })

  test('Signing [SA with EOA payment]: working case + 2 feePaymentOptions but 1 feeSpeed as both feePaymentOptions are EOA', async () => {
    const network = networks.find((net) => net.id === 'polygon')!
    const { controller, estimation, prices } = await init(
      smartAccount,
      createAccountOp(smartAccount, network.id),
      eoaSigner,
      {
        gasUsed: 10000n,
        currentAccountNonce: 0,
        feePaymentOptions: [
          {
            paidBy: eoaAccount.addr,
            availableAmount: 1000000000000000000n, // 1 MATIC
            gasUsed: 0n,
            addedNative: 5000n,
            token: {
              address: '0x0000000000000000000000000000000000000000',
              amount: 1n,
              symbol: 'matic',
              networkId: 'polygon',
              decimals: 18,
              priceIn: [],
              flags: {
                onGasTank: false,
                rewardsType: null,
                canTopUpGasTank: true,
                isFeeToken: true
              }
            }
          },
          {
            paidBy: trezorEoa.addr,
            availableAmount: 2000000000000000000n, // 1 MATIC
            gasUsed: 0n,
            addedNative: 5000n,
            token: {
              address: '0x0000000000000000000000000000000000000000',
              amount: 1n,
              symbol: 'matic',
              networkId: 'polygon',
              decimals: 18,
              priceIn: [],
              flags: {
                onGasTank: false,
                rewardsType: null,
                canTopUpGasTank: true,
                isFeeToken: true
              }
            }
          },
          {
            paidBy: otherEoa.addr,
            availableAmount: 3000000000000000000n, // 1 MATIC
            gasUsed: 0n,
            addedNative: 5000n,
            token: {
              address: '0x0000000000000000000000000000000000000000',
              amount: 1n,
              symbol: 'matic',
              networkId: 'polygon',
              decimals: 18,
              priceIn: [],
              flags: {
                onGasTank: false,
                rewardsType: null,
                canTopUpGasTank: true,
                isFeeToken: true
              }
            }
          }
        ],
        error: null
      },
      [
        {
          name: 'slow',
          baseFeePerGas: 100n,
          maxPriorityFeePerGas: 100n
        },
        {
          name: 'medium',
          baseFeePerGas: 200n,
          maxPriorityFeePerGas: 200n
        },
        {
          name: 'fast',
          baseFeePerGas: 300n,
          maxPriorityFeePerGas: 300n
        },
        {
          name: 'ape',
          baseFeePerGas: 400n,
          maxPriorityFeePerGas: 400n
        }
      ]
    )

    // We are mocking estimation and prices values, in order to validate the gas prices calculation in the test.
    // Knowing the exact amount of estimation and gas prices, we can predict GasFeePayment values.
    jest.spyOn(gasPricesLib, 'getCallDataAdditionalByNetwork').mockReturnValue(5000n)

    controller.update({
      gasPrices: prices,
      estimation,
      feeToken: nativeFeeTokenPolygon,
      paidBy: eoaSigner.keyPublicAddress,
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal'
    })

    expect(controller.availableFeeOptions.length).toBe(3)
    const firstIdentity = getFeeSpeedIdentifier(
      controller.availableFeeOptions[0],
      smartAccount.addr
    )
    const secondIdentity = getFeeSpeedIdentifier(
      controller.availableFeeOptions[1],
      smartAccount.addr
    )
    expect(firstIdentity).toBe(secondIdentity)
    expect(Object.keys(controller.feeSpeeds).length).toBe(1)
    expect(controller.feeSpeeds[firstIdentity]).not.toBe(undefined)
    expect(controller.feeSpeeds[firstIdentity].length).toBe(4)

    await controller.sign()

    if (!controller.accountOp?.signature) {
      console.log('Signing errors:', controller.errors)
      throw new Error('Signing failed!')
    }

    expect(controller.accountOp.gasFeePayment).toEqual({
      paidBy: eoaSigner.keyPublicAddress,
      isERC4337: false,
      isGasTank: false,
      inToken: '0x0000000000000000000000000000000000000000',
      amount: 9005000n, // (300 + 300) × (10000+5000) + 10000, i.e. (baseFee + priorityFee) * (gasUsed + additionalCall) + addedNative
      simulatedGasLimit: 15000n, // 10000 + 5000, i.e. gasUsed + additionalCall
      maxPriorityFeePerGas: 300n,
      gasPrice: 600n
    })

    const typedData = getTypedData(
      network.chainId,
      controller.accountOp.accountAddr,
      ethers.hexlify(accountOpSignableHash(controller.accountOp, network.chainId))
    )
    const unwrappedSig = controller.accountOp.signature.slice(0, -2)
    delete typedData.types.EIP712Domain
    const signerAddr = ethers.verifyTypedData(
      typedData.domain,
      typedData.types,
      typedData.message,
      unwrappedSig
    )

    // We expect the transaction to be signed with the passed signer address (keyPublicAddress)
    expect(eoaSigner.keyPublicAddress).toEqual(signerAddr)

    // We expect the signature to be wrapped with an Ambire type. More info: wrapEthSign().
    expect(controller.accountOp?.signature.slice(-2)).toEqual('01')

    // If signing is successful, we expect controller's status to be done
    expect(controller.status).toEqual({ type: 'done' })
  })

  test('Signing [SA with EOA payment]: not enough funds to cover the fee', async () => {
    const network = networks.find((net) => net.id === 'polygon')!
    const { controller, estimation, prices } = await init(
      smartAccount,
      createAccountOp(smartAccount, network.id),
      eoaSigner,
      {
        gasUsed: 10000n,
        currentAccountNonce: 0,
        feePaymentOptions: [
          {
            paidBy: eoaAccount.addr,
            availableAmount: 100n, // not enough
            gasUsed: 0n,
            addedNative: 5000n,
            token: {
              address: '0x0000000000000000000000000000000000000000',
              amount: 1n,
              symbol: 'matic',
              networkId: 'polygon',
              decimals: 18,
              priceIn: [],
              flags: {
                onGasTank: false,
                rewardsType: null,
                canTopUpGasTank: true,
                isFeeToken: true
              }
            }
          }
        ],
        error: null
      },
      [
        {
          name: 'slow',
          baseFeePerGas: 100n,
          maxPriorityFeePerGas: 100n
        },
        {
          name: 'medium',
          baseFeePerGas: 200n,
          maxPriorityFeePerGas: 200n
        },
        {
          name: 'fast',
          baseFeePerGas: 300n,
          maxPriorityFeePerGas: 300n
        },
        {
          name: 'ape',
          baseFeePerGas: 400n,
          maxPriorityFeePerGas: 400n
        }
      ]
    )

    // We are mocking estimation and prices values, in order to validate the gas prices calculation in the test.
    // Knowing the exact amount of estimation and gas prices, we can predict GasFeePayment values.
    jest.spyOn(gasPricesLib, 'getCallDataAdditionalByNetwork').mockReturnValue(5000n)

    controller.update({
      gasPrices: prices,
      estimation,
      feeToken: nativeFeeTokenPolygon,
      paidBy: eoaSigner.keyPublicAddress,
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal'
    })

    const errors = controller.errors
    expect(errors.length).toBe(1)
    expect(errors[0]).toBe(
      "Signing is not possible with the selected account's token as it doesn't have sufficient funds to cover the gas payment fee."
    )

    await controller.sign()
    expect(controller.status?.type).toBe('unable-to-sign')
  })

  test('Signing [V1 with EOA payment]: working case', async () => {
    const { controller, estimation, prices } = await init(
      v1Account,
      createAccountOp(v1Account),
      eoaSigner,
      {
        gasUsed: 10000n,
        currentAccountNonce: 0,
        feePaymentOptions: [
          {
            paidBy: eoaAccount.addr,
            availableAmount: 1000000000000000000n, // 1 ETH
            gasUsed: 0n,
            addedNative: 5000n,
            token: {
              address: '0x0000000000000000000000000000000000000000',
              amount: 1n,
              symbol: 'eth',
              networkId: 'ethereum',
              decimals: 18,
              priceIn: [],
              flags: {
                onGasTank: false,
                rewardsType: null,
                canTopUpGasTank: true,
                isFeeToken: true
              }
            }
          }
        ],
        error: null
      },
      [
        {
          name: 'slow',
          baseFeePerGas: 100n,
          maxPriorityFeePerGas: 100n
        },
        {
          name: 'medium',
          baseFeePerGas: 200n,
          maxPriorityFeePerGas: 200n
        },
        {
          name: 'fast',
          baseFeePerGas: 300n,
          maxPriorityFeePerGas: 300n
        },
        {
          name: 'ape',
          baseFeePerGas: 400n,
          maxPriorityFeePerGas: 400n
        }
      ]
    )

    controller.update({
      gasPrices: prices,
      estimation,
      feeToken: nativeFeeToken,
      paidBy: eoaSigner.keyPublicAddress,
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal'
    })

    await controller.sign()

    if (!controller.accountOp?.signature) {
      console.log('Signing errors:', controller.errors)
      throw new Error('Signing failed!')
    }

    const message = accountOpSignableHash(controller.accountOp, 1n)
    const unwrappedSig = controller.accountOp.signature.slice(0, -2)
    const signerAddr = ethers.verifyMessage(message, unwrappedSig)

    // We expect the transaction to be signed with the passed signer address (keyPublicAddress)
    expect(eoaSigner.keyPublicAddress).toEqual(signerAddr)

    // We expect the signature to be wrapped with an Ambire type. More info: wrapEthSign().
    expect(controller.accountOp?.signature.slice(-2)).toEqual('01')

    // If signing is successful, we expect controller's status to be done
    expect(controller.status).toEqual({ type: 'done' })
  })

  // TODO:
  // Commenting out the below test as it now requires a paymaster
  // which in turns means we have to call the relayer with a valid signature

  // test('Signing [ERC-4337]: Smart account paying in native', async () => {
  //   const accOpInfo = createAccountOp(trezorSlot7v24337Deployed, 'avalanche')
  //   const accOp = accOpInfo.op
  //   const accountStates = await getAccountsInfo([trezorSlot7v24337Deployed])
  //   const userOp = getUserOperation(
  //     trezorSlot7v24337Deployed,
  //     accountStates[accOp.accountAddr][accOp.networkId],
  //     accOp
  //   )
  //   userOp.verificationGasLimit = toBeHex(6000n)
  //   userOp.callGasLimit = toBeHex(12000n)
  //   const { controller, estimation, prices } = await init(
  //     trezorSlot7v24337Deployed,
  //     accOpInfo,
  //     eoaSigner,
  //     {
  //       gasUsed: 200000n,
  //       nonce: 0,
  //       erc4337estimation: { userOp, gasUsed: 200000n },
  //       feePaymentOptions: [
  //         {
  //           address: '0x0000000000000000000000000000000000000000',
  //           paidBy: trezorSlot7v24337Deployed.addr,
  //           availableAmount: ethers.parseEther('10'),
  //           gasUsed: 25000n,
  //           addedNative: 0n,
  //           isGasTank: false
  //         }
  //       ],
  //       error: null,
  //     },
  //     [
  //       {
  //         name: 'slow',
  //         baseFeePerGas: 1000000000n,
  //         maxPriorityFeePerGas: 1000000000n
  //       },
  //       {
  //         name: 'medium',
  //         baseFeePerGas: 2000000000n,
  //         maxPriorityFeePerGas: 2000000000n
  //       },
  //       {
  //         name: 'fast',
  //         baseFeePerGas: 5000000000n,
  //         maxPriorityFeePerGas: 5000000000n
  //       },
  //       {
  //         name: 'ape',
  //         baseFeePerGas: 7000000000n,
  //         maxPriorityFeePerGas: 7000000000n
  //       }
  //     ]
  //   )

  //   expect(controller.accountOp.asUserOperation).toBe(undefined)

  //   // We are mocking estimation and prices values, in order to validate the gas prices calculation in the test.
  //   // Knowing the exact amount of estimation and gas prices, we can predict GasFeePayment values.
  //   jest.spyOn(gasPricesLib, 'getCallDataAdditionalByNetwork').mockReturnValue(25000n)

  //   controller.update({
  //     gasPrices: prices,
  //     estimation
  //   })

  //   controller.update({
  //     feeToken: nativeFeeTokenAvalanche,
  //     paidBy: trezorSlot7v24337Deployed.addr,
  //     signingKeyAddr: eoaSigner.keyPublicAddress,
  //     signingKeyType: 'internal'
  //   })

  //   await controller.sign()

  //   if (!controller.accountOp?.signature) {
  //     console.log('Signing errors:', controller.errors)
  //     throw new Error('Signing failed!')
  //   }

  //   expect(controller.accountOp!.gasFeePayment?.isERC4337).toBe(true)
  //   expect(controller.accountOp.asUserOperation!.requestType).toBe('standard')

  //   const entryPoint: any = new ethers.BaseContract(
  //     ERC_4337_ENTRYPOINT,
  //     EntryPointAbi,
  //     providers.avalanche
  //   )
  //   const typedData = getTypedData(
  //     43114n, // avalanche
  //     controller.accountOp.accountAddr,
  //     await entryPoint.getUserOpHash(controller.accountOp.asUserOperation!)
  //   )
  //   delete typedData.types.EIP712Domain
  //   const unwrappedSig = controller.accountOp.signature.slice(0, -2)
  //   expect(controller.accountOp.signature.slice(-2)).toBe('01')
  //   const signerAddr = ethers.verifyTypedData(
  //     typedData.domain,
  //     typedData.types,
  //     typedData.message,
  //     unwrappedSig
  //   )

  //   // We expect the transaction to be signed with the passed signer address (keyPublicAddress)
  //   expect(eoaAccount.addr).toEqual(signerAddr)
  //   // If signing is successful, we expect controller's status to be done
  //   expect(controller.status).toEqual({ type: 'done' })
  // })
})
