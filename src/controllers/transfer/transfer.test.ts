import { formatUnits, JsonRpcProvider } from 'ethers'
import fetch from 'node-fetch'

import { expect } from '@jest/globals'

import humanizerInfo from '../../consts/ambireConstantsHumanizerInfo.json'
import { networks } from '../../consts/networks'
import { Portfolio } from '../../libs/portfolio'
import { initRpcProviders } from '../../services/provider'
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

const addUserRequestMock = jest.fn()

describe('Transfer Controller', () => {
  test('should initialize', async () => {
    const ethAccPortfolio = await ethPortfolio.get(PLACEHOLDER_SELECTED_ACCOUNT)
    const polygonAccPortfolio = await polygonPortfolio.get(PLACEHOLDER_SELECTED_ACCOUNT)
    const tokens = [...ethAccPortfolio.tokens, ...polygonAccPortfolio.tokens]
    transferController = new TransferController()
    await transferController.update({
      selectedAccount: PLACEHOLDER_SELECTED_ACCOUNT,
      tokens,
      humanizerInfo: humanizerInfo as any
    })
    expect(transferController.isInitialized).toBe(true)
  })
  test('should set recipient address', () => {
    transferController.update({
      recipientAddress: PLACEHOLDER_RECIPIENT
    })
    expect(transferController.recipientAddress).toBe(PLACEHOLDER_RECIPIENT)
  })
  test('should resolve ENS', async () => {
    transferController.update({
      recipientAddress: 'elmoto.eth'
    })
    await transferController.onRecipientAddressChange()

    expect(transferController.recipientEnsAddress).toBe(PLACEHOLDER_RECIPIENT)
  })
  test('should set recipient address unknown', () => {
    expect(transferController.isRecipientAddressUnknown).toBe(true)
  })
  test('should flag recipient address as a smart contract', async () => {
    transferController.update({
      recipientAddress: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d'
    })
    transferController.onRecipientAddressChange()
    expect(transferController.isRecipientSmartContract).toBe(true)
  })
  test('should resolve UnstoppableDomains', async () => {
    transferController.update({
      recipientAddress: '0xyakmotoru.wallet'
    })
    await transferController.onRecipientAddressChange()

    expect(transferController.recipientUDAddress?.toLowerCase()).toBe(
      PLACEHOLDER_RECIPIENT_LOWERCASE
    )
  })
  test('should show SW warning', async () => {
    await transferController.handleTokenChange(`0x${'0'.repeat(40)}-polygon`)

    expect(transferController.isSWWarningVisible).toBe(true)
  })
  test('should change selected token', () => {
    transferController.handleTokenChange(`${XWALLET_ADDRESS}-ethereum`)
    expect(transferController.selectedToken?.address).toBe(XWALLET_ADDRESS)
    expect(transferController.selectedToken?.networkId).toBe('ethereum')
  })
  test('should set amount', () => {
    transferController.update({
      amount: '1'
    })
    expect(transferController.amount).toBe('1')
  })
  test('should set max amount', async () => {
    const selectedTokenMaxAmount = formatUnits(
      transferController.selectedToken?.amount || 0n,
      Number(transferController.selectedToken?.decimals)
    )

    transferController.update({
      setMaxAmount: true
    })

    expect(transferController.maxAmount).toBe(selectedTokenMaxAmount)
  })
  // @TODO: Validation tests
  test('should set validation form messages', async () => {
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
      setMaxAmount: true
    })
    transferController.update({
      amount: String(Number(transferController.amount) + 1)
    })

    expect(transferController.validationFormMsgs.amount.success).toBe(false)

    // Reset
    transferController.update({
      setMaxAmount: true
    })
  })
  test('should build user request with non-native token transfer', async () => {
    await transferController.addUserRequest({ addUserRequest: addUserRequestMock })

    const userRequest = addUserRequestMock.mock.calls[0][0]
    expect(userRequest?.accountAddr).toBe(PLACEHOLDER_SELECTED_ACCOUNT)
    expect(userRequest?.action.kind).toBe('call')

    // Fixes TS errors
    if (userRequest?.action.kind !== 'call') return

    // To be the selected token's address. @TODO: Is this correct?
    expect(userRequest?.action.to).toBe(XWALLET_ADDRESS)
    // Because we are not transferring the native token
    expect(userRequest?.action.value).toBe(0n)
  })
  test('should build user request with native token transfer', async () => {
    transferController.handleTokenChange(`0x${'0'.repeat(40)}-ethereum`)
    transferController.update({
      recipientAddress: PLACEHOLDER_RECIPIENT
    })
    transferController.update({
      amount: '1'
    })
    await transferController.addUserRequest({ addUserRequest: addUserRequestMock })
    const userRequest = addUserRequestMock.mock.calls[1][0]

    expect(userRequest?.accountAddr).toBe(PLACEHOLDER_SELECTED_ACCOUNT)
    expect(userRequest?.action.kind).toBe('call')

    // Fixes TS errors
    if (userRequest?.action.kind !== 'call') return

    expect(userRequest?.action.to.toLowerCase()).toBe(PLACEHOLDER_RECIPIENT_LOWERCASE)
    expect(userRequest?.action.value).toBe(1000000000000000000n)
  })
})
