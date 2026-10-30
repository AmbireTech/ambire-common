import { formatUnits, getAddress, Interface, ZeroAddress } from 'ethers'

import { expect, jest } from '@jest/globals'

import { makeMainController } from '../../../test/helpers/mainController'
import EmittableError from '../../classes/EmittableError'
import { DEFAULT_ACCOUNT_LABEL } from '../../consts/account'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { networks } from '../../consts/networks'
import { CollectionResult, TokenResult } from '../../libs/portfolio'
import * as ensDomainsModule from '../../services/ensDomains/ensDomains'
import {
  safeTokenAmountAndNumberMultiplication,
  truncateFiatAmountDecimals
} from '../../utils/numbers/formatters'
import { DomainsController } from '../domains/domains'

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

// An account of the wallet that no key in the keystore can sign for (view-only), used as a recipient
const VIEW_ONLY_RECIPIENT_ADDRESS = '0x5Be214147EA1AE3653f289E17fE7Dc17A73AD175'
const viewOnlyRecipientAccount = {
  addr: VIEW_ONLY_RECIPIENT_ADDRESS,
  initialPrivileges: [],
  associatedKeys: [VIEW_ONLY_RECIPIENT_ADDRESS],
  creation: null,
  preferences: {
    label: 'View-only recipient',
    pfp: VIEW_ONLY_RECIPIENT_ADDRESS
  }
}

const prepareTest = async (extraAccounts: (typeof viewOnlyRecipientAccount)[] = []) => {
  const { mainCtrl } = await makeMainController(async (storageCtrl) => {
    await storageCtrl.set('accounts', [account, ...extraAccounts])
    await storageCtrl.set('selectedAccount', account.addr)
  })
  await mainCtrl.selectedAccount.select({ account })
  mainCtrl.transfer.resetForm()

  return {
    mainCtrl,
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
  test('should clear the fiat amount when the amount is cleared to zero', async () => {
    const { transferController, tokens } = await prepareTest()

    const ethOnEthereum = tokens.find((t) => t.address === ZeroAddress && t.chainId === 1n)
    await transferController.update({ selectedToken: ethOnEthereum })

    await transferController.update({ amount: '1' })
    expect(Number(transferController.amountInFiat)).toBeGreaterThan(0)

    await transferController.update({ amount: '0' })
    expect(Number(transferController.amountInFiat)).toBe(0)
  })
  test('should not carry an amount error over to a form without a selected token', async () => {
    const { transferController, tokens } = await prepareTest()

    const ethOnEthereum = tokens.find((t) => t.address === ZeroAddress && t.chainId === 1n)!
    await transferController.update({ selectedToken: ethOnEthereum, amount: '1000000' })
    expect(transferController.validationFormMsgs.amount.message).toBe('Insufficient amount.')

    transferController.selectedToken = null
    expect(transferController.validationFormMsgs.amount.message).toBe('')
  })
  test('should keep fiat mode when setting the max amount', async () => {
    const { transferController, tokens } = await prepareTest()

    const ethOnEthereum = tokens.find((t) => t.address === ZeroAddress && t.chainId === 1n)!
    await transferController.update({ selectedToken: ethOnEthereum, amountFieldMode: 'fiat' })
    await transferController.update({ shouldSetMaxAmount: true })

    expect(transferController.amountFieldMode).toBe('fiat')
    expect(transferController.amount).toBe(transferController.maxAmount)
  })
  test('should keep the fiat amount at a displayable precision when switching to fiat mode', async () => {
    const { transferController, tokens } = await prepareTest()

    const ethOnEthereum = tokens.find((t) => t.address === ZeroAddress && t.chainId === 1n)!
    await transferController.update({ selectedToken: ethOnEthereum })
    await transferController.update({ shouldSetMaxAmount: true })
    await transferController.update({ amountFieldMode: 'fiat' })

    expect(transferController.amountInFiat).toBe(
      truncateFiatAmountDecimals(
        safeTokenAmountAndNumberMultiplication(
          ethOnEthereum.amount,
          ethOnEthereum.decimals,
          ethOnEthereum.priceIn[0]!.price
        )
      )
    )
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
    expect(transferController.amountAdjustmentInfo).toEqual({
      feeAmount: formatUnits(feeAmount + feeAmount / 5n, nativeToken.decimals),
      tokenSymbol: nativeToken.symbol
    })

    await transferController.update({ amount: '0.001' })
    expect(transferController.amountAdjustmentInfo).toBeNull()
  })
  test('should not show fee adjustment info when another token pays the fee', async () => {
    const { transferController, tokens } = await prepareTest()

    const nativeToken = tokens.find((t) => t.address === ZeroAddress && t.chainId === 1n)!
    const feeToken = tokens.find((t) => t.address !== ZeroAddress && t.chainId === 1n)!

    await transferController.update({ selectedToken: nativeToken })
    ;(transferController as any).signAccountOpController = {
      accountOp: {
        gasFeePayment: {
          amount: 1_000_000_000_000_000n,
          inToken: feeToken.address,
          feeTokenChainId: feeToken.chainId
        }
      },
      selectedOption: {
        paidBy: account.addr,
        token: {
          ...feeToken,
          flags: {
            ...feeToken.flags,
            onGasTank: false
          }
        }
      }
    }

    await transferController.update({ shouldSetMaxAmount: true })

    expect(transferController.amount).toBe(transferController.maxAmount)
    expect(transferController.amountAdjustmentInfo).toBeNull()
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
  test('should require hold-to-proceed and explain it when the recipient is a view-only account', async () => {
    const { transferController } = await prepareTest([viewOnlyRecipientAccount])

    await transferController.update({
      addressState: {
        fieldValue: VIEW_ONLY_RECIPIENT_ADDRESS,
        resolvedAddress: '',
        resolvedAddressType: null,
        isDomainResolving: false
      }
    })

    const { recipientAddress } = transferController.validationFormMsgs
    expect(transferController.isRecipientAddressViewOnly).toBe(true)
    // A hold without a message was the bug: the user saw a green text next to a hold button
    expect(recipientAddress.shouldHold).toBe(true)
    expect(recipientAddress.severity).toBe('warning')
    expect(recipientAddress.message).toContain('view-only')
    expect(transferController.toJSON().validationFormMsgs.recipientAddress.shouldHold).toBe(true)
  })

  test('should keep the hold for a view-only recipient after the user agrees to send to an unknown address', async () => {
    const { transferController } = await prepareTest([viewOnlyRecipientAccount])

    await transferController.update({
      addressState: {
        fieldValue: VIEW_ONLY_RECIPIENT_ADDRESS,
        resolvedAddress: '',
        resolvedAddressType: null,
        isDomainResolving: false
      }
    })
    await transferController.update({ isRecipientAddressUnknownAgreed: true })

    expect(transferController.validationFormMsgs.recipientAddress.shouldHold).toBe(true)
  })

  test('should release the hold for an unknown recipient after the user agrees, without changing the message', async () => {
    const { transferController } = await prepareTest()

    await transferController.update({
      addressState: {
        fieldValue: PLACEHOLDER_RECIPIENT,
        resolvedAddress: '',
        resolvedAddressType: null,
        isDomainResolving: false
      }
    })

    const beforeAgreeing = { ...transferController.validationFormMsgs.recipientAddress }
    expect(transferController.isRecipientAddressViewOnly).toBe(false)
    expect(beforeAgreeing.shouldHold).toBe(true)

    await transferController.update({ isRecipientAddressUnknownAgreed: true })

    const afterAgreeing = transferController.validationFormMsgs.recipientAddress
    expect(afterAgreeing.shouldHold).toBeFalsy()
    expect(afterAgreeing.message).toBe(beforeAgreeing.message)
  })

  test('should not require a hold or block when the recipient is a smart contract', async () => {
    const { transferController } = await prepareTest()

    await transferController.update({
      addressState: {
        fieldValue: XWALLET_ADDRESS,
        resolvedAddress: '',
        resolvedAddressType: null,
        isDomainResolving: false
      }
    })

    const { recipientAddress } = transferController.validationFormMsgs
    // The error disables the buttons of the form, so there is nothing to hold
    expect(recipientAddress.severity).toBe('error')
    expect(recipientAddress.shouldHold).toBeFalsy()
  })

  test('should not require a hold when there is no recipient yet', async () => {
    const { transferController } = await prepareTest()

    expect(transferController.validationFormMsgs.recipientAddress.shouldHold).toBeFalsy()
  })

  test('should allow proceeding with a Colibri-verified ENS recipient', async () => {
    const { transferController, tokens } = await prepareTest()
    const domain = '0xbobby.eth'
    const resolvedAddress = getAddress('0x4ba5250000000000000000000000000003bc63d4')
    const provider = {} as any
    const verificationProvider = { destroyed: false } as any
    const domainsController = new DomainsController({
      providers: { ['1']: provider },
      verification: {
        getReadyProvider: jest.fn(() => verificationProvider)
      } as any,
      getNetwork: (chainId: bigint) => ({ chainId, disabled: false }) as any
    })
    const resolveENSDomainSpy = jest
      .spyOn(ensDomainsModule, 'resolveENSDomain')
      .mockResolvedValue({ address: resolvedAddress, avatar: null, expiry: null })

    try {
      await domainsController.resolveDomain({ domain })

      expect(domainsController.domainToAddresses[domain]?.address).toBe(resolvedAddress)
      expect(domainsController.verifiedDomainsStatus[domain]).toBe('VERIFIED')

      const nativeToken = tokens.find((t) => t.address === ZeroAddress && t.chainId === 1n)!
      await transferController.update({
        amount: '0.0001',
        selectedToken: nativeToken,
        addressState: {
          fieldValue: domain,
          resolvedAddress,
          resolvedAddressType: 'ens',
          isDomainResolving: false
        }
      })

      expect(transferController.recipientAddress).toBe(resolvedAddress)
      expect(transferController.validationFormMsgs.amount.severity).toBe('success')
      expect(transferController.isFormValid).toBe(true)
    } finally {
      resolveENSDomainSpy.mockRestore()
    }
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

    expect(transferController.toJSON()).toBeDefined()
  })
})

describe('Transfer Controller - Privacy Pools recipient', () => {
  const PRIVACY_POOLS_SEED_ID = 'privacy-pools-seed'
  const ETH_DEPOSIT_LIMITS = { minimumDepositAmount: 10n ** 16n }

  /** A transfer screen open on a portfolio with ETH on Ethereum and POL on Polygon. */
  const prepareOpenTransfer = async () => {
    const context = await prepareTest()
    const { mainCtrl, uiCtrl, selectedAccountCtrl } = context

    // The limits come from the chain, which the tests do not reach
    let depositAssetConfigs = {}
    jest
      .spyOn(mainCtrl.privacyPools, 'depositAssetConfigs', 'get')
      .mockImplementation(() => depositAssetConfigs)
    jest.spyOn(mainCtrl.privacyPools, 'loadDepositAssetConfig').mockImplementation(async () => {
      depositAssetConfigs = { [`1:${ZeroAddress}`]: ETH_DEPOSIT_LIMITS }
      return ETH_DEPOSIT_LIMITS
    })

    selectedAccountCtrl.portfolio = {
      ...selectedAccountCtrl.portfolio,
      tokens: getTokens(),
      isReadyToVisualize: true,
      isAllReady: true
    }
    uiCtrl.addView({
      id: 'popup',
      type: 'popup',
      currentRoute: 'dashboard',
      isReady: false,
      searchParams: {}
    })
    uiCtrl.updateView('popup', { currentRoute: 'transfer', isReady: true, searchParams: {} })

    return context
  }

  test('offers only the tokens a Privacy Pools account accepts', async () => {
    const { transferController } = await prepareOpenTransfer()
    expect(transferController.tokens.some(({ chainId }) => chainId === 137n)).toBe(true)

    await transferController.update({ privacyPoolsRecipient: PRIVACY_POOLS_SEED_ID })

    expect(
      transferController.tokens.map(({ chainId, address }) => `${chainId}:${address}`)
    ).toEqual([`1:${ZeroAddress}`])
    expect(transferController.selectedToken?.chainId).toBe(1n)
    expect(transferController.selectedToken?.address).toBe(ZeroAddress)
  })

  test('drops the typed address and every check that is about one', async () => {
    const { transferController } = await prepareOpenTransfer()
    // Already a token the account accepts, so picking the account does not change it
    await transferController.update({
      selectedToken: transferController.tokens.find(
        ({ chainId, address }) => chainId === 1n && address === ZeroAddress
      )
    })
    await transferController.update({
      addressState: {
        fieldValue: PLACEHOLDER_RECIPIENT,
        resolvedAddress: '',
        resolvedAddressType: null,
        isDomainResolving: false
      }
    })
    const programmaticUpdateCounterBefore = transferController.programmaticUpdateCounter

    await transferController.update({ privacyPoolsRecipient: PRIVACY_POOLS_SEED_ID })

    expect(transferController.addressState.fieldValue).toBe('')
    // So the field drops what was typed, instead of disagreeing with the controller
    expect(transferController.programmaticUpdateCounter).not.toBe(programmaticUpdateCounterBefore)
    expect(transferController.isRecipientAddressUnknown).toBe(false)
    expect(transferController.isRecipientAddressFirstTimeSend).toBe(false)
    expect(transferController.validationFormMsgs.recipientAddress.severity).toBe('success')
  })

  test('typing an address goes back to sending to an address', async () => {
    const { transferController } = await prepareOpenTransfer()
    await transferController.update({ privacyPoolsRecipient: PRIVACY_POOLS_SEED_ID })

    await transferController.update({
      addressState: {
        fieldValue: PLACEHOLDER_RECIPIENT,
        resolvedAddress: '',
        resolvedAddressType: null,
        isDomainResolving: false
      }
    })

    expect(transferController.privacyPoolsRecipient).toBeNull()
    expect(transferController.tokens.some(({ chainId }) => chainId === 137n)).toBe(true)
  })

  test('refuses an amount below what a Privacy Pools account accepts', async () => {
    const { transferController } = await prepareOpenTransfer()
    await transferController.update({ privacyPoolsRecipient: PRIVACY_POOLS_SEED_ID })

    await transferController.update({ amount: '0.005' })

    expect(transferController.validationFormMsgs.amount.severity).toBe('error')
    expect(transferController.validationFormMsgs.amount.message).toContain('at least 0.01 ETH')
    expect(transferController.isFormValid).toBe(false)
  })

  test('shows why the transfer cannot be prepared next to the form', async () => {
    const { mainCtrl, transferController } = await prepareOpenTransfer()
    const buildDepositCalls = jest
      .spyOn(mainCtrl.privacyPools, 'buildDepositCalls')
      .mockRejectedValue(
        new EmittableError({
          message: 'Your previous transfer to this Privacy Pools account is still being confirmed.',
          level: 'expected',
          error: new Error('pending deposit')
        })
      )
    await transferController.update({ privacyPoolsRecipient: PRIVACY_POOLS_SEED_ID })

    await transferController.update({ amount: '0.012' })

    expect(buildDepositCalls).toHaveBeenCalledWith({
      seedId: PRIVACY_POOLS_SEED_ID,
      accountAddr: account.addr,
      chainId: '1',
      tokenAddress: ZeroAddress,
      amount: 12n * 10n ** 15n
    })
    expect(transferController.privacyPoolsDepositError).toBe(
      'Your previous transfer to this Privacy Pools account is still being confirmed.'
    )
    expect(transferController.isPreparingPrivacyPoolsDeposit).toBe(false)
    expect(transferController.signAccountOpController).toBeNull()
  })

  test('resetting the form goes back to sending to an address', async () => {
    const { transferController } = await prepareOpenTransfer()
    await transferController.update({ privacyPoolsRecipient: PRIVACY_POOLS_SEED_ID })

    transferController.resetForm()

    expect(transferController.privacyPoolsRecipient).toBeNull()
    expect(transferController.hasPersistedState).toBe(false)
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

  test('should reset transfer state on side-panel removeView even when form is persisted', async () => {
    const { transferController, uiCtrl, selectedAccountCtrl } = await prepareTest()

    selectedAccountCtrl.portfolio = {
      ...selectedAccountCtrl.portfolio,
      ...getDefaultPortfolioState()
    }

    uiCtrl.addView({
      id: 'side-panel',
      type: 'side-panel',
      currentRoute: 'dashboard',
      isReady: false,
      searchParams: {}
    })
    uiCtrl.updateView('side-panel', {
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

    uiCtrl.removeView('side-panel')

    expect(transferController.transferSessionId).toBe(null)
    expect(transferController.areDefaultsSet).toBe(false)
    expect(transferController.selectedToken).toBeNull()
    expect(transferController.amount).toBe('')
    expect(transferController.recipientAddress).toBe('')
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

describe('Transfer Controller NFT mode', () => {
  const NFT_ADDRESS = '0x59468516a8259058baD1cA5F8f4BFF190d30E066'
  const NFT_TOKEN_ID = 42n
  const nftSearchParams = { address: NFT_ADDRESS, chainId: '1', tokenId: String(NFT_TOKEN_ID) }
  const erc721Interface = new Interface([
    'function safeTransferFrom(address from, address to, uint256 tokenId)'
  ])

  const getCollection = (overrides: Partial<CollectionResult> = {}): CollectionResult => ({
    address: NFT_ADDRESS,
    chainId: 1n,
    name: 'Test Collection',
    symbol: 'TEST',
    decimals: 1,
    amount: 1n,
    collectibles: [NFT_TOKEN_ID],
    flags: { isHidden: false },
    priceIn: [],
    marketDataIn: [],
    ...overrides
  })

  const recipientState = (fieldValue: string) => ({
    fieldValue,
    resolvedAddress: '',
    resolvedAddressType: null,
    isDomainResolving: false
  })

  // Lets the updates triggered by the controller's listeners finish
  const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

  const enterTransfer = async (
    searchParams: Record<string, string> = nftSearchParams,
    portfolioOverrides: Record<string, unknown> = {},
    route = 'transfer'
  ) => {
    const ctx = await prepareTest()
    // The real portfolio updates in the background and would replace the one set below
    jest
      .spyOn(ctx.selectedAccountCtrl, 'updateSelectedAccountPortfolio')
      .mockImplementation(() => {})
    ctx.selectedAccountCtrl.portfolio = {
      ...ctx.selectedAccountCtrl.portfolio,
      tokens: getTokens(),
      collections: [getCollection()],
      isReadyToVisualize: true,
      isAllReady: true,
      ...portfolioOverrides
    }
    ctx.uiCtrl.addView({
      id: 'popup',
      type: 'popup',
      currentRoute: 'dashboard',
      isReady: false,
      searchParams: {}
    })
    ctx.uiCtrl.updateView('popup', { currentRoute: route, isReady: true, searchParams })
    await flushPromises()

    return ctx
  }

  test('should enter NFT mode from the route search params', async () => {
    const { transferController } = await enterTransfer()

    expect(transferController.selectedNft).toEqual({
      address: NFT_ADDRESS,
      chainId: 1n,
      tokenId: NFT_TOKEN_ID,
      collectionName: 'Test Collection'
    })
    expect(transferController.selectedToken).toBeNull()
    expect(transferController.selectedChainId).toBe(1n)
    expect(transferController.areDefaultsSet).toBe(true)
    expect(transferController.validationFormMsgs.amount.severity).toBe('success')
  })

  test.each([
    ['a non-numeric token id', { ...nftSearchParams, tokenId: 'abc' }],
    ['a negative token id', { ...nftSearchParams, tokenId: '-1' }],
    ['an empty token id', { ...nftSearchParams, tokenId: '' }],
    ['an invalid collection address', { ...nftSearchParams, address: '0x123' }],
    ['an invalid chain id', { ...nftSearchParams, chainId: 'mainnet' }]
  ])('should stay in token mode for %s', async (_, searchParams) => {
    const { transferController } = await enterTransfer(searchParams)

    expect(transferController.selectedNft).toBeNull()
    expect(transferController.selectedToken).not.toBeNull()
  })

  test('should ignore the NFT params on the top up route', async () => {
    const { transferController } = await enterTransfer(nftSearchParams, {}, 'top-up-gas-tank')

    expect(transferController.isTopUp).toBe(true)
    expect(transferController.selectedNft).toBeNull()
  })

  test('should fill in the collection name once the portfolio loads', async () => {
    const { transferController, selectedAccountCtrl } = await enterTransfer(nftSearchParams, {
      collections: [],
      isAllReady: false
    })

    expect(transferController.selectedNft?.collectionName).toBe('')
    // still loading - no error message yet, but the form can't be submitted
    expect(transferController.validationFormMsgs.amount).toEqual({ severity: 'error', message: '' })

    selectedAccountCtrl.portfolio = {
      ...selectedAccountCtrl.portfolio,
      collections: [getCollection()],
      isAllReady: true
    }
    await selectedAccountCtrl.forceEmitUpdate()
    await flushPromises()

    expect(transferController.selectedNft?.collectionName).toBe('Test Collection')
    expect(transferController.selectedToken).toBeNull()
    expect(transferController.validationFormMsgs.amount.severity).toBe('success')
  })

  test('should not allow sending an NFT that is already being sent in a pending transaction', async () => {
    const { transferController } = await enterTransfer(nftSearchParams, {
      collections: [getCollection({ postSimulation: { sending: [NFT_TOKEN_ID] } })]
    })

    expect(transferController.validationFormMsgs.amount).toEqual({
      severity: 'error',
      message: 'This NFT is already being sent in a pending transaction.'
    })
    expect(transferController.isFormValid).toBe(false)
  })

  test.each([
    ['is not in the account', { collections: [getCollection({ collectibles: [1n] })] }],
    ['is on another chain', { collections: [getCollection({ chainId: 137n })] }]
  ])('should not allow sending an NFT that %s', async (_, portfolioOverrides) => {
    const { transferController } = await enterTransfer(nftSearchParams, portfolioOverrides)

    expect(transferController.validationFormMsgs.amount).toEqual({
      severity: 'error',
      message: "This NFT is no longer in your account, so it can't be sent."
    })
    expect(transferController.isFormValid).toBe(false)
  })

  test('should explain in NFT terms why a known app contract is not a valid recipient', async () => {
    const { transferController } = await enterTransfer()

    await transferController.update({ addressState: recipientState(XWALLET_ADDRESS) })

    expect(transferController.validationFormMsgs.recipientAddress).toEqual({
      severity: 'error',
      message:
        'This address belongs to an app, not a wallet. An NFT sent to it would likely be lost.'
    })
  })

  test('should start a new transaction setup when the route switches to a token on another chain', async () => {
    const { transferController, uiCtrl } = await enterTransfer()
    const destroy = jest.fn()
    ;(transferController as any).signAccountOpController = { destroy }

    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: { address: ZeroAddress, chainId: '137' }
    })

    expect(transferController.selectedNft).toBeNull()
    expect(transferController.selectedChainId).toBe(137n)
    expect(destroy).toHaveBeenCalled()
    expect(transferController.signAccountOpController).toBeNull()
  })

  test('should start a new transaction setup when the route switches to another NFT on the same chain', async () => {
    const otherTokenId = NFT_TOKEN_ID + 1n
    const { transferController, uiCtrl } = await enterTransfer(nftSearchParams, {
      collections: [getCollection({ collectibles: [NFT_TOKEN_ID, otherTokenId] })]
    })
    const destroy = jest.fn()
    ;(transferController as any).signAccountOpController = { destroy }

    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: { ...nftSearchParams, tokenId: String(otherTokenId) }
    })

    expect(transferController.selectedNft?.tokenId).toBe(otherTokenId)
    // Otherwise the calls of the previous NFT could be signed while the form shows this one
    expect(destroy).toHaveBeenCalled()
    expect(transferController.signAccountOpController).toBeNull()
  })

  test('should start a new transaction setup when the route switches from an NFT to a token on the same chain', async () => {
    const { transferController, uiCtrl } = await enterTransfer()
    const destroy = jest.fn()
    ;(transferController as any).signAccountOpController = { destroy }

    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: { address: ZeroAddress, chainId: '1' }
    })

    expect(transferController.selectedNft).toBeNull()
    expect(destroy).toHaveBeenCalled()
  })

  test('should keep the transaction setup when the route switches to another token on the same chain', async () => {
    const { transferController, uiCtrl } = await enterTransfer({
      address: ZeroAddress,
      chainId: '1'
    })
    const destroy = jest.fn()
    const signAccountOpController = { destroy }
    ;(transferController as any).signAccountOpController = signAccountOpController

    uiCtrl.updateView('popup', {
      currentRoute: 'transfer',
      isReady: true,
      searchParams: { address: STK_WALLET_ADDRESS, chainId: '1' }
    })

    expect(transferController.selectedToken?.address).toBe(STK_WALLET_ADDRESS)
    // The token calls are replaced on the next sync, so there is nothing stale to rebuild
    expect(destroy).not.toHaveBeenCalled()
    expect(transferController.signAccountOpController).toBe(signAccountOpController)
  })

  test('should not allow sending an NFT to a Privacy Pools account', async () => {
    const { transferController } = await enterTransfer()

    await transferController.update({ privacyPoolsRecipient: 'privacy-pools-seed' })

    expect(transferController.selectedNft).not.toBeNull()
    expect(transferController.selectedToken).toBeNull()
    expect(transferController.validationFormMsgs.recipientAddress).toEqual({
      severity: 'error',
      message: "NFTs can't be sent to a Privacy Pools account. Choose a different recipient."
    })
    expect(transferController.isFormValid).toBe(false)
  })

  test('should block sending the NFT to its own collection contract', async () => {
    const { transferController } = await enterTransfer()
    const signAccountOpUpdate = jest.fn()
    ;(transferController as any).signAccountOpController = { update: signAccountOpUpdate }

    await transferController.update({ addressState: recipientState(NFT_ADDRESS.toLowerCase()) })

    expect(transferController.validationFormMsgs.recipientAddress).toEqual({
      severity: 'error',
      message: "This address is the NFT collection itself. NFTs sent to it can't be recovered."
    })
    expect(transferController.isFormValid).toBe(false)
    expect(signAccountOpUpdate).not.toHaveBeenCalled()
  })

  test('should prepare a safeTransferFrom of the NFT for a valid recipient', async () => {
    const { transferController } = await enterTransfer()
    const signAccountOpUpdate = jest.fn()
    ;(transferController as any).signAccountOpController = {
      update: signAccountOpUpdate,
      accountOp: { meta: {} }
    }

    await transferController.update({ addressState: recipientState(PLACEHOLDER_RECIPIENT) })

    expect(transferController.isFormValid).toBe(true)
    expect(signAccountOpUpdate).toHaveBeenCalled()
    const [{ accountOpData }] = signAccountOpUpdate.mock.calls.at(-1) as any
    expect(accountOpData.calls).toHaveLength(1)
    expect(accountOpData.calls[0].to).toBe(NFT_ADDRESS)
    expect(accountOpData.calls[0].value).toBe(0n)
    const decoded = erc721Interface.parseTransaction({ data: accountOpData.calls[0].data })
    expect(decoded?.args[0]).toBe(account.addr)
    expect(decoded?.args[1]).toBe(PLACEHOLDER_RECIPIENT)
    expect(decoded?.args[2]).toBe(NFT_TOKEN_ID)
  })

  test('should ignore amount updates in NFT mode', async () => {
    const { transferController } = await enterTransfer()

    await transferController.update({ amount: '5', shouldSetMaxAmount: true })

    expect(transferController.amount).toBe('')
    expect(transferController.selectedNft).not.toBeNull()
  })

  test('should leave NFT mode when a token is selected', async () => {
    const { transferController, tokens } = await enterTransfer()
    const polygonNative = tokens.find((t) => t.address === ZeroAddress && t.chainId === 137n)

    await transferController.update({ selectedToken: polygonNative })

    expect(transferController.selectedNft).toBeNull()
    expect(transferController.selectedToken?.chainId).toBe(137n)
    expect(transferController.selectedChainId).toBe(137n)
  })

  test('should go back to sending tokens after resetForm (e.g. after the NFT was queued)', async () => {
    const { transferController } = await enterTransfer()

    transferController.resetForm()

    expect(transferController.selectedNft).toBeNull()
    expect(transferController.selectedToken).not.toBeNull()
  })

  test('should clear the NFT on reset without selecting a token', async () => {
    const { transferController } = await enterTransfer()

    transferController.reset()

    expect(transferController.selectedNft).toBeNull()
    expect(transferController.selectedToken).toBeNull()
    expect(transferController.areDefaultsSet).toBe(false)
  })

  test('should expose the NFT state in toJSON()', async () => {
    const { transferController } = await enterTransfer()
    const json = transferController.toJSON()

    expect(json.selectedNft?.tokenId).toBe(NFT_TOKEN_ID)
    expect(json.selectedChainId).toBe(1n)
    expect(json.latestBroadcastedNft).toBeNull()
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
