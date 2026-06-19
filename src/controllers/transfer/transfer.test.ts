import { formatUnits, ZeroAddress } from 'ethers'

import { expect } from '@jest/globals'

import { makeMainController } from '../../../test/helpers/mainController'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { networks } from '../../consts/networks'
import { TokenResult } from '../../libs/portfolio'
import { TransferController } from './transfer'

const ethereum = networks.find((x) => x.chainId === 1n)
const polygon = networks.find((x) => x.chainId === 137n)

if (!ethereum || !polygon) throw new Error('Failed to find ethereum in networks')

const PLACEHOLDER_RECIPIENT = '0xc4A6bB5139123bD6ba0CF387828a9A3a73EF8D1e'

const XWALLET_ADDRESS = '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935'
const STK_WALLET_ADDRESS = '0xE575cC6EC0B5d176127ac61aD2D3d9d19d1aa4a0'

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

const getTokens = () => {
  return structuredClone(ETHEREUM_TOKENS.concat(POLYGON_TOKENS))
}

const prepareTest = async () => {
  const { mainCtrl } = await makeMainController(async (storageCtrl) => {
    await storageCtrl.set('accounts', [account])
    await storageCtrl.set('selectedAccount', account.addr)
  })
  await mainCtrl.selectedAccount.setAccount(account)
  mainCtrl.transfer.resetForm()

  return {
    transferController: mainCtrl.transfer,
    tokens: getTokens(),
    uiCtrl: mainCtrl.ui,
    selectedAccountCtrl: mainCtrl.selectedAccount
  }
}

describe('Transfer Controller', () => {
  test('should set address state', async () => {
    const { transferController } = await prepareTest()
    await transferController.update({
      addressState: {
        fieldValue: PLACEHOLDER_RECIPIENT,
        resolvedAddress: '',
        resolvedAddressType: null,
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
        resolvedAddress: '',
        resolvedAddressType: null,
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
        resolvedAddress: '',
        resolvedAddressType: null,
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
  test('should set max amount minus fee when the selected fee token matches the transfer token', async () => {
    const { transferController, tokens } = await prepareTest()

    const nativeToken = tokens.find((t) => t.address === ZeroAddress && t.chainId === 1n)!
    const feeAmount = 1_000_000_000_000_000n

    await transferController.update({
      selectedToken: nativeToken
    })
    ;(transferController as any).signAccountOpController = {
      accountOp: {
        gasFeePayment: {
          amount: feeAmount,
          inToken: nativeToken.address,
          feeTokenChainId: nativeToken.chainId
        }
      },
      selectedOption: {
        paidBy: account.addr,
        token: {
          ...nativeToken,
          flags: {
            ...nativeToken.flags,
            onGasTank: false
          }
        }
      }
    }

    await transferController.update({
      shouldSetMaxAmount: true
    })

    expect(transferController.amount).toBe(
      formatUnits(nativeToken.amount - feeAmount - feeAmount / 5n, nativeToken.decimals)
    )
  })
  test('should preserve the amount when the fee leaves no transferable max amount', async () => {
    const { transferController, tokens } = await prepareTest()

    const nativeToken = tokens.find((t) => t.address === ZeroAddress && t.chainId === 1n)!
    const initialAmount = '0.001'

    await transferController.update({
      selectedToken: nativeToken,
      amount: initialAmount
    })
    ;(transferController as any).signAccountOpController = {
      accountOp: {
        gasFeePayment: {
          amount: nativeToken.amount,
          inToken: nativeToken.address,
          feeTokenChainId: nativeToken.chainId
        }
      },
      selectedOption: {
        paidBy: account.addr,
        token: {
          ...nativeToken,
          flags: {
            ...nativeToken.flags,
            onGasTank: false
          }
        }
      }
    }

    await transferController.update({
      shouldSetMaxAmount: true
    })

    expect(transferController.amount).toBe(initialAmount)
    expect(transferController.amountAdjustmentWarning).toBeNull()
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
        resolvedAddress: '',
        resolvedAddressType: null,
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
        resolvedAddress: '',
        resolvedAddressType: null,
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
      resolvedAddress: '',
      resolvedAddressType: null,
      isDomainResolving: false
    })
    expect(transferController.isRecipientAddressUnknownAgreed).toBe(false)
    expect(transferController.isRecipientHumanizerKnownTokenOrSmartContract).toBe(false)
  })

  test('should toJSON()', async () => {
    const { transferController } = await prepareTest()

    expect(transferController.toJSON()).toMatchSnapshot()
  })
})

describe('Transfer Controller defaults logic', () => {
  const getDefaultPortfolioState = () => {
    return {
      tokens: getTokens(),
      isReadyToVisualize: true,
      isAllReady: true
    }
  }

  test('should initialize defaults and transfer session on updateView to transfer', async () => {
    const { transferController, uiCtrl, selectedAccountCtrl } = await prepareTest()

    selectedAccountCtrl.portfolio = {
      ...selectedAccountCtrl.portfolio,
      ...getDefaultPortfolioState()
    }

    uiCtrl.addView({
      id: 'popup',
      type: 'popup',
      currentRoute: 'dashboard',
      isReady: false,
      searchParams: {}
    })

    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: {}
    })

    expect(transferController.transferSessionId).not.toBe(null)
    expect(transferController.areDefaultsSet).toBe(true)
    expect(transferController.selectedToken).not.toBe(null)
    expect(transferController.isTopUp).toBe(false)
  })

  test('should keep existing form when re-entering same mode with persisted state and no search params', async () => {
    const { transferController, uiCtrl, selectedAccountCtrl } = await prepareTest()

    selectedAccountCtrl.portfolio = {
      ...selectedAccountCtrl.portfolio,
      ...getDefaultPortfolioState()
    }

    uiCtrl.addView({
      id: 'popup',
      type: 'popup',
      currentRoute: 'dashboard',
      isReady: false,
      searchParams: {}
    })
    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: {}
    })

    await transferController.update({
      amount: '1',
      addressState: {
        fieldValue: PLACEHOLDER_RECIPIENT,
        resolvedAddress: '',
        resolvedAddressType: null,
        isDomainResolving: false
      }
    })

    const initialSessionId = transferController.transferSessionId
    const initialAmount = transferController.amount
    const initialRecipient = transferController.recipientAddress

    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: false,
      searchParams: {}
    })

    expect(transferController.transferSessionId).toBe(initialSessionId)
    expect(transferController.amount).toBe(initialAmount)
    expect(transferController.recipientAddress).toBe(initialRecipient)
  })

  test('should reinitialize defaults when transfer route has token search params', async () => {
    const { transferController, uiCtrl, selectedAccountCtrl } = await prepareTest()

    selectedAccountCtrl.portfolio = {
      ...selectedAccountCtrl.portfolio,
      ...getDefaultPortfolioState()
    }

    uiCtrl.addView({
      id: 'popup',
      type: 'popup',
      currentRoute: 'dashboard',
      isReady: false,
      searchParams: {}
    })
    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: {}
    })

    await transferController.update({
      selectedToken: getTokens().find((t) => t.address === STK_WALLET_ADDRESS && t.chainId === 1n),
      amount: '2'
    })

    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: {
        address: ZeroAddress,
        chainId: '1'
      }
    })

    expect(transferController.selectedToken?.address).toBe(ZeroAddress)
    expect(transferController.selectedToken?.chainId).toBe(1n)
    expect(transferController.amount).toBe('')
  })

  test('should unload transfer state on navigate-out via updateView when there is no other transfer view', async () => {
    const { transferController, uiCtrl, selectedAccountCtrl } = await prepareTest()

    selectedAccountCtrl.portfolio = {
      ...selectedAccountCtrl.portfolio,
      ...getDefaultPortfolioState()
    }

    uiCtrl.addView({
      id: 'popup',
      type: 'popup',
      currentRoute: 'dashboard',
      isReady: false,
      searchParams: {}
    })
    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: {}
    })

    await transferController.update({
      amount: '1',
      addressState: {
        fieldValue: PLACEHOLDER_RECIPIENT,
        resolvedAddress: '',
        resolvedAddressType: null,
        isDomainResolving: false
      }
    })

    uiCtrl.updateView('popup', {
      currentRoute: 'dashboard',
      isReady: true,
      searchParams: {}
    })

    expect(transferController.transferSessionId).toBe(null)
    expect(transferController.areDefaultsSet).toBe(false)
    expect(transferController.selectedToken).toBeNull()
    expect(transferController.amount).toBe('')
  })

  test('should preserve popup form state on removeView when form is persisted', async () => {
    const { transferController, uiCtrl, selectedAccountCtrl } = await prepareTest()

    selectedAccountCtrl.portfolio = {
      ...selectedAccountCtrl.portfolio,
      ...getDefaultPortfolioState()
    }

    uiCtrl.addView({
      id: 'popup',
      type: 'popup',
      currentRoute: 'dashboard',
      isReady: false,
      searchParams: {}
    })
    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: {}
    })

    await transferController.update({
      amount: '1',
      addressState: {
        fieldValue: PLACEHOLDER_RECIPIENT,
        resolvedAddress: '',
        resolvedAddressType: null,
        isDomainResolving: false
      }
    })

    uiCtrl.removeView('popup')

    expect(transferController.transferSessionId).toBe(null)
    expect(transferController.amount).toBe('1')
    expect(transferController.recipientAddress).toBe(PLACEHOLDER_RECIPIENT)
    expect(transferController.areDefaultsSet).toBe(true)
  })

  test('should reset transfer state on popup removeView when form is not persisted', async () => {
    const { transferController, uiCtrl, selectedAccountCtrl } = await prepareTest()

    selectedAccountCtrl.portfolio = {
      ...selectedAccountCtrl.portfolio,
      ...getDefaultPortfolioState()
    }

    uiCtrl.addView({
      id: 'popup',
      type: 'popup',
      currentRoute: 'dashboard',
      isReady: false,
      searchParams: {}
    })
    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: {}
    })

    expect(transferController.selectedToken).not.toBeNull()

    uiCtrl.removeView('popup')

    expect(transferController.transferSessionId).toBe(null)
    expect(transferController.areDefaultsSet).toBe(false)
    expect(transferController.selectedToken).toBeNull()
  })

  test('should not unload on removeView when another transfer view is open', async () => {
    const { transferController, uiCtrl, selectedAccountCtrl } = await prepareTest()

    selectedAccountCtrl.portfolio = {
      ...selectedAccountCtrl.portfolio,
      ...getDefaultPortfolioState()
    }

    uiCtrl.addView({
      id: 'transfer-tab-1',
      type: 'tab',
      currentRoute: 'dashboard',
      isReady: false,
      searchParams: {}
    })
    uiCtrl.addView({
      id: 'transfer-tab-2',
      type: 'tab',
      currentRoute: 'transfer',
      isReady: true,
      searchParams: {}
    })

    uiCtrl.updateView('transfer-tab-1', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: {}
    })

    await transferController.update({
      amount: '1',
      addressState: {
        fieldValue: PLACEHOLDER_RECIPIENT,
        resolvedAddress: '',
        resolvedAddressType: null,
        isDomainResolving: false
      }
    })

    const activeSessionId = transferController.transferSessionId
    uiCtrl.removeView('transfer-tab-1')

    expect(transferController.transferSessionId).toBe(activeSessionId)
    expect(transferController.amount).toBe('1')
    expect(transferController.recipientAddress).toBe(PLACEHOLDER_RECIPIENT)
  })

  test('should ignore selectedAccount updates when transfer session is not active', async () => {
    const { transferController, selectedAccountCtrl } = await prepareTest()

    selectedAccountCtrl.portfolio = {
      ...selectedAccountCtrl.portfolio,
      ...getDefaultPortfolioState()
    }

    await selectedAccountCtrl.forceEmitUpdate()

    expect(transferController.transferSessionId).toBe(null)
    expect(transferController.selectedToken).toBeNull()
    expect(transferController.areDefaultsSet).toBe(false)
  })

  test('should set default token on selectedAccount force update when transfer session is active', async () => {
    const { transferController, uiCtrl, selectedAccountCtrl } = await prepareTest()

    uiCtrl.addView({
      id: 'popup',
      type: 'popup',
      currentRoute: 'dashboard',
      isReady: false,
      searchParams: {}
    })
    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: {}
    })

    transferController.selectedToken = null
    transferController.areDefaultsSet = false

    selectedAccountCtrl.portfolio = {
      ...selectedAccountCtrl.portfolio,
      ...getDefaultPortfolioState()
    }

    await selectedAccountCtrl.forceEmitUpdate()

    expect(transferController.transferSessionId).not.toBe(null)
    expect(transferController.selectedToken).not.toBeNull()
    expect(transferController.areDefaultsSet).toBe(true)
  })

  test('should not update defaults on selectedAccount force update when user has proceeded', async () => {
    const { transferController, uiCtrl, selectedAccountCtrl } = await prepareTest()

    uiCtrl.addView({
      id: 'popup',
      type: 'popup',
      currentRoute: 'dashboard',
      isReady: false,
      searchParams: {}
    })
    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: {}
    })

    transferController.selectedToken = null
    transferController.areDefaultsSet = false
    transferController.setUserProceeded(true)

    selectedAccountCtrl.portfolio = {
      ...selectedAccountCtrl.portfolio,
      ...getDefaultPortfolioState()
    }

    await selectedAccountCtrl.forceEmitUpdate()

    expect(transferController.selectedToken).toBeNull()
    expect(transferController.areDefaultsSet).toBe(false)
  })

  test('should not set default token when portfolio is not ready to visualize', async () => {
    const { transferController, uiCtrl, selectedAccountCtrl } = await prepareTest()

    uiCtrl.addView({
      id: 'popup',
      type: 'popup',
      currentRoute: 'dashboard',
      isReady: false,
      searchParams: {}
    })
    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: {}
    })

    transferController.selectedToken = null
    transferController.areDefaultsSet = false

    selectedAccountCtrl.portfolio = {
      ...selectedAccountCtrl.portfolio,
      tokens: getTokens(),
      isReadyToVisualize: false,
      isAllReady: true
    }

    await selectedAccountCtrl.forceEmitUpdate()

    expect(transferController.selectedToken).toBeNull()
    expect(transferController.areDefaultsSet).toBe(false)
  })

  test('should set areDefaultsSet when portfolio isAllReady but no tokens are available', async () => {
    const { transferController, uiCtrl, selectedAccountCtrl } = await prepareTest()

    uiCtrl.addView({
      id: 'popup',
      type: 'popup',
      currentRoute: 'dashboard',
      isReady: false,
      searchParams: {}
    })
    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: {}
    })

    transferController.selectedToken = null
    transferController.areDefaultsSet = false

    selectedAccountCtrl.portfolio = {
      ...selectedAccountCtrl.portfolio,
      tokens: [],
      isReadyToVisualize: true,
      isAllReady: true
    }

    await selectedAccountCtrl.forceEmitUpdate()

    expect(transferController.selectedToken).toBeNull()
    expect(transferController.areDefaultsSet).toBe(true)
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
    priceIn: [{ baseCurrency: 'usd', price: 2694.55 }],
    marketDataIn: []
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
    priceIn: [{ baseCurrency: 'usd', price: 0.01605456 }],
    marketDataIn: []
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
    priceIn: [{ baseCurrency: 'usd', price: 0.32798689176900603 }],
    marketDataIn: []
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
    priceIn: [{ baseCurrency: 'usd', price: 0.01565007 }],
    marketDataIn: []
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
    priceIn: [{ baseCurrency: 'usd', price: 0.177387 }],
    marketDataIn: []
  }
]
