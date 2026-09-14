import { FromToken } from '../../interfaces/swapAndBridge'
import { handleAmountConversion } from './conversion'

const HARD_CODED_CURRENCY = 'usd'
const WETH_PRICE = 2491.4335691077707

const weth: FromToken = {
  symbol: 'WETH',
  name: 'Wrapped Ether',
  decimals: 18,
  address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  chainId: 1n,
  amount: 330000000000000000n,
  priceIn: [{ baseCurrency: HARD_CODED_CURRENCY, price: WETH_PRICE }],
  marketDataIn: [],
  flags: {
    onGasTank: false,
    rewardsType: null,
    canTopUpGasTank: true,
    isFeeToken: true
  }
}

const convert = (amount: string, isInFiatMode: boolean, token: FromToken | null = weth) =>
  handleAmountConversion(amount, amount, token, isInFiatMode, HARD_CODED_CURRENCY)

describe('handleAmountConversion', () => {
  describe('token to fiat', () => {
    it('converts a token amount to a fiat amount a currency field can display', () => {
      const { tokenAmount, fiatAmount } = convert('0.33', false)

      expect(tokenAmount).toBe('0.33')
      expect(fiatAmount).toBe('822.17')
    })

    it('keeps the full precision of the token amount, which is the amount being sent', () => {
      const maxAmount = '0.334876543210987654'
      const { tokenAmount, fiatAmount } = convert(maxAmount, false)

      expect(tokenAmount).toBe(maxAmount)
      expect(fiatAmount).toBe('834.32')
    })

    it('keeps meaningful decimals for a sub-cent fiat amount', () => {
      const { fiatAmount } = convert('0.0000001', false)

      expect(fiatAmount).toBe('0.00024')
    })

    it('returns an empty fiat amount when the token has no price', () => {
      const { tokenAmount, fiatAmount } = convert('0.33', false, { ...weth, priceIn: [] })

      expect(tokenAmount).toBe('0.33')
      expect(fiatAmount).toBe('')
    })
  })

  describe('fiat to token', () => {
    it('keeps the typed fiat amount and converts it to a token amount', () => {
      const { tokenAmount, fiatAmount } = convert('822.17', true)

      expect(fiatAmount).toBe('822.17')
      // Not truncated, as this is the amount being sent
      expect(tokenAmount).toBe('0.329998')
    })
  })

  it('returns empty amounts for an empty input', () => {
    expect(convert('', false)).toEqual({ tokenAmount: '', fiatAmount: '' })
    expect(convert('', true)).toEqual({ tokenAmount: '', fiatAmount: '' })
  })
})
