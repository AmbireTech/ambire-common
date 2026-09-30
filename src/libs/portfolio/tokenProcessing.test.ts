import { ZeroAddress } from 'ethers'

import { describe, expect, it } from '@jest/globals'

import gasTankFeeTokens from '../../consts/gasTankFeeTokens'
import {
  getFeeToken,
  getFlags,
  isFiatLikeSymbol,
  isSuspectedRegardsKnownAddresses,
  isSuspectedToken
} from './tokenProcessing'

const USDT_ETHEREUM = '0xdAC17F958D2ee523a2206206994597C13D831ec7'
const WETH_OPTIMISM = '0x4200000000000000000000000000000000000006'
const DUPLICATED_ON_AVALANCHE = '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E'
const NOT_A_FEE_TOKEN = '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
// The only entry in the known addresses carrying the symbol OP, and only on Optimism
const OP_OPTIMISM = '0x4200000000000000000000000000000000000042'
const SPOOFED_ADDRESS = '0x000000000000000000000000000000000000dEaD'

describe('getFeeToken', () => {
  it('returns the first of two entries sharing an address and a chain', () => {
    const duplicates = gasTankFeeTokens.filter(
      (t) =>
        t.address.toLowerCase() === DUPLICATED_ON_AVALANCHE.toLowerCase() && t.chainId === 43114n
    )

    expect(duplicates.length).toBeGreaterThan(1)
    expect(getFeeToken(DUPLICATED_ON_AVALANCHE, 43114n)).toBe(duplicates[0])
  })

  it('is case-insensitive on the given address', () => {
    const usdt = gasTankFeeTokens.find(
      (t) => t.address.toLowerCase() === USDT_ETHEREUM.toLowerCase() && t.chainId === 1n
    )

    expect(usdt).toBeDefined()
    expect(getFeeToken(USDT_ETHEREUM.toLowerCase(), 1n)).toBe(usdt)
    expect(getFeeToken(USDT_ETHEREUM.toUpperCase(), 1n)).toBe(usdt)
  })

  it('returns undefined for an address that is not a fee token', () => {
    expect(getFeeToken(NOT_A_FEE_TOKEN, 1n)).toBeUndefined()
    expect(getFeeToken(NOT_A_FEE_TOKEN, 1n)).toBeUndefined()
  })

  it('returns undefined when the address is a fee token but on another chain', () => {
    const wethOnOptimism = gasTankFeeTokens.find(
      (t) => t.address.toLowerCase() === WETH_OPTIMISM.toLowerCase() && t.chainId === 10n
    )

    expect(wethOnOptimism).toBeDefined()
    expect(getFeeToken(WETH_OPTIMISM, 1n)).toBeUndefined()
    expect(getFeeToken(WETH_OPTIMISM, 1n)).toBeUndefined()
  })

  it('reuses the index across calls instead of rebuilding it', () => {
    expect(getFeeToken(USDT_ETHEREUM, 1n)).toBe(getFeeToken(USDT_ETHEREUM, 1n))
  })
})

describe('isSuspectedRegardsKnownAddresses', () => {
  it('does not suspect the known token itself, whichever case its address is given in', () => {
    expect(isSuspectedRegardsKnownAddresses(OP_OPTIMISM, 'OP', 10n)).toBe(false)
    expect(isSuspectedRegardsKnownAddresses(OP_OPTIMISM.toLowerCase(), 'OP', 10n)).toBe(false)
  })

  it('suspects another address holding a known symbol on the same chain', () => {
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, 'OP', 10n)).toBe(true)
  })

  it('does not suspect a known symbol on a chain the known token is not on', () => {
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, 'OP', 1n)).toBe(false)
  })

  it('does not suspect a symbol no known token carries', () => {
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, 'NOTASYMBOL', 10n)).toBe(false)
  })

  it('sees through characters that are dropped from a symbol', () => {
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, 'O\u200bP', 10n)).toBe(true)
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, 'oр', 10n)).toBe(false)
  })

  it('needs both an address and a symbol to suspect anything', () => {
    expect(isSuspectedRegardsKnownAddresses('', 'OP', 10n)).toBe(false)
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, '', 10n)).toBe(false)
  })

  it('answers the same on every call, so the index it builds is reused as it is', () => {
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, 'OP', 10n)).toBe(true)
    expect(isSuspectedRegardsKnownAddresses(OP_OPTIMISM, 'OP', 10n)).toBe(false)
    expect(isSuspectedRegardsKnownAddresses(SPOOFED_ADDRESS, 'OP', 10n)).toBe(true)
  })
})

describe('getFlags fee token flags', () => {
  it('marks a gas tank fee token as topped up and usable as a fee', () => {
    const usdt = gasTankFeeTokens.find(
      (t) => t.address.toLowerCase() === USDT_ETHEREUM.toLowerCase() && t.chainId === 1n
    )!

    expect(usdt.disableGasTankDeposit).toBeFalsy()
    expect(usdt.disableAsFeeToken).toBeFalsy()

    const flags = getFlags({}, '1', 1n, USDT_ETHEREUM, 'Tether USD', 'USDT')

    expect(flags.canTopUpGasTank).toBe(true)
    expect(flags.isFeeToken).toBe(true)
    expect(flags.onGasTank).toBe(false)
  })

  it('does not mark an unknown token as a fee token', () => {
    const flags = getFlags({}, '1', 1n, NOT_A_FEE_TOKEN, 'Random', 'RND')

    expect(flags.canTopUpGasTank).toBe(false)
    expect(flags.isFeeToken).toBeFalsy()
  })

  it('treats the native token as a fee token even without a gas tank entry', () => {
    const flags = getFlags({}, '31337', 31337n, ZeroAddress, 'Ether', 'ETH')

    expect(getFeeToken(ZeroAddress, 31337n)).toBeUndefined()
    expect(flags.isFeeToken).toBe(true)
    expect(flags.canTopUpGasTank).toBe(false)
  })

  it('resolves fee tokens on the gasTank pseudo chain by the token chain id', () => {
    const flags = getFlags({}, 'gasTank', 1n, USDT_ETHEREUM, 'Tether USD', 'USDT')

    expect(flags.onGasTank).toBe(true)
    expect(flags.canTopUpGasTank).toBe(true)
    expect(flags.isFeeToken).toBe(true)
  })
})

describe('isFiatLikeSymbol', () => {
  it('flags a symbol that is only a fiat currency sign', () => {
    expect(isFiatLikeSymbol('$')).toBe(true)
    expect(isFiatLikeSymbol('€')).toBe(true)
    expect(isFiatLikeSymbol('£')).toBe(true)
    expect(isFiatLikeSymbol('¥')).toBe(true)
  })

  it('flags a fiat currency sign as the first character, followed by an amount', () => {
    expect(isFiatLikeSymbol('$100')).toBe(true)
    expect(isFiatLikeSymbol('€500')).toBe(true)
    expect(isFiatLikeSymbol('$1000')).toBe(true)
    expect(isFiatLikeSymbol('$1.000')).toBe(true)
    expect(isFiatLikeSymbol('$1,000')).toBe(true)
    expect(isFiatLikeSymbol('€1.000,1')).toBe(true)
    expect(isFiatLikeSymbol('$1,000.0')).toBe(true)
    expect(isFiatLikeSymbol('$ 1,000')).toBe(true)
  })

  it('flags a fiat currency sign next to an amount with a size suffix', () => {
    expect(isFiatLikeSymbol('$100K')).toBe(true)
    expect(isFiatLikeSymbol('$100k')).toBe(true)
    expect(isFiatLikeSymbol('$1.5M')).toBe(true)
    expect(isFiatLikeSymbol('€2B')).toBe(true)
    expect(isFiatLikeSymbol('$1T')).toBe(true)
    expect(isFiatLikeSymbol('$ 100 K')).toBe(true)
    expect(isFiatLikeSymbol('100K$')).toBe(true)
    expect(isFiatLikeSymbol('1,5M €')).toBe(true)
  })

  it('flags a fiat currency sign next to a fiat currency code', () => {
    expect(isFiatLikeSymbol('$USD')).toBe(true)
    expect(isFiatLikeSymbol('$usd')).toBe(true)
    expect(isFiatLikeSymbol('USD$')).toBe(true)
    expect(isFiatLikeSymbol('€EUR')).toBe(true)
    expect(isFiatLikeSymbol('$ EUR')).toBe(true)
    expect(isFiatLikeSymbol('GBP £')).toBe(true)
    expect(isFiatLikeSymbol('$U\u200bSD')).toBe(true)
  })

  it('flags a fiat currency sign next to an amount that uses spaces between digit groups', () => {
    expect(isFiatLikeSymbol('$1 000')).toBe(true)
    expect(isFiatLikeSymbol('\u20ac1 000 000,50')).toBe(true)
    expect(isFiatLikeSymbol('1 000 \u20ac')).toBe(true)
    // no-break and narrow no-break spaces become a plain space after NFKC
    expect(isFiatLikeSymbol('\u20ac1\u00a0000')).toBe(true)
    expect(isFiatLikeSymbol('1\u202f000\u20ac')).toBe(true)
  })

  it('flags a fiat currency sign next to an amount and a fiat currency code', () => {
    expect(isFiatLikeSymbol('$100 USD')).toBe(true)
    expect(isFiatLikeSymbol('$100USD')).toBe(true)
    expect(isFiatLikeSymbol('$1.5M usd')).toBe(true)
    expect(isFiatLikeSymbol('$USD 100')).toBe(true)
    expect(isFiatLikeSymbol('EUR 1 000\u20ac')).toBe(true)
    expect(isFiatLikeSymbol('100 EUR \u20ac')).toBe(true)
    expect(isFiatLikeSymbol('$100 U\u200bSD')).toBe(true)
  })

  it('flags a fiat currency sign next to an amount or a fiat currency code, with other text after it', () => {
    expect(isFiatLikeSymbol('$100 USDC')).toBe(true)
    expect(isFiatLikeSymbol('$100 PEPE')).toBe(true)
    expect(isFiatLikeSymbol('$100 KRW')).toBe(true)
    expect(isFiatLikeSymbol('$USD USD')).toBe(true)
    expect(isFiatLikeSymbol('$100 USD 100')).toBe(true)
    expect(isFiatLikeSymbol('$1  000')).toBe(true)
    expect(isFiatLikeSymbol('$1 000 ETH')).toBe(true)
    expect(isFiatLikeSymbol('$100\tClaim')).toBe(true)
    expect(isFiatLikeSymbol('Claim 100 €')).toBe(true)
  })

  it('flags a fiat currency sign as the last character, after an amount', () => {
    expect(isFiatLikeSymbol('100$')).toBe(true)
    expect(isFiatLikeSymbol('1.000€')).toBe(true)
    expect(isFiatLikeSymbol('1,000.0£')).toBe(true)
    expect(isFiatLikeSymbol('1000 €')).toBe(true)
  })

  it('does not flag a fiat currency sign next to text or in the middle', () => {
    expect(isFiatLikeSymbol('$ Claim at scam.xyz')).toBe(false)
    expect(isFiatLikeSymbol('US$')).toBe(false)
    expect(isFiatLikeSymbol('$KRW')).toBe(false)
    expect(isFiatLikeSymbol('1$0')).toBe(false)
    expect(isFiatLikeSymbol('$100$')).toBe(false)
    expect(isFiatLikeSymbol('$$')).toBe(false)
  })

  it('does not flag a fiat currency sign with something that is not a plain amount', () => {
    expect(isFiatLikeSymbol('$1..0')).toBe(false)
    expect(isFiatLikeSymbol('$.5')).toBe(false)
    expect(isFiatLikeSymbol('$5.')).toBe(false)
    expect(isFiatLikeSymbol('$-100')).toBe(false)
    expect(isFiatLikeSymbol('$100KK')).toBe(false)
    expect(isFiatLikeSymbol('$100X')).toBe(false)
    expect(isFiatLikeSymbol('$K')).toBe(false)
    expect(isFiatLikeSymbol('$.5M')).toBe(false)
    expect(isFiatLikeSymbol('$KM')).toBe(false)
  })

  it('flags a symbol that is exactly a fiat currency code, in any case', () => {
    expect(isFiatLikeSymbol('USD')).toBe(true)
    expect(isFiatLikeSymbol('eur')).toBe(true)
    expect(isFiatLikeSymbol(' GBP ')).toBe(true)
  })

  it('flags look-alike and hidden-character variants', () => {
    // full-width dollar sign and full-width letters fold to their plain form
    expect(isFiatLikeSymbol('＄')).toBe(true)
    expect(isFiatLikeSymbol('ＵＳＤ')).toBe(true)
    expect(isFiatLikeSymbol('＄１００')).toBe(true)
    // zero-width space inside the code or the amount
    expect(isFiatLikeSymbol('U\u200bSD')).toBe(true)
    expect(isFiatLikeSymbol('\ufeffEUR\u200d')).toBe(true)
    expect(isFiatLikeSymbol('$\u200b100')).toBe(true)
    expect(isFiatLikeSymbol('\u200b$')).toBe(true)
  })

  it('does not flag "$"-prefixed tickers used by real tokens', () => {
    expect(isFiatLikeSymbol('$PEPE')).toBe(false)
    expect(isFiatLikeSymbol('$DG')).toBe(false)
    expect(isFiatLikeSymbol('$ZKP')).toBe(false)
    expect(isFiatLikeSymbol('$PEPE2')).toBe(false)
  })

  it('does not flag regular symbols, stablecoins or crypto signs', () => {
    expect(isFiatLikeSymbol('ETH')).toBe(false)
    expect(isFiatLikeSymbol('USDC')).toBe(false)
    expect(isFiatLikeSymbol('USDT')).toBe(false)
    expect(isFiatLikeSymbol('EURC')).toBe(false)
    expect(isFiatLikeSymbol('USD₮0')).toBe(false)
    // a visible non-ASCII character is not removed, so it does not reveal a fiat code
    expect(isFiatLikeSymbol('USD₮')).toBe(false)
    expect(isFiatLikeSymbol('ЕUR')).toBe(false)
    expect(isFiatLikeSymbol('₿')).toBe(false)
  })

  it('does not flag an empty symbol', () => {
    expect(isFiatLikeSymbol('')).toBe(false)
    expect(isFiatLikeSymbol('   ')).toBe(false)
  })
})

describe('isSuspectedToken fiat symbols', () => {
  it('returns "suspected" for an unknown token with a fiat-like symbol', () => {
    expect(isSuspectedToken(NOT_A_FEE_TOKEN, '$', 1n)).toBe('suspected')
    expect(isSuspectedToken(NOT_A_FEE_TOKEN, 'USD', 1n)).toBe('suspected')
    expect(isSuspectedToken(NOT_A_FEE_TOKEN, '€500', 1n)).toBe('suspected')
  })

  it('trusts a known token on its own chain before the fiat rule runs', () => {
    expect(isSuspectedToken(USDT_ETHEREUM, 'USD', 1n)).toBeNull()
  })

  it('still returns "suspected" for a same-symbol spoof', () => {
    expect(isSuspectedToken(NOT_A_FEE_TOKEN, 'USDC', 1n)).toBe('suspected')
  })

  it('returns null for an unknown token with a regular symbol', () => {
    expect(isSuspectedToken(NOT_A_FEE_TOKEN, 'RND', 1n)).toBeNull()
  })
})

describe('getFlags fiat symbols', () => {
  it('sets suspectedType for a fiat-like symbol only for tokens in a simulation', () => {
    expect(getFlags({}, '1', 1n, NOT_A_FEE_TOKEN, 'Dollar', '$', true).suspectedType).toBe(
      'suspected'
    )
    expect(getFlags({}, '1', 1n, NOT_A_FEE_TOKEN, 'Dollar', '$').suspectedType).toBeNull()
  })
})
