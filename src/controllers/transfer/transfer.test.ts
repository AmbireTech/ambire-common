/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable @typescript-eslint/no-floating-promises */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-useless-constructor */
/* eslint-disable max-classes-per-file */

import { hexlify, randomBytes } from 'ethers'
import fetch from 'node-fetch'

import { expect } from '@jest/globals'

import { relayerUrl, velcroUrl } from '../../../test/config'
import { mockInternalKeys, produceMemoryStore } from '../../../test/helpers'
import { mockUiManager } from '../../../test/helpers/ui'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { FEE_COLLECTOR } from '../../consts/addresses'
import humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { networks } from '../../consts/networks'
import { Account } from '../../interfaces/account'
import { Hex } from '../../interfaces/hex'
import { Key, KeystoreSignerInterface } from '../../interfaces/keystore'
import { HumanizerMeta } from '../../libs/humanizer/interfaces'
import { TokenResult } from '../../libs/portfolio'
import { relayerCall } from '../../libs/relayerCall/relayerCall'
import { getRpcProvider } from '../../services/provider'
import { AccountsController } from '../accounts/accounts'
import { ActivityController } from '../activity/activity'
import { AddressBookController } from '../addressBook/addressBook'
import { AutoLoginController } from '../autoLogin/autoLogin'
import { BannerController } from '../banner/banner'
import { FeatureFlagsController } from '../featureFlags/featureFlags'
import { InviteController } from '../invite/invite'
import { KeystoreController } from '../keystore/keystore'
import { NetworksController } from '../networks/networks'
import { PhishingController } from '../phishing/phishing'
import { PortfolioController } from '../portfolio/portfolio'
import { ProvidersController } from '../providers/providers'
import { SelectedAccountController } from '../selectedAccount/selectedAccount'
import { StorageController } from '../storage/storage'
import { UiController } from '../ui/ui'
import { TransferController } from './transfer'

const ethereum = networks.find((x) => x.chainId === 1n)
const polygon = networks.find((x) => x.chainId === 137n)

if (!ethereum || !polygon) throw new Error('Failed to find ethereum in networks')

const PLACEHOLDER_RECIPIENT = '0xc4A6bB5139123bD6ba0CF387828a9A3a73EF8D1e'

const XWALLET_ADDRESS = '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935'
const STK_WALLET_ADDRESS = '0xE575cC6EC0B5d176127ac61aD2D3d9d19d1aa4a0'

const providers = Object.fromEntries(
  networks.map((network) => [network.chainId, getRpcProvider(network.rpcUrls, network.chainId)])
)

const account = {
  addr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
  initialPrivileges: [],
  associatedKeys: ['0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175'],
  creation: {
    factoryAddr: '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA',
    bytecode:
      '0x7f00000000000000000000000000000000000000000000000000000000000000017f02c94ba85f2ea274a3869293a0a9bf447d073c83c617963b0be7c862ec2ee44e553d602d80604d3d3981f3363d3d373d3d3d363d732a2b85eb1054d6f0c6c2e37da05ed3e5fea684ef5af43d82803e903d91602b57fd5bf3',
    salt: '0x2ee01d932ede47b0b2fb1b6af48868de9f86bfc9a5be2f0b42c0111cf261d04c'
  },
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5'
  }
}

// TODO - this mocks are being duplicated across the tests. Should reuse it.
class InternalSigner {
  key

  privKey

  constructor(_key: Key, _privKey?: string) {
    this.key = _key
    this.privKey = _privKey
  }

  signRawTransaction() {
    return Promise.resolve('')
  }

  signTypedData() {
    return Promise.resolve('')
  }

  signMessage() {
    return Promise.resolve('')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sign7702: KeystoreSignerInterface['sign7702'] = async (s) => {
    return {
      yParity: '0x00',
      r: hexlify(randomBytes(32)) as Hex,
      s: hexlify(randomBytes(32)) as Hex
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  signTransactionTypeFour: KeystoreSignerInterface['signTransactionTypeFour'] = async (s) => {
    throw new Error('not supported')
  }
}

class LedgerSigner {
  key

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor(_key: Key) {
    this.key = _key
  }

  signRawTransaction() {
    return Promise.resolve('')
  }

  signTypedData() {
    return Promise.resolve('')
  }

  signMessage() {
    return Promise.resolve('')
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sign7702: KeystoreSignerInterface['sign7702'] = async (s) => {
    return {
      yParity: '0x00',
      r: hexlify(randomBytes(32)) as Hex,
      s: hexlify(randomBytes(32)) as Hex
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  signTransactionTypeFour: KeystoreSignerInterface['signTransactionTypeFour'] = async (s) => {
    throw new Error('not supported')
  }
}

const { uiManager } = mockUiManager()

const getTokens = () => {
  return structuredClone(ETHEREUM_TOKENS.concat(POLYGON_TOKENS))
}

const prepareTest = async () => {
  const storage = produceMemoryStore()
  const storageCtrl = new StorageController(storage)

  const accounts = [account]

  const mockKeys = mockInternalKeys(accounts as Account[])

  storage.set('keystoreKeys', mockKeys)

  storageCtrl.set('accounts', accounts)

  let providersCtrl: any

  const networksCtrl = new NetworksController({
    storage: storageCtrl,
    fetch,
    relayerUrl,
    getProvider: (chainId) => {
      return providersCtrl.providers[chainId.toString()]!
    },
    onAddOrUpdateNetworks: () => {}
  })

  const uiCtrl = new UiController({ uiManager })
  providersCtrl = new ProvidersController(networksCtrl, storageCtrl, uiCtrl)
  providersCtrl.providers = providers

  const keystoreSigners = { internal: InternalSigner, ledger: LedgerSigner }
  const keystoreController = new KeystoreController('default', storageCtrl, keystoreSigners, uiCtrl)

  const accountsCtrl = new AccountsController(
    storageCtrl,
    providersCtrl,
    networksCtrl,
    keystoreController,
    () => {},
    () => {},
    () => {},
    relayerUrl,
    fetch
  )
  const autoLoginCtrl = new AutoLoginController(
    storageCtrl,
    keystoreController,
    providersCtrl,
    networksCtrl,
    accountsCtrl,
    {},
    new InviteController({ relayerUrl, fetch, storage: storageCtrl })
  )

  const selectedAccountCtrl = new SelectedAccountController({
    storage: storageCtrl,
    accounts: accountsCtrl,
    keystore: keystoreController,
    autoLogin: autoLoginCtrl
  })

  const addressBookController = new AddressBookController(
    storageCtrl,
    accountsCtrl,
    selectedAccountCtrl
  )

  const callRelayer = relayerCall.bind({ url: '', fetch })

  const featureFlagsCtrl = new FeatureFlagsController({}, storageCtrl)
  const portfolioController = new PortfolioController(
    storageCtrl,
    fetch,
    providersCtrl,
    networksCtrl,
    accountsCtrl,
    keystoreController,
    relayerUrl,
    velcroUrl,
    new BannerController(storageCtrl),
    featureFlagsCtrl
  )
  const activity = new ActivityController(
    storageCtrl,
    fetch,
    callRelayer,
    accountsCtrl,
    selectedAccountCtrl,
    providersCtrl,
    networksCtrl,
    portfolioController,
    () => Promise.resolve()
  )

  const phishing = new PhishingController({
    fetch,
    storage: storageCtrl,
    addressBook: addressBookController
  })

  const transferController = new TransferController(
    () => {},
    storageCtrl,
    humanizerInfo as HumanizerMeta,
    selectedAccountCtrl,
    networksCtrl,
    addressBookController,
    accountsCtrl,
    keystoreController,
    portfolioController,
    activity,
    {},
    providersCtrl,
    phishing,
    relayerUrl,
    () => Promise.resolve(),
    uiCtrl
  )

  await selectedAccountCtrl.initialLoadPromise
  await selectedAccountCtrl.setAccount(account)

  return {
    transferController,
    tokens: getTokens()
  }
}

describe('Transfer Controller', () => {
  test('should set address state', async () => {
    const { transferController } = await prepareTest()
    await transferController.update({
      addressState: {
        fieldValue: PLACEHOLDER_RECIPIENT,
        ensAddress: '',
        isDomainResolving: false
      }
    })
    expect(transferController.addressState.fieldValue).toBe(PLACEHOLDER_RECIPIENT)
  })
  test('should set recipient address unknown', async () => {
    const { transferController } = await prepareTest()
    await transferController.update({
      addressState: {
        fieldValue: PLACEHOLDER_RECIPIENT,
        ensAddress: '',
        isDomainResolving: false
      }
    })

    expect(transferController.isRecipientAddressUnknown).toBe(true)
  })
  test('should flag recipient address as a smart contract', async () => {
    const { transferController } = await prepareTest()

    await transferController.update({
      addressState: {
        fieldValue: XWALLET_ADDRESS,
        ensAddress: '',
        isDomainResolving: false
      }
    })
    expect(transferController.isRecipientHumanizerKnownTokenOrSmartContract).toBe(true)
  })
  test('should change selected token', async () => {
    const { transferController, tokens } = await prepareTest()

    const xwalletOnEthereum = tokens.find(
      (t) => t.address === STK_WALLET_ADDRESS && t.chainId === 1n
    )
    await transferController.update({ selectedToken: xwalletOnEthereum })

    expect(transferController.selectedToken?.address).toBe(STK_WALLET_ADDRESS)
    expect(transferController.selectedToken?.chainId).toBe(1n)
  })

  test('should set amount', async () => {
    const { transferController } = await prepareTest()

    await transferController.update({
      amount: '1'
    })
    expect(transferController.amount).toBe('1')
  })
  test('should set validation form messages', async () => {
    const { transferController, tokens } = await prepareTest()

    const xwalletOnEthereum = tokens.find(
      (t) => t.address === STK_WALLET_ADDRESS && t.chainId === 1n
    )

    await transferController.update({
      amount: '1',
      selectedToken: xwalletOnEthereum,
      addressState: {
        fieldValue: PLACEHOLDER_RECIPIENT,
        ensAddress: '',
        isDomainResolving: false
      }
    })

    expect(transferController.validationFormMsgs.amount.severity).toBe('success')
    expect(transferController.validationFormMsgs.recipientAddress.severity).toBe('warning')

    // Recipient address
    await transferController.update({
      isRecipientAddressUnknownAgreed: true
    })
    expect(transferController.validationFormMsgs.recipientAddress.severity).toBe('warning')
    // Amount
    await transferController.update({
      amount: '0'
    })

    expect(transferController.validationFormMsgs.amount.severity).toBe('error')

    await transferController.update({
      amount: transferController.maxAmount
    })
    await transferController.update({
      amount: String(Number(transferController.amount) + 1)
    })

    expect(transferController.validationFormMsgs.amount.severity).toBe('error')

    // Reset
    await transferController.update({
      amount: transferController.maxAmount
    })
  })
  test("should reject a token that doesn't have amount or amountPostSimulation for transfer", async () => {
    const { transferController, tokens } = await prepareTest()

    const zeroAmountToken = tokens.find(
      (t) => t.address === '0x1559FA1b8F28238FD5D76D9f434ad86FD20D1559' && t.chainId === 1n
    )
    await transferController.update({ selectedToken: zeroAmountToken })
    expect(transferController.selectedToken?.address).not.toBe(zeroAmountToken?.address)
  })
  test("should accept a token that doesn't have amount but has amountPostSimulation for transfer", async () => {
    const { transferController } = await prepareTest()

    const tokens = getTokens()
    const nativeToken = tokens.find(
      (t) => t.address === '0x0000000000000000000000000000000000000000' && t.chainId === 1n
    )
    nativeToken!.amountPostSimulation = 10n
    await transferController.update({ selectedToken: nativeToken })
    expect(transferController.selectedToken).not.toBe(null)
  })

  test('should detect that the recipient is the fee collector', async () => {
    const { transferController } = await prepareTest()

    await transferController.update({
      addressState: {
        fieldValue: FEE_COLLECTOR,
        ensAddress: '',
        isDomainResolving: false
      }
    })
    expect(transferController.isRecipientHumanizerKnownTokenOrSmartContract).toBeFalsy()
    expect(transferController.isRecipientAddressUnknown).toBeFalsy()
  })

  test('should reset form', async () => {
    const { transferController } = await prepareTest()

    transferController.resetForm()

    expect(transferController.amount).toBe('')
    expect(transferController.recipientAddress).toBe('')
    expect(transferController.selectedToken).toBeNull()
    expect(transferController.isRecipientAddressUnknown).toBe(false)
    expect(transferController.addressState).toEqual({
      fieldValue: '',
      ensAddress: '',
      isDomainResolving: false
    })
    expect(transferController.isRecipientAddressUnknownAgreed).toBe(false)
    expect(transferController.isRecipientHumanizerKnownTokenOrSmartContract).toBe(false)
  })

  test('should toJSON()', async () => {
    const { transferController } = await prepareTest()

    const json = transferController.toJSON()
    expect(json).toBeDefined()
  })
})

const ETHEREUM_TOKENS: TokenResult[] = [
  {
    amount: 15896695133407326n,
    chainId: 1n,
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
    address: '0x0000000000000000000000000000000000000000',
    flags: {
      onGasTank: false,
      rewardsType: null,
      canTopUpGasTank: true,
      isFeeToken: true,
      isHidden: false,
      suspectedType: null
    },
    priceIn: [{ baseCurrency: 'usd', price: 2694.55 }]
  },
  {
    amount: 0n,
    chainId: 1n,
    decimals: 18,
    name: 'EDEN',
    symbol: 'EDEN',
    address: '0x1559FA1b8F28238FD5D76D9f434ad86FD20D1559',
    flags: {
      onGasTank: false,
      rewardsType: null,
      canTopUpGasTank: false,
      isFeeToken: false,
      isHidden: false,
      suspectedType: null
    },
    priceIn: [{ baseCurrency: 'usd', price: 0.01605456 }]
  },
  {
    amount: 0n,
    chainId: 1n,
    decimals: 18,
    name: 'Ambire Wallet Staking Token',
    symbol: 'xWALLET',
    address: '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935',
    flags: {
      onGasTank: false,
      rewardsType: null,
      canTopUpGasTank: false,
      isFeeToken: false,
      isHidden: false,
      suspectedType: null
    },
    priceIn: [{ baseCurrency: 'usd', price: 0.32798689176900603 }]
  },
  {
    amount: 58316260607759458104900n,
    chainId: 1n,
    decimals: 18,
    name: 'Staked $WALLET',
    symbol: 'stkWALLET',
    address: '0xE575cC6EC0B5d176127ac61aD2D3d9d19d1aa4a0',
    flags: {
      onGasTank: false,
      rewardsType: null,
      canTopUpGasTank: false,
      isFeeToken: false,
      isHidden: false,
      suspectedType: null
    },
    priceIn: [{ baseCurrency: 'usd', price: 0.01565007 }]
  }
]

const POLYGON_TOKENS: TokenResult[] = [
  {
    amount: 347660472650276574649n,
    chainId: 137n,
    decimals: 18,
    name: 'Polygon',
    symbol: 'POL',
    address: '0x0000000000000000000000000000000000000000',
    flags: {
      onGasTank: false,
      rewardsType: null,
      canTopUpGasTank: true,
      isFeeToken: true,
      isHidden: false,
      suspectedType: null
    },
    priceIn: [{ baseCurrency: 'usd', price: 0.177387 }]
  }
]
