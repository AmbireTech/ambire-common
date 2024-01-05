import { ethers, JsonRpcProvider } from 'ethers'
import fetch from 'node-fetch'

import { describe, expect, jest, test } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import humanizerJSON from '../../consts/humanizerInfo.json'
import { networks } from '../../consts/networks'
import { Account, AccountStates } from '../../interfaces/account'
import { NetworkDescriptor } from '../../interfaces/networkDescriptor'
import { Storage } from '../../interfaces/storage'
import { accountOpSignableHash } from '../../libs/accountOp/accountOp'
import { getAccountState } from '../../libs/accountState/accountState'
import { estimate, EstimateResult } from '../../libs/estimate/estimate'
import * as gasPricesLib from '../../libs/gasPrice/gasPrice'
import { KeystoreSigner } from '../../libs/keystoreSigner/keystoreSigner'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { getTypedData } from '../../libs/signMessage/signMessage'
import { KeystoreController } from '../keystore/keystore'
import { PortfolioController } from '../portfolio/portfolio'
import { SettingsController } from '../settings/settings'
import { SignAccountOpController } from './signAccountOp'

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

const createAccountOp = (account: Account) => {
  const to = '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45'

  const tomorrowHex = Math.floor((Date.now() + 86400000) / 1000).toString(16)
  // 64 chars expire hex
  // we set swap deadline always for tomorrow, in order to prevent the test failure with 'TRANSACTION TOO OLD'
  const expire = '0'.repeat(64 - tomorrowHex.length) + tomorrowHex

  // USDT -> USDC swap
  // Fee tokens: USDT, USDC
  const data = `0x5ae401dc${expire}00000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000e404e45aaf000000000000000000000000dac17f958d2ee523a2206206994597c13d831ec7000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb4800000000000000000000000000000000000000000000000000000000000001f4000000000000000000000000a07d75aacefd11b425af7181958f0f85c312f14300000000000000000000000000000000000000000000000000000000000f424000000000000000000000000000000000000000000000000000000000000c33d9000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000`

  const nativeToCheck = ['0xAa0e9a1E2D2CcF2B867fda047bb5394BEF1883E0']
  const feeTokens = ['0x0000000000000000000000000000000000000000']

  const op = {
    accountAddr: account.addr,
    signingKeyAddr: null,
    signingKeyType: null,
    gasLimit: null,
    gasFeePayment: null,
    networkId: 'ethereum',
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

  const nativeToCheck = [account.addr]
  const feeTokens = ['0x0000000000000000000000000000000000000000']

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

const eoaAccount: Account = {
  addr: eoaSigner.keyPublicAddress,
  associatedKeys: [eoaSigner.keyPublicAddress],
  creation: null
}

const smartAccount: Account = {
  addr: '0xa07D75aacEFd11b425AF7181958F0F85c312f143',
  associatedKeys: ['0xd6e371526cdaeE04cd8AF225D42e37Bc14688D9E', eoaSigner.keyPublicAddress],
  creation: {
    factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
    bytecode:
      '0x7f28d4ea8f825adb036e9b306b2269570e63d2aa5bd10751437d98ed83551ba1cd7fa57498058891e98f45f8abb85dafbcd30f3d8b3ab586dfae2e0228bbb1de7018553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
    salt: '0x0000000000000000000000000000000000000000000000000000000000000001'
  }
}

const init = async (
  account: Account,
  accountOp: any,
  signer: any,
  estimationMock?: EstimateResult,
  gasPricesMock?: gasPricesLib.GasRecommendation[]
) => {
  const storage: Storage = produceMemoryStore()
  await storage.set('HumanizerMeta', humanizerMeta)

  const keystore = new KeystoreController(storage, { internal: KeystoreSigner })
  await keystore.addSecret('passphrase', signer.pass, '', false)
  await keystore.unlockWithSecret('passphrase', signer.pass)

  await keystore.addKeys([{ privateKey: signer.privKey, dedicatedToOneSA: true }])

  const ethereum = networks.find((x) => x.id === 'ethereum')!
  const provider = new JsonRpcProvider(ethereum!.rpcUrl)
  const accounts = [account]
  const accountStates = await getAccountsInfo(accounts)

  const prices =
    gasPricesMock || (await gasPricesLib.getGasPriceRecommendations(provider, ethereum))

  const { op, nativeToCheck, feeTokens } = accountOp
  const estimation =
    estimationMock ||
    (await estimate(
      provider,
      ethereum,
      account,
      op,
      accountStates[account.addr][ethereum.id],
      nativeToCheck,
      feeTokens
    ))

  const portfolio = new PortfolioController(
    storage,
    providers,
    'https://staging-relayer.ambire.com',
    []
  )
  await portfolio.updateSelectedAccount(accounts, networks, account.addr)

  if (portfolio.latest?.[account.addr]?.ethereum?.result) {
    portfolio!.latest[account.addr]!.ethereum!.result!.tokens = [
      {
        amount: 1n,
        networkId: 'ethereum',
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
        networkId: 'ethereum',
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
  const settings = new SettingsController(storage)
  const controller = new SignAccountOpController(
    keystore,
    portfolio,
    settings,
    account,
    accounts,
    accountStates,
    networks.find((n) => n.id === 'ethereum')!,
    op,
    storage,
    fetch,
    {
      ethereum: provider
    },
    callRelayer
  )

  return { controller, prices, estimation }
}

describe('SignAccountOp Controller ', () => {
  test('Default options', async () => {
    // Please note that in this test case, we intentionally refrain from mocking the estimation and gasPrices libraries.
    // The reason is that we aim to simulate the signing process as realistically as possible and prefer to depend on the actual underlying libraries rather than using mocks.
    const { controller, estimation, prices } = await init(
      smartAccount,
      createAccountOp(smartAccount),
      eoaSigner
    )

    controller.update({
      gasPrices: prices,
      estimation
    })

    // It sets a default signer
    expect(controller.accountOp.signingKeyAddr).toEqual(eoaSigner.keyPublicAddress)
    expect(controller.accountOp.signingKeyType).toEqual('internal')

    // It sets GasFeePayment with the first feePaymentOptions (as a default option)
    expect(controller.accountOp.gasFeePayment?.paidBy).toEqual(
      estimation.feePaymentOptions[0].paidBy
    )
    expect(controller.accountOp.gasFeePayment?.inToken).toEqual(
      estimation.feePaymentOptions[0].address
    )
  })

  test('Signing [EOA]: EOA account paying with a native token', async () => {
    const { controller, estimation, prices } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        gasUsed: 10000n,
        nonce: 0,
        feePaymentOptions: [
          {
            address: '0x0000000000000000000000000000000000000000',
            paidBy: eoaAccount.addr,
            availableAmount: 1000000000000000000n, // 1 ETH
            gasUsed: 0n,
            addedNative: 5000n
          }
        ],
        erc4337estimation: null
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
      feeTokenAddr: '0x0000000000000000000000000000000000000000', // ETH
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
      maxPriorityFeePerGas: 300n
    })

    expect(controller.accountOp.signature).toEqual('0x') // broadcasting and signRawTransaction is handled in main controller
    expect(controller.status).toEqual({ type: 'done' })
  })

  test('Signing [Relayer]: Smart account paying with ERC-20 token.', async () => {
    const { controller, estimation, prices } = await init(
      smartAccount,
      createAccountOp(smartAccount),
      eoaSigner,
      {
        gasUsed: 50000n,
        nonce: 0,
        erc4337estimation: null,
        feePaymentOptions: [
          {
            address: '0x0000000000000000000000000000000000000000',
            paidBy: smartAccount.addr,
            availableAmount: 500000000n,
            gasUsed: 25000n,
            addedNative: 0n
          },
          {
            address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
            paidBy: smartAccount.addr,
            availableAmount: 500000000n,
            gasUsed: 50000n,
            addedNative: 0n
          },
          {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            paidBy: smartAccount.addr,
            availableAmount: 500000000n,
            gasUsed: 25000n,
            addedNative: 0n
          }
        ]
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
    jest.spyOn(gasPricesLib, 'getCallDataAdditional').mockReturnValue(25000n)

    controller.update({
      gasPrices: prices,
      estimation
    })

    controller.update({
      feeTokenAddr: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
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
      1n,
      controller.accountOp.accountAddr,
      ethers.hexlify(accountOpSignableHash(controller.accountOp))
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

  test('Signing: Smart account, but EOA pays the fee', async () => {
    const { controller, estimation, prices } = await init(
      smartAccount,
      createAccountOp(smartAccount),
      eoaSigner,
      {
        gasUsed: 10000n,
        nonce: 0,
        feePaymentOptions: [
          {
            address: '0x0000000000000000000000000000000000000000',
            paidBy: eoaAccount.addr,
            availableAmount: 1000000000000000000n, // 1 ETH
            gasUsed: 0n,
            addedNative: 5000n
          }
        ],
        erc4337estimation: null
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
    jest.spyOn(gasPricesLib, 'getCallDataAdditional').mockReturnValue(5000n)

    controller.update({
      gasPrices: prices,
      estimation,
      feeTokenAddr: '0x0000000000000000000000000000000000000000', // ETH
      paidBy: eoaSigner.keyPublicAddress,
      signingKeyAddr: eoaSigner.keyPublicAddress,
      signingKeyType: 'internal'
    })

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
      amount: 9005000n, // *300 + 300) × (10000+5000) + 10000, i.e. (baseFee + priorityFee) * (gasUsed + additionalCall) + addedNative
      simulatedGasLimit: 15000n, // 10000 + 5000, i.e. gasUsed + additionalCall
      maxPriorityFeePerGas: 300n
    })

    const typedData = getTypedData(
      1n,
      controller.accountOp.accountAddr,
      ethers.hexlify(accountOpSignableHash(controller.accountOp))
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
})
