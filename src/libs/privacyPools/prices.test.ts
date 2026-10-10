import { expect } from '@jest/globals'

import { PrivacyPoolsTokenBalance } from '../../interfaces/privacyPools'
import { getPrivacyPoolsPriceKey, getPrivacyPoolsValuePerChain } from './prices'

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

const getBalance = (overrides: Partial<PrivacyPoolsTokenBalance>): PrivacyPoolsTokenBalance => ({
  tokenAddress: '0x0000000000000000000000000000000000000000',
  symbol: 'ETH',
  decimals: 18,
  isNative: true,
  approvedAmount: 0n,
  pendingAmount: 0n,
  totalAmount: 0n,
  ...overrides
})

describe('getPrivacyPoolsValuePerChain', () => {
  it('values only the approved part of each balance', () => {
    const values = getPrivacyPoolsValuePerChain(
      {
        '1': [
          getBalance({ approvedAmount: 10n ** 18n, pendingAmount: 5n * 10n ** 18n }),
          getBalance({
            tokenAddress: USDC,
            symbol: 'USDC',
            decimals: 6,
            isNative: false,
            approvedAmount: 2_500_000n
          })
        ]
      },
      {
        [getPrivacyPoolsPriceKey('1', '0x0000000000000000000000000000000000000000')]: 2000,
        [getPrivacyPoolsPriceKey('1', USDC)]: 1
      }
    )

    expect(values).toEqual({ '1': 2002.5 })
  })

  it('leaves out a token with no known price without dropping the chain', () => {
    const values = getPrivacyPoolsValuePerChain(
      {
        '1': [getBalance({ approvedAmount: 10n ** 18n })],
        '11155111': [getBalance({ approvedAmount: 10n ** 18n })]
      },
      { [getPrivacyPoolsPriceKey('1', '0x0000000000000000000000000000000000000000')]: 2000 }
    )

    expect(values).toEqual({ '1': 2000, '11155111': 0 })
  })

  it('matches prices to token addresses whatever their case', () => {
    const values = getPrivacyPoolsValuePerChain(
      {
        '1': [
          getBalance({
            tokenAddress: USDC.toUpperCase().replace('0X', '0x'),
            decimals: 6,
            approvedAmount: 1_000_000n
          })
        ]
      },
      { [getPrivacyPoolsPriceKey('1', USDC)]: 1 }
    )

    expect(values).toEqual({ '1': 1 })
  })

  it('is empty when nothing has been read', () => {
    expect(getPrivacyPoolsValuePerChain({}, {})).toEqual({})
  })
})
