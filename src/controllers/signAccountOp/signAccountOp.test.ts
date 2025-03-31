/* eslint no-console: "off" */

import fetch from 'node-fetch'
import { EventEmitter } from 'stream'

import { describe, expect, test } from '@jest/globals'

import { relayerUrl, trezorSlot7v24337Deployed, velcroUrl } from '../../../test/config'
import { produceMemoryStore, waitForAccountsCtrlFirstLoad } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { EOA_SIMULATION_NONCE } from '../../consts/deployless'
import { networks } from '../../consts/networks'
import { Account } from '../../interfaces/account'
import { Storage } from '../../interfaces/storage'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { BROADCAST_OPTIONS } from '../../libs/broadcast/broadcast'
import { FullEstimationSummary } from '../../libs/estimate/interfaces'
import { GasRecommendation } from '../../libs/gasPrice/gasPrice'
import { KeystoreSigner } from '../../libs/keystoreSigner/keystoreSigner'
import { TokenResult } from '../../libs/portfolio'
import { BundlerSwitcher } from '../../services/bundlers/bundlerSwitcher'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { EstimationController } from '../estimation/estimation'
import { GasPriceController } from '../gasPrice/gasPrice'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { PortfolioController } from '../portfolio/portfolio'
import { ProvidersController } from '../providers/providers'
import { StorageController } from '../storage/storage'
import { SignAccountOpTesterController } from './signAccountOpTester'

const providers = Object.fromEntries(
  networks.map((network) => [network.chainId, getRpcProvider(network.rpcUrls, network.chainId)])
)

const createEOAAccountOp = (account: Account) => {
  const to = '0x0000000000000000000000000000000000000000'

  const data = '0x'

  const nativeToCheck: Account[] = [
    {
      addr: account.addr,
      associatedKeys: [account.addr],
      initialPrivileges: [],
      creation: null,
      preferences: {
        label: DEFAULT_ACCOUNT_LABEL,
        pfp: account.addr
      }
    }
  ]
  const feeTokens = [
    {
      address: '0x0000000000000000000000000000000000000000',
      amount: 1n,
      symbol: 'ETH',
      name: 'Ether',
      chainId: 1n,
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
    chainId: 1n,
    nonce: null, // does not matter when estimating
    calls: [{ to, value: BigInt(1), data }],
    accountOpToExecuteBefore: null,
    signature: null
  }

  return { op, nativeToCheck, feeTokens }
}

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
  creation: null,
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: eoaSigner.keyPublicAddress
  }
}

const nativeFeeToken: TokenResult = {
  address: '0x0000000000000000000000000000000000000000',
  symbol: 'ETH',
  name: 'Ether',
  amount: 1000n,
  chainId: 1n,
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
//   chainId: 43114n,
//   decimals: Number(18),
//   priceIn: [{ baseCurrency: 'usd', price: 100 }],
//   flags: {
//     onGasTank: false,
//     rewardsType: null,
//     canTopUpGasTank: true,
//     isFeeToken: true
//   }
// }

const windowManager = {
  event: new EventEmitter(),
  focus: () => Promise.resolve(),
  open: () => Promise.resolve({ id: 0, top: 0, left: 0, width: 100, height: 100, focused: true }),
  remove: () => Promise.resolve(),
  sendWindowToastMessage: () => {},
  sendWindowUiMessage: () => {}
}

const init = async (
  account: Account,
  accountOp: {
    op: AccountOp
    nativeToCheck: Account[]
    feeTokens: TokenResult[]
  },
  signer: any,
  estimationOrMock: FullEstimationSummary,
  gasPricesOrMock: { [key: string]: GasRecommendation[] },
  updateWholePortfolio?: boolean
) => {
  const storage: Storage = produceMemoryStore()
  const storageCtrl = new StorageController(storage)
  await storageCtrl.set('accounts', [account])
  const keystore = new KeystoreController(storageCtrl, { internal: KeystoreSigner }, windowManager)
  await keystore.addSecret('passphrase', signer.pass, '', false)
  await keystore.unlockWithSecret('passphrase', signer.pass)

  await keystore.addKeys([
    {
      addr: signer.keyPublicAddress,
      type: 'internal',
      label: 'Key 1',
      privateKey: signer.privKey,
      dedicatedToOneSA: true,
      meta: {
        createdAt: new Date().getTime()
      }
    }
  ])

  let providersCtrl: ProvidersController
  const networksCtrl = new NetworksController(
    storageCtrl,
    fetch,
    relayerUrl,
    (net) => {
      providersCtrl.setProvider(net)
    },
    (id) => {
      providersCtrl.removeProvider(id)
    }
  )
  providersCtrl = new ProvidersController(networksCtrl)
  providersCtrl.providers = providers
  const accountsCtrl = new AccountsController(
    storageCtrl,
    providersCtrl,
    networksCtrl,
    () => {},
    () => {},
    () => {}
  )
  await accountsCtrl.initialLoadPromise
  await waitForAccountsCtrlFirstLoad(accountsCtrl)
  await networksCtrl.initialLoadPromise
  await providersCtrl.initialLoadPromise

  const portfolio = new PortfolioController(
    storageCtrl,
    fetch,
    providersCtrl,
    networksCtrl,
    accountsCtrl,
    'https://staging-relayer.ambire.com',
    velcroUrl
  )
  const { op } = accountOp
  const network = networksCtrl.networks.find((x) => x.chainId === op.chainId)!
  await portfolio.updateSelectedAccount(account.addr, updateWholePortfolio ? undefined : network)
  const provider = getRpcProvider(network.rpcUrls, network.chainId)

  const accountState = accountsCtrl.accountStates[account.addr][network.chainId.toString()]
  const estimation = estimationOrMock

  if (portfolio.getLatestPortfolioState(account.addr)[op.chainId.toString()]!.result) {
    portfolio!.getLatestPortfolioState(account.addr)[op.chainId.toString()]!.result!.tokens = [
      {
        amount: 1n,
        chainId: op.chainId,
        decimals: Number(18),
        symbol: 'ETH',
        name: 'Ether',
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
        chainId: op.chainId,
        decimals: Number(6),
        symbol: 'USDC',
        name: 'USD Coin',
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

  const estimationController = new EstimationController(
    keystore,
    accountsCtrl,
    networksCtrl,
    providers,
    portfolio,
    () => {}
  )
  estimationController.estimation = estimation
  const bundlerSwitcher = new BundlerSwitcher(
    network,
    () => {
      return null
    },
    []
  )
  const gasPriceController = new GasPriceController(network, provider, bundlerSwitcher, () => {
    return null
  })
  gasPriceController.gasPrices = gasPricesOrMock
  const controller = new SignAccountOpTesterController(
    accountsCtrl,
    networksCtrl,
    providersCtrl,
    keystore,
    portfolio,
    {},
    account,
    accountState,
    network,
    provider,
    1,
    op,
    () => {},
    () => {},
    estimationController,
    gasPriceController
  )
  controller.update({
    hasNewEstimation: true,
    gasPrices: gasPricesOrMock[network.chainId.toString()]
  })

  return { controller, estimation }
}

describe('SignAccountOp Controller ', () => {
  test('Signing [EOA]: EOA account paying with a native token', async () => {
    const feePaymentOptions = [
      {
        paidBy: eoaAccount.addr,
        availableAmount: 1000000000000000000n, // 1 ETH
        gasUsed: 0n,
        addedNative: 5000n,
        token: {
          address: '0x0000000000000000000000000000000000000000',
          amount: 1n,
          symbol: 'ETH',
          name: 'Ether',
          chainId: 1n,
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
    ]
    const { controller } = await init(
      eoaAccount,
      createEOAAccountOp(eoaAccount),
      eoaSigner,
      {
        providerEstimation: {
          gasUsed: 10000n,
          feePaymentOptions
        },
        ambireEstimation: {
          gasUsed: 10000n,
          feePaymentOptions,
          ambireAccountNonce: Number(EOA_SIMULATION_NONCE),
          flags: {}
        },
        flags: {}
      },
      {
        // ethereum chain id
        '1': [
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
      }
    )

    controller.update({
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
      broadcastOption: BROADCAST_OPTIONS.bySelf,
      isGasTank: false,
      inToken: '0x0000000000000000000000000000000000000000',
      feeTokenChainId: 1n,
      amount: 6005000n, // ((300 + 300) × 10000) + 10000, i.e. ((baseFee + priorityFee) * gasUsed) + addedNative
      simulatedGasLimit: 10000n, // 10000, i.e. gasUsed,
      maxPriorityFeePerGas: 300n,
      gasPrice: 600n
    })

    expect(controller.accountOp.signature).toEqual('0x') // broadcasting and signRawTransaction is handled in main controller
    expect(controller.status).toEqual({ type: 'done' })
  })
})
