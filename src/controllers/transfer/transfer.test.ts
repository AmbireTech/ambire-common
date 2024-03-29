import { JsonRpcProvider } from 'ethers'
import fetch from 'node-fetch'

import { expect } from '@jest/globals'

import { produceMemoryStore } from '../../../test/helpers'
import { FEE_COLLECTOR } from '../../consts/addresses'
import humanizerInfo from '../../consts/humanizer/humanizerInfo.json'
import { networks } from '../../consts/networks'
import { HumanizerMeta } from '../../libs/humanizer/interfaces'
import { Portfolio } from '../../libs/portfolio'
import { initRpcProviders } from '../../services/provider'
import { SettingsController } from '../settings/settings'
import { TransferController } from './transfer'

const ethereum = networks.find((x) => x.id === 'ethereum')
const polygon = networks.find((x) => x.id === 'polygon')

if (!ethereum || !polygon) throw new Error('Failed to find ethereum in networks')

const provider = new JsonRpcProvider(ethereum.rpcUrl)
const polygonProvider = new JsonRpcProvider(polygon.rpcUrl)
// Required for ENS resolution
initRpcProviders({
  [ethereum.id]: provider,
  [polygon.id]: polygonProvider
})

const PLACEHOLDER_RECIPIENT = '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337'
const PLACEHOLDER_RECIPIENT_LOWERCASE = PLACEHOLDER_RECIPIENT.toLowerCase()
const PLACEHOLDER_SELECTED_ACCOUNT = '0xc4A6bB5139123bD6ba0CF387828a9A3a73EF8D1e'
const XWALLET_ADDRESS = '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935'

const ethPortfolio = new Portfolio(fetch, provider, ethereum)
const polygonPortfolio = new Portfolio(fetch, polygonProvider, polygon)

let transferController: TransferController
let errorCount = 0
const settingsController = new SettingsController(produceMemoryStore())

const getTokens = async () => {
  const ethAccPortfolio = await ethPortfolio.get(PLACEHOLDER_SELECTED_ACCOUNT)
  const polygonAccPortfolio = await polygonPortfolio.get(PLACEHOLDER_SELECTED_ACCOUNT)

  return [...ethAccPortfolio.tokens, ...polygonAccPortfolio.tokens]
}

describe('Transfer Controller', () => {
  test('should emit not initialized error', () => {
    transferController = new TransferController(settingsController)

    transferController.buildUserRequest()
    errorCount++

    expect(transferController.emittedErrors.length).toBe(errorCount)
  })
  test("shouldn't build userRequest when tokens.length === 0", () => {
    transferController.update({
      selectedAccount: PLACEHOLDER_SELECTED_ACCOUNT,
      tokens: [],
      humanizerInfo: humanizerInfo as HumanizerMeta
    })

    transferController.buildUserRequest()

    expect(transferController.userRequest).toBe(null)
  })
  test('should initialize', async () => {
    const tokens = await getTokens()
    transferController = new TransferController(settingsController)
    await transferController.update({
      selectedAccount: PLACEHOLDER_SELECTED_ACCOUNT,
      tokens,
      humanizerInfo: humanizerInfo as HumanizerMeta
    })
    expect(transferController.isInitialized).toBe(true)
  })
  test('should set address state', () => {
    transferController.update({
      addressState: {
        fieldValue: PLACEHOLDER_RECIPIENT,
        ensAddress: '',
        udAddress: '',
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
        udAddress: '',
        isDomainResolving: false
      }
    })
    expect(transferController.isRecipientHumanizerKnownTokenOrSmartContract).toBe(true)
  })
  test('should show SW warning', async () => {
    const tokens = await getTokens()
    const maticOnPolygon = tokens.find(
      (t) => t.address === '0x0000000000000000000000000000000000000000' && t.networkId === 'polygon'
    )

    transferController.update({ selectedToken: maticOnPolygon })
    expect(transferController.isSWWarningVisible).toBe(true)
  })
  test('should change selected token', async () => {
    const tokens = await getTokens()
    const xwalletOnEthereum = tokens.find(
      (t) => t.address === XWALLET_ADDRESS && t.networkId === 'ethereum'
    )
    transferController.update({ selectedToken: xwalletOnEthereum })

    expect(transferController.selectedToken?.address).toBe(XWALLET_ADDRESS)
    expect(transferController.selectedToken?.networkId).toBe('ethereum')
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
        udAddress: '',
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
  test('should build user request with non-native token transfer', async () => {
    await transferController.buildUserRequest()

    expect(transferController.userRequest?.accountAddr).toBe(PLACEHOLDER_SELECTED_ACCOUNT)
    expect(transferController.userRequest?.action.kind).toBe('call')

    // Fixes TS errors
    if (transferController.userRequest?.action.kind !== 'call') return

    // To be the selected token's address. @TODO: Is this correct?
    expect(transferController.userRequest?.action.to).toBe(XWALLET_ADDRESS)
    // Because we are not transferring the native token
    expect(transferController.userRequest?.action.value).toBe(0n)
  })
  test('should build user request with native token transfer', async () => {
    const tokens = await getTokens()
    const nativeToken = tokens.find(
      (t) =>
        t.address === '0x0000000000000000000000000000000000000000' && t.networkId === 'ethereum'
    )

    transferController.update({ selectedToken: nativeToken })
    transferController.update({
      amount: '1'
    })
    await transferController.buildUserRequest()

    expect(transferController.userRequest?.accountAddr).toBe(PLACEHOLDER_SELECTED_ACCOUNT)
    expect(transferController.userRequest?.action.kind).toBe('call')

    // Fixes TS errors
    if (transferController.userRequest?.action.kind !== 'call') return

    expect(transferController.userRequest?.action.to.toLowerCase()).toBe(
      PLACEHOLDER_RECIPIENT_LOWERCASE
    )
    expect(transferController.userRequest?.action.value).toBe(1000000000000000000n)
  })

  test('should detect that the recipient is the fee collector', async () => {
    transferController.update({
      addressState: {
        fieldValue: FEE_COLLECTOR,
        ensAddress: '',
        udAddress: '',
        isDomainResolving: false
      }
    })
    expect(transferController.isRecipientHumanizerKnownTokenOrSmartContract).toBeFalsy()
    expect(transferController.isRecipientAddressUnknown).toBeFalsy()
  })

  const checkResetForm = () => {
    expect(transferController.amount).toBe('')
    expect(transferController.maxAmount).toBe('0')
    expect(transferController.recipientAddress).toBe('')
    expect(transferController.selectedToken).toBe(null)
    expect(transferController.isRecipientAddressUnknown).toBe(false)
    expect(transferController.addressState).toEqual({
      fieldValue: '',
      ensAddress: '',
      udAddress: '',
      isDomainResolving: false
    })
    expect(transferController.userRequest).toBe(null)
    expect(transferController.isRecipientAddressUnknownAgreed).toBe(false)
    expect(transferController.isRecipientHumanizerKnownTokenOrSmartContract).toBe(false)
    expect(transferController.isSWWarningVisible).toBe(false)
    expect(transferController.isSWWarningAgreed).toBe(false)
  }

  test('should reset form', () => {
    transferController.resetForm()

    checkResetForm()
  })

  test('should reset all state', () => {
    transferController.reset()

    checkResetForm()
    expect(transferController.tokens.length).toBe(0)
  })

  test('should toJSON()', () => {
    const json = transferController.toJSON()
    expect(json).toBeDefined()
  })
})
