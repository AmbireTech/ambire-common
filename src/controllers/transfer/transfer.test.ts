import { formatUnits, JsonRpcProvider } from 'ethers'
import fetch from 'node-fetch'

import { produceMemoryStore } from '../../../test/helpers'
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

const portfolio = new Portfolio(fetch, provider, ethereum)
const storage = produceMemoryStore()

let transferController: TransferController

describe('Transfer Controller', () => {
  test('should initialize', async () => {
    const accountPortfolio = await portfolio.get(PLACEHOLDER_SELECTED_ACCOUNT)
    transferController = new TransferController({ storage })
    await transferController.init({
      selectedAccount: PLACEHOLDER_SELECTED_ACCOUNT,
      tokens: accountPortfolio.tokens,
      humanizerInfo: humanizerInfo as any
    })
    expect(transferController).toBeDefined()
  })
  test('should set recipient address', () => {
    transferController.setRecipientAddress(PLACEHOLDER_RECIPIENT)
    expect(transferController.recipientAddress).toBe(PLACEHOLDER_RECIPIENT)
  })
  test('should resolve ENS', async () => {
    await transferController.setRecipientAddress('elmoto.eth')

    expect(transferController.recipientEnsAddress).toBe(PLACEHOLDER_RECIPIENT)
  })
  // @TODO: fix unstoppable domains
  test('should resolve UnstoppableDomains', async () => {
    await transferController.setRecipientAddress('0xyakmotoru.wallet')

    expect(transferController.recipientUDAddress).toBe(PLACEHOLDER_RECIPIENT_LOWERCASE)
  })
  // @TODO: recipient address validation tests: is it a contract, a SW restricted address, etc.
  test('should change selected asset', () => {
    transferController.handleChangeAsset(`${XWALLET_ADDRESS}-ethereum`)
    expect(transferController.selectedAsset?.address).toBe(XWALLET_ADDRESS)
    expect(transferController.selectedAsset?.networkId).toBe('ethereum')
  })
  test('should set amount', () => {
    transferController.setAmount('1')
    expect(transferController.amount).toBe('1')
  })
  test('should set max amount', async () => {
    const selectedAssetMaxAmount = formatUnits(
      transferController.selectedAsset?.amount || 0n,
      Number(transferController.selectedAsset?.decimals)
    )

    transferController.setMaxAmount()

    expect(transferController.maxAmount).toBe(selectedAssetMaxAmount)
  })
  test('should build user request with non-native asset transfer', async () => {
    await transferController.buildUserRequest()

    expect(transferController.userRequest?.accountAddr).toBe(PLACEHOLDER_SELECTED_ACCOUNT)
    expect(transferController.userRequest?.action.kind).toBe('call')

    // Fixes TS errors
    if (transferController.userRequest?.action.kind !== 'call') return

    // To be the selected asset's address. @TODO: Is this correct?
    expect(transferController.userRequest?.action.to).toBe(XWALLET_ADDRESS)
    // Because we are not transferring the native asset
    expect(transferController.userRequest?.action.value).toBe(0n)
  })
  test('should build user request with native asset transfer', async () => {
    transferController.handleChangeAsset(`0x${'0'.repeat(40)}-ethereum`)
    transferController.setAmount('1')
    await transferController.buildUserRequest()

    expect(transferController.userRequest?.accountAddr).toBe(PLACEHOLDER_SELECTED_ACCOUNT)
    expect(transferController.userRequest?.action.kind).toBe('call')

    // Fixes TS errors
    if (transferController.userRequest?.action.kind !== 'call') return

    expect(transferController.userRequest?.action.to).toBe(PLACEHOLDER_RECIPIENT_LOWERCASE)
    expect(transferController.userRequest?.action.value).toBe(1000000000000000000n)
  })
})
