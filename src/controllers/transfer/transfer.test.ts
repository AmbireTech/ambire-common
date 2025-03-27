import fetch from 'node-fetch'

import { expect } from '@jest/globals'

import { relayerUrl, velcroUrl } from '../../../test/config'
import { produceMemoryStore } from '../../../test/helpers'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { FEE_COLLECTOR } from '../../consts/addresses'
import humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { networks } from '../../consts/networks'
import { Account } from '../../interfaces/account'
import { HumanizerMeta } from '../../libs/humanizer/interfaces'
import { Portfolio } from '../../libs/portfolio'
import { getRpcProvider } from '../../services/provider'
import { Contacts } from '../addressBook/addressBook'
import { NetworksController } from '../networks/networks'
import { ProvidersController } from '../providers/providers'
import { StorageController } from '../storage/storage'
import { TransferController } from './transfer'

const ethereum = networks.find((x) => x.chainId === 1n)
const polygon = networks.find((x) => x.chainId === 137n)

if (!ethereum || !polygon) throw new Error('Failed to find ethereum in networks')

const provider = getRpcProvider(ethereum.rpcUrls, ethereum.chainId)
const polygonProvider = getRpcProvider(polygon.rpcUrls, polygon.chainId)
const PLACEHOLDER_RECIPIENT = '0xc4A6bB5139123bD6ba0CF387828a9A3a73EF8D1e'
const PLACEHOLDER_SELECTED_ACCOUNT: Account = {
  addr: '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337',
  associatedKeys: ['0xC2E6dFcc2C6722866aD65F211D5757e1D2879337'],
  creation: {
    factoryAddr: '0x00',
    bytecode: '0x000',
    salt: '0x000'
  },
  initialPrivileges: [['0x00', '0x01']],
  preferences: {
    label: DEFAULT_ACCOUNT_LABEL,
    pfp: '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337'
  }
}
const XWALLET_ADDRESS = '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935'

const CONTACTS: Contacts = []
const ethPortfolio = new Portfolio(fetch, provider, ethereum, velcroUrl)
const polygonPortfolio = new Portfolio(fetch, polygonProvider, polygon, velcroUrl)

let transferController: TransferController

const providers = Object.fromEntries(
  networks.map((network) => [network.chainId, getRpcProvider(network.rpcUrls, network.chainId)])
)

let providersCtrl: ProvidersController
const storage = produceMemoryStore()
const storageCtrl = new StorageController(storage)
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

const getTokens = async () => {
  const ethAccPortfolio = await ethPortfolio.get(PLACEHOLDER_SELECTED_ACCOUNT.addr)
  const polygonAccPortfolio = await polygonPortfolio.get(PLACEHOLDER_SELECTED_ACCOUNT.addr)

  return [...ethAccPortfolio.tokens, ...polygonAccPortfolio.tokens]
}

describe('Transfer Controller', () => {
  test('should initialize', async () => {
    transferController = new TransferController(
      produceMemoryStore(),
      humanizerInfo as HumanizerMeta,
      PLACEHOLDER_SELECTED_ACCOUNT,
      networksCtrl.networks
    )
    transferController.update({
      contacts: CONTACTS
    })
    expect(transferController.isInitialized).toBe(true)
  })
  test('should set address state', () => {
    transferController.update({
      addressState: {
        fieldValue: PLACEHOLDER_RECIPIENT,
        ensAddress: '',
        isDomainResolving: false
      }
    })
    expect(transferController.addressState.fieldValue).toBe(PLACEHOLDER_RECIPIENT)
  })
  test('should set recipient address unknown', () => {
    expect(transferController.isRecipientAddressUnknown).toBe(true)
  })
  test('should flag recipient address as a smart contract', async () => {
    transferController.update({
      addressState: {
        fieldValue: XWALLET_ADDRESS,
        ensAddress: '',
        isDomainResolving: false
      }
    })
    expect(transferController.isRecipientHumanizerKnownTokenOrSmartContract).toBe(true)
  })
  test('should show SW warning', async () => {
    const tokens = await getTokens()
    const polOnPolygon = tokens.find(
      (t) => t.address === '0x0000000000000000000000000000000000000000' && t.chainId === 137n
    )

    transferController.update({ selectedToken: polOnPolygon })
    expect(transferController.isSWWarningVisible).toBe(true)
  })
  test('should change selected token', async () => {
    const tokens = await getTokens()
    const xwalletOnEthereum = tokens.find((t) => t.address === XWALLET_ADDRESS && t.chainId === 1n)
    transferController.update({ selectedToken: xwalletOnEthereum })

    expect(transferController.selectedToken?.address).toBe(XWALLET_ADDRESS)
    expect(transferController.selectedToken?.chainId).toBe(1n)
  })

  test('should set amount', () => {
    transferController.update({
      amount: '1'
    })
    expect(transferController.amount).toBe('1')
  })
  test('should set sw warning agreed', () => {
    transferController.update({
      isSWWarningAgreed: true
    })
    expect(transferController.isSWWarningAgreed).toBe(true)
  })
  test('should set validation form messages', async () => {
    transferController.update({
      addressState: {
        fieldValue: PLACEHOLDER_RECIPIENT,
        ensAddress: '',
        isDomainResolving: false
      }
    })

    expect(transferController.validationFormMsgs.amount.success).toBe(true)
    expect(transferController.validationFormMsgs.recipientAddress.success).toBe(false)

    // Recipient address
    transferController.update({
      isRecipientAddressUnknownAgreed: true
    })
    expect(transferController.validationFormMsgs.recipientAddress.success).toBe(true)
    // Amount
    transferController.update({
      amount: '0'
    })

    expect(transferController.validationFormMsgs.amount.success).toBe(false)

    transferController.update({
      amount: transferController.maxAmount
    })
    transferController.update({
      amount: String(Number(transferController.amount) + 1)
    })

    expect(transferController.validationFormMsgs.amount.success).toBe(false)

    // Reset
    transferController.update({
      amount: transferController.maxAmount
    })
  })
  test("should reject a token that doesn't have amount or amountPostSimulation for transfer", async () => {
    const tokens = await getTokens()
    const zeroAmountToken = tokens.find(
      (t) => t.address === '0x8793Fb615Eb92822F482f88B3137B00aad4C00D2' && t.chainId === 1n
    )
    transferController.update({ selectedToken: zeroAmountToken })
    expect(transferController.selectedToken?.address).not.toBe(zeroAmountToken?.address)
  })
  test("should accept a token that doesn't have amount but has amountPostSimulation for transfer", async () => {
    const tokens = await getTokens()
    const nativeToken = tokens.find(
      (t) => t.address === '0x0000000000000000000000000000000000000000' && t.chainId === 1n
    )
    nativeToken!.amountPostSimulation = 10n
    transferController.update({ selectedToken: nativeToken })
    expect(transferController.selectedToken).not.toBe(null)
  })

  test('should detect that the recipient is the fee collector', async () => {
    transferController.update({
      addressState: {
        fieldValue: FEE_COLLECTOR,
        ensAddress: '',
        isDomainResolving: false
      }
    })
    expect(transferController.isRecipientHumanizerKnownTokenOrSmartContract).toBeFalsy()
    expect(transferController.isRecipientAddressUnknown).toBeFalsy()
  })

  const checkResetForm = () => {
    expect(transferController.amount).toBe('')
    expect(transferController.recipientAddress).toBe('')
    expect(transferController.selectedToken).toBeDefined()
    expect(transferController.isRecipientAddressUnknown).toBe(false)
    expect(transferController.addressState).toEqual({
      fieldValue: '',
      ensAddress: '',
      isDomainResolving: false
    })
    expect(transferController.isRecipientAddressUnknownAgreed).toBe(false)
    expect(transferController.isRecipientHumanizerKnownTokenOrSmartContract).toBe(false)
    expect(transferController.isSWWarningVisible).toBe(false)
    expect(transferController.isSWWarningAgreed).toBe(false)
  }

  test('should reset form', () => {
    transferController.resetForm()

    checkResetForm()
  })

  test('should toJSON()', () => {
    const json = transferController.toJSON()
    expect(json).toBeDefined()
  })
})
