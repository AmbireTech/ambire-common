import { describe } from '@jest/globals'

import { networks } from '../../consts/networks'
import {
  erc721CollectionToLearnedAssetKeys,
  formatExternalHintsAPIResponse,
  isSuspectedToken,
  learnedErc721sToHints,
  mapToken,
  mergeERC721s
} from './helpers'
import { ERC721s, ExternalHintsAPIResponse, GetOptions } from './interfaces'

const ethereum = networks.find((x) => x.chainId === 1n)
const optimism = networks.find((x) => x.chainId === 10n)!
const polygon = networks.find((x) => x.chainId === 137n)

const USDC_ADDR = '0x7f5c764cbc14f9669b88837ca1490cca17c31607'
const EMPTY_SPECIAL_HINTS: GetOptions['specialErc20Hints'] = {
  custom: [],
  hidden: [],
  learn: []
}
const USDC_DATA = {
  amount: 0n,
  decimals: 6,
  name: 'USD Coin',
  symbol: 'USDC'
}

const TOKENS = {
  TRUSTED: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    name: 'USDC',
    chainId: 1n
  },
  TRUSTED_WITH_NON_LATIN_SYMBOL: {
    address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    symbol: 'USD₮0',
    name: 'USDT token contract',
    chainId: 42161n
  },
  LEGIT_BUT_NOT_TRUSTED: {
    address: '0xc50673edb3a7b94e8cad8a7d4e0cd68864e33edf',
    symbol: 'PNKSTR',
    name: 'PunkStrategy',
    chainId: 1n
  },
  SPOOFED_WITH_VALID_SYMBOL: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49',
    symbol: 'USDC',
    name: 'USDC',
    chainId: 1n
  },
  SPOOFED_WITH_NON_LATIN_SYMBOL: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49',
    symbol: 'USD\u200BT', // visually "USDT" but contains zero-width space
    name: 'USD Coin',
    chainId: 1n
  },
  SPOOFED_WITH_NON_LATIN_NAME: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB49',
    symbol: 'USD',
    name: 'USD Сoin', // Cyrillic 'С'
    chainId: 1n
  }
} as const

if (!ethereum || !polygon || !optimism) throw new Error('Failed to find ethereum in networks')

describe('Portfolio helpers', () => {
  it('mergeERC721s', () => {
    const arrayOfHints: ERC721s[] = [
      {
        '0x026224A2940bFE258D0dbE947919B62fE321F042': [1n, 2n]
      },
      {
        '0x35bAc15f98Fa2F496FCb84e269d8d0a408442272': [5n],
        '0x026224A2940bFE258D0dbE947919B62fE321F042': [2n, 5n]
      }
    ]
    const merged = mergeERC721s(arrayOfHints)

    expect(Object.keys(merged).length).toBe(2)
    expect(merged['0x026224A2940bFE258D0dbE947919B62fE321F042']).toEqual([1n, 2n, 5n])
    expect(merged['0x026224A2940bFE258D0dbE947919B62fE321F042'].length).toBe(3)
    expect(merged['0x35bAc15f98Fa2F496FCb84e269d8d0a408442272']).toEqual([5n])
    expect(merged['0x35bAc15f98Fa2F496FCb84e269d8d0a408442272'].length).toBe(1)
  })
  it('formatExternalHintsAPIResponse', () => {
    const raw: ExternalHintsAPIResponse = {
      networkId: 'ethereum',
      chainId: 1,
      accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
      erc20s: [
        '0x0000000000000000000000000000000000000000',
        '0x45804880De22913dAFE09f4980848ECE6EcbAf78',
        '0x47Cd7E91C3CBaAF266369fe8518345fc4FC12935',
        '0x4da27a545c0c5B758a6BA100e3a049001de870f5',
        '0x6B175474E89094C44Da98b954EedeAC495271d0F',
        '0x88800092fF476844f74dC2FC427974BBee2794Ae',
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        '0xADE00C28244d5CE17D72E40330B1c318cD12B7c3',
        '0xB6456b57f03352bE48Bf101B46c1752a0813491a',
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        '0xba100000625a3754423978a60c9317c58a424e3D',
        '0xdAC17F958D2ee523a2206206994597C13D831ec7',
        '0xe575cc6ec0b5d176127ac61ad2d3d9d19d1aa4a0',
        '0x1abaea1f7c830bd89acc67ec4af516284b1bc33c',
        '0x514910771af9ca656af840dff83e8264ecf986ca',
        '0x40d16fc0246ad3160ccc09b8d0d3a2cd28ae6c2f',
        '0xae78736cd615f374d3085123a210448e74fc6393',
        '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
        '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
        '0x4Fabb145d64652a948d72533023f6E7A623C7C53',
        '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        '0x028171bCA77440897B824Ca71D1c56caC55b68A3',
        '0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9',
        '0xBcca60bB61934080951369a648Fb03DF4F96263C',
        '0x3Ed3B47Dd13EC9a98b44e6204A523E766B225811',
        '0x9ff58f4fFB29fA2266Ab25e75e2A8b3503311656',
        '0x030bA81f1c18d280636F32af80b9AAd02Cf0854e'
      ],
      erc721s: {
        '0x35bAc15f98Fa2F496FCb84e269d8d0a408442272': { isKnown: false, enumerable: true },
        '0x026224A2940bFE258D0dbE947919B62fE321F042': { isKnown: false, tokens: ['2162', '2647'] }
      },
      prices: {},
      hasHints: true,
      lastUpdate: Date.now()
    }

    const formatted = formatExternalHintsAPIResponse(raw)!

    expect(formatted).not.toBeNull()
    expect('prices' in formatted).toBeFalsy()
    expect('networkId' in formatted).toBeFalsy()
    expect('chainId' in formatted).toBeFalsy()
    expect('accountAddr' in formatted).toBeFalsy()

    expect(formatted.erc20s.length).toBe(raw.erc20s.length)
    expect(Object.keys(formatted.erc721s).length).toBe(Object.keys(raw.erc721s).length)
    expect(formatted.lastUpdate).toBe(raw.lastUpdate)
    expect(formatted.hasHints).toBe(raw.hasHints)

    expect(formatted.erc721s['0x35bAc15f98Fa2F496FCb84e269d8d0a408442272']).toEqual([])
    expect(formatted.erc721s['0x026224A2940bFE258D0dbE947919B62fE321F042']).toEqual([2162n, 2647n])
  })
  it('erc721CollectionToLearnedAssetKeys', () => {
    const collections: [string, bigint[]][] = [
      ['0x35bAc15f98Fa2F496FCb84e269d8d0a408442272', []],
      ['0x0000420538CD5AbfBC7Db219B6A1d125f5892Ab0', [1n, 2n, 3n]]
    ]

    const keys1 = erc721CollectionToLearnedAssetKeys(collections[0])

    expect(keys1.length).toBe(1)
    expect(keys1[0]).toBe('0x35bAc15f98Fa2F496FCb84e269d8d0a408442272:enumerable')

    const keys2 = erc721CollectionToLearnedAssetKeys(collections[1])
    expect(keys2.length).toBe(3)
    expect(keys2).toContain('0x0000420538CD5AbfBC7Db219B6A1d125f5892Ab0:1')
    expect(keys2).toContain('0x0000420538CD5AbfBC7Db219B6A1d125f5892Ab0:2')
    expect(keys2).toContain('0x0000420538CD5AbfBC7Db219B6A1d125f5892Ab0:3')
  })
  it('learnedErc721sToHints', () => {
    const learnedErc721s: string[] = [
      '0x35bAc15f98Fa2F496FCb84e269d8d0a408442272:enumerable',
      '0x35bAc15f98Fa2F496FCb84e269d8d0a408442272:1',
      '0x0000420538CD5AbfBC7Db219B6A1d125f5892Ab0:1001',
      '0x01284C3Ae295bAB7271481b7Ba18387255176f92:2',
      '0x01284C3Ae295bAB7271481b7Ba18387255176f92:enumerable'
    ]

    const hints = learnedErc721sToHints(learnedErc721s)

    expect(Object.keys(hints).length).toBe(3)
    // Even tho some of the hints are duplicated with ids,
    // if there is an enumerable key, we should prioritize it
    expect(hints['0x35bAc15f98Fa2F496FCb84e269d8d0a408442272']).toEqual([])
    expect(hints['0x0000420538CD5AbfBC7Db219B6A1d125f5892Ab0']).toEqual([1001n])
    expect(hints['0x01284C3Ae295bAB7271481b7Ba18387255176f92']).toEqual([])
  })
  describe('mapToken', () => {
    it('Overrides the symbol if needed', () => {
      const token = mapToken(USDC_DATA, optimism, USDC_ADDR, {
        specialErc20Hints: EMPTY_SPECIAL_HINTS,
        blockTag: ''
      })

      expect(token).toBeDefined()
      expect(token.symbol).toBe('USDC.E')
    })
    it('Flags: custom and hidden token', () => {
      const customToken = mapToken(USDC_DATA, optimism, USDC_ADDR, {
        specialErc20Hints: {
          ...EMPTY_SPECIAL_HINTS,
          custom: [USDC_ADDR]
        },
        blockTag: ''
      })
      const hiddenToken = mapToken(USDC_DATA, optimism, USDC_ADDR, {
        specialErc20Hints: {
          ...EMPTY_SPECIAL_HINTS,
          hidden: [USDC_ADDR]
        },
        blockTag: ''
      })

      expect(customToken).toBeDefined()
      expect(customToken?.flags.isCustom).toBe(true)
      expect(customToken?.flags.isHidden).toBeFalsy()
      expect(hiddenToken).toBeDefined()
      expect(hiddenToken?.flags.isHidden).toBe(true)
      expect(hiddenToken?.flags.isCustom).toBeFalsy()
    })
    it('Flags: custom token that is hidden', () => {
      const token = mapToken(USDC_DATA, optimism, USDC_ADDR, {
        specialErc20Hints: {
          ...EMPTY_SPECIAL_HINTS,
          custom: [USDC_ADDR],
          hidden: [USDC_ADDR]
        },
        blockTag: ''
      })

      expect(token).toBeDefined()
      expect(token?.flags.isCustom).toBe(true)
      expect(token?.flags.isHidden).toBe(true)
    })
  })
})

describe('isSuspectedToken', () => {
  it('returns null for trusted token', () => {
    const { address, symbol, name, chainId } = TOKENS.TRUSTED
    expect(isSuspectedToken(address, symbol, name, chainId)).toBeNull()
  })

  it('returns null for trusted token with non-Latin symbol', () => {
    const { address, symbol, name, chainId } = TOKENS.TRUSTED_WITH_NON_LATIN_SYMBOL
    expect(isSuspectedToken(address, symbol, name, chainId)).toBeNull()
  })

  it('returns null for legit token missing from trusted list', () => {
    const { address, symbol, name, chainId } = TOKENS.LEGIT_BUT_NOT_TRUSTED
    expect(isSuspectedToken(address, symbol, name, chainId)).toBeNull()
  })

  it('returns "no-latin-symbol" for token with hidden/invisible symbol', () => {
    const { address, symbol, name, chainId } = TOKENS.SPOOFED_WITH_NON_LATIN_SYMBOL
    expect(isSuspectedToken(address, symbol, name, chainId)).toBe('no-latin-symbol')
  })

  it('returns "no-latin-name" for token with non-Latin name', () => {
    const { address, symbol, name, chainId } = TOKENS.SPOOFED_WITH_NON_LATIN_NAME
    expect(isSuspectedToken(address, symbol, name, chainId)).toBe('no-latin-name')
  })

  it('returns "suspected" for spoofed token with same symbol but different address', () => {
    const { address, symbol, name, chainId } = TOKENS.SPOOFED_WITH_VALID_SYMBOL
    expect(isSuspectedToken(address, symbol, name, chainId)).toBe('suspected')
  })
})
