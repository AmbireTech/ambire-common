import { Interface, ZeroAddress } from 'ethers'

import IERC20 from '../../../contracts/compiled/IERC20.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { TokenResult } from '../portfolio'
import { getTransferRequestParams } from './userRequest'

const ERC20 = new Interface(IERC20.abi)

const ACCOUNT_ADDR = '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8'
const RECIPIENT_ADDR = '0xe5a4Dad2Ea987215460379Ab285DF87136E83BEA'
const ETHEREUM_CHAIN_ID = 1n
const WETH_ETHEREUM = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
// Ink - not a predefined network, so it has no known wrapped native token
const CUSTOM_CHAIN_ID = 57073n
const USDC_ETHEREUM = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

const getToken = (overrides: Partial<TokenResult>): TokenResult => ({
  symbol: 'ETH',
  name: 'Ether',
  decimals: 18,
  address: ZeroAddress,
  chainId: ETHEREUM_CHAIN_ID,
  amount: 10n ** 18n,
  priceIn: [],
  marketDataIn: [],
  flags: { onGasTank: false, rewardsType: null, canTopUpGasTank: true, isFeeToken: true },
  ...overrides
})

const AMOUNT_IN_FIAT = 3_000_000_000n

describe('getTransferRequestParams', () => {
  test('should send a native transfer to a regular recipient directly', () => {
    const result = getTransferRequestParams({
      amount: '1',
      amountInFiat: AMOUNT_IN_FIAT,
      selectedToken: getToken({}),
      selectedAccount: ACCOUNT_ADDR,
      recipientAddress: RECIPIENT_ADDR,
      recipientDomain: undefined
    })

    expect(result).not.toBeNull()
    expect(result!.calls).toHaveLength(1)
    expect(result!.calls[0]!.to).toBe(RECIPIENT_ADDR.toLowerCase())
    expect(result!.calls[0]!.value).toBe(10n ** 18n)
    expect(result!.calls[0]!.data).toBe('0x')
    expect(result!.meta.topUpAmount).toBeUndefined()
  })

  test('should wrap the native token for a top up on a predefined network', () => {
    const result = getTransferRequestParams({
      amount: '1',
      amountInFiat: AMOUNT_IN_FIAT,
      selectedToken: getToken({}),
      selectedAccount: ACCOUNT_ADDR,
      recipientAddress: FEE_COLLECTOR,
      recipientDomain: undefined
    })

    expect(result).not.toBeNull()
    expect(result!.calls).toHaveLength(2)
    expect(result!.calls[0]!.to).toBe(WETH_ETHEREUM)
    expect(result!.calls[0]!.value).toBe(10n ** 18n)
    expect(result!.calls[1]!.to).toBe(WETH_ETHEREUM)
    expect(result!.calls[1]!.value).toBe(0n)
    expect(result!.calls[1]!.data).toBe(
      ERC20.encodeFunctionData('transfer', [FEE_COLLECTOR.toLowerCase(), 10n ** 18n])
    )
    expect(result!.meta.topUpAmount).toBe(AMOUNT_IN_FIAT)
  })

  test('should send a native transfer to the fee collector on a network without a known wrapped token', () => {
    const result = getTransferRequestParams({
      amount: '0.5',
      amountInFiat: AMOUNT_IN_FIAT,
      selectedToken: getToken({ chainId: CUSTOM_CHAIN_ID }),
      selectedAccount: ACCOUNT_ADDR,
      recipientAddress: FEE_COLLECTOR,
      recipientDomain: undefined
    })

    expect(result).not.toBeNull()
    expect(result!.calls).toHaveLength(1)
    expect(result!.calls[0]!.to).toBe(FEE_COLLECTOR.toLowerCase())
    expect(result!.calls[0]!.value).toBe(5n * 10n ** 17n)
    expect(result!.calls[0]!.data).toBe('0x')
    expect(result!.meta.chainId).toBe(CUSTOM_CHAIN_ID)
    // the transfer isn't recorded as a top up, so it must not be counted towards the gas tank
    expect(result!.meta.topUpAmount).toBeUndefined()
  })

  test('should count an ERC-20 transfer to the fee collector as a top up', () => {
    const result = getTransferRequestParams({
      amount: '10',
      amountInFiat: AMOUNT_IN_FIAT,
      selectedToken: getToken({ symbol: 'USDC', decimals: 6, address: USDC_ETHEREUM }),
      selectedAccount: ACCOUNT_ADDR,
      recipientAddress: FEE_COLLECTOR,
      recipientDomain: undefined
    })

    expect(result).not.toBeNull()
    expect(result!.calls).toHaveLength(1)
    expect(result!.calls[0]!.to).toBe(USDC_ETHEREUM)
    expect(result!.calls[0]!.data).toBe(
      ERC20.encodeFunctionData('transfer', [FEE_COLLECTOR.toLowerCase(), 10_000_000n])
    )
    expect(result!.meta.topUpAmount).toBe(AMOUNT_IN_FIAT)
  })

  test('should return null when the recipient is missing', () => {
    expect(
      getTransferRequestParams({
        amount: '1',
        selectedToken: getToken({}),
        selectedAccount: ACCOUNT_ADDR,
        recipientAddress: '',
        recipientDomain: undefined
      })
    ).toBeNull()
  })
})
