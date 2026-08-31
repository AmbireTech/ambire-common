import { describe } from '@jest/globals'

import { networks } from '../../consts/networks'
import {
  erc721CollectionToLearnedAssetKeys,
  formatExternalHintsAPIResponse,
  getAssetCacheKey,
  getErc721Validity,
  getHintsError,
  getSpecialHints,
  getVisibleCollectibles,
  mergeCollectionHints,
  getTotal,
  learnedErc721sToHints,
  mergeERC721s
} from './helpers'
import { ERC721s, ExternalHintsAPIResponse, GetOptions, ToBeLearnedAssets } from './interfaces'
import { PORTFOLIO_LIB_ERROR_NAMES } from './portfolio'
import { PORTFOLIO_STATE } from './testData'
import { isSuspectedToken, mapToken } from './tokenProcessing'

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
  describe('getSpecialHints', () => {
    const ERC20_ADDR = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const COLLECTION_ADDR = '0x35bAc15f98Fa2F496FCb84e269d8d0a408442272'
    const OTHER_COLLECTION_ADDR = '0x0000420538CD5AbfBC7Db219B6A1d125f5892Ab0'
    const EMPTY_TO_BE_LEARNED: ToBeLearnedAssets = { erc20s: {}, erc721s: {} }

    it('requests a custom collectible by its id', () => {
      const { specialErc721Hints } = getSpecialHints(
        1n,
        [
          { address: COLLECTION_ADDR, chainId: 1n, standard: 'ERC721', tokenId: 20n },
          { address: COLLECTION_ADDR, chainId: 1n, standard: 'ERC721', tokenId: 21n }
        ],
        [],
        EMPTY_TO_BE_LEARNED
      )

      expect(specialErc721Hints.custom).toEqual({ [COLLECTION_ADDR]: [20n, 21n] })
    })

    it('hides the listed collectibles, not the collection', () => {
      const { specialErc721Hints } = getSpecialHints(
        1n,
        [],
        [
          {
            address: COLLECTION_ADDR,
            chainId: 1n,
            isHidden: true,
            standard: 'ERC721',
            tokenId: 5n
          },
          { address: COLLECTION_ADDR, chainId: 1n, isHidden: true, standard: 'ERC721', tokenId: 6n }
        ],
        EMPTY_TO_BE_LEARNED
      )

      expect(specialErc721Hints.hidden).toEqual({ [COLLECTION_ADDR]: [5n, 6n] })
    })

    // Preferences stored before the collectibles were hidden one by one
    it('hides the whole collection when a preference has no id', () => {
      const { specialErc721Hints } = getSpecialHints(
        1n,
        [],
        [{ address: COLLECTION_ADDR, chainId: 1n, isHidden: true, standard: 'ERC721' }],
        EMPTY_TO_BE_LEARNED
      )

      expect(specialErc721Hints.hidden).toEqual({ [COLLECTION_ADDR]: [] })
    })

    it('separates custom tokens from custom collections', () => {
      const { specialErc20Hints, specialErc721Hints } = getSpecialHints(
        1n,
        [
          { address: ERC20_ADDR, chainId: 1n, standard: 'ERC20' },
          { address: COLLECTION_ADDR, chainId: 1n, standard: 'ERC721' }
        ],
        [],
        EMPTY_TO_BE_LEARNED
      )

      expect(specialErc20Hints.custom).toEqual([ERC20_ADDR])
      // An empty array means all collectibles of the collection are requested
      expect(specialErc721Hints.custom).toEqual({ [COLLECTION_ADDR]: [] })
    })

    it('separates hidden tokens from hidden collections', () => {
      const { specialErc20Hints, specialErc721Hints } = getSpecialHints(
        1n,
        [],
        [
          { address: ERC20_ADDR, chainId: 1n, isHidden: true },
          { address: COLLECTION_ADDR, chainId: 1n, isHidden: true, standard: 'ERC721' },
          // A preference that isn't hidden shouldn't be a hint
          { address: OTHER_COLLECTION_ADDR, chainId: 1n, isHidden: false, standard: 'ERC721' }
        ],
        EMPTY_TO_BE_LEARNED
      )

      // A preference without a standard is a token, as collections couldn't be
      // hidden when the preference was stored
      expect(specialErc20Hints.hidden).toEqual([ERC20_ADDR])
      expect(specialErc721Hints.hidden).toEqual({ [COLLECTION_ADDR]: [] })
    })

    it("skips assets that aren't on the requested network", () => {
      const { specialErc20Hints, specialErc721Hints } = getSpecialHints(
        1n,
        [{ address: COLLECTION_ADDR, chainId: 10n, standard: 'ERC721' }],
        [{ address: ERC20_ADDR, chainId: 10n, isHidden: true }],
        EMPTY_TO_BE_LEARNED
      )

      expect(specialErc20Hints.hidden).toEqual([])
      expect(specialErc721Hints.custom).toEqual({})
    })
  })

  describe('getAssetCacheKey', () => {
    const CHECKSUMMED = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

    it('resolves to the same key regardless of the address casing', () => {
      expect(getAssetCacheKey(CHECKSUMMED.toLowerCase(), 1n)).toBe(
        getAssetCacheKey(CHECKSUMMED, 1n)
      )
      expect(getAssetCacheKey(CHECKSUMMED.toUpperCase().replace('0X', '0x'), 1n)).toBe(
        getAssetCacheKey(CHECKSUMMED, 1n)
      )
    })

    it('separates the same address on different networks', () => {
      expect(getAssetCacheKey(CHECKSUMMED, 1n)).not.toBe(getAssetCacheKey(CHECKSUMMED, 10n))
    })

    it('falls back to the raw value when the address is not an address', () => {
      expect(getAssetCacheKey('not-an-address', 1n)).toBe('not-an-address-1')
    })
  })

  describe('getErc721Validity', () => {
    it('is a collection when it declares the ERC-721 interface', () => {
      expect(
        getErc721Validity({ supportsERC721: true, isContract: true, hasDecimals: false })
      ).toEqual({ isValid: true, message: null })
    })

    // Vote-escrow NFTs are ERC-721s that also expose decimals()
    it('is a collection when it declares the interface, even with decimals', () => {
      expect(
        getErc721Validity({ supportsERC721: true, isContract: true, hasDecimals: true })
      ).toEqual({ isValid: true, message: null })
    })

    // Collections like Aavegotchi don't implement ERC-165
    it('is a collection without ERC-165 support, as long as it has no decimals', () => {
      expect(
        getErc721Validity({ supportsERC721: false, isContract: true, hasDecimals: false })
      ).toEqual({ isValid: true, message: null })
      expect(
        getErc721Validity({ supportsERC721: undefined, isContract: true, hasDecimals: false })
      ).toEqual({ isValid: true, message: null })
    })

    // ENS NameWrapper is one, and it exposes ownerOf() as well
    it('rejects a multi edition NFT, even when it looks like a collection', () => {
      const { isValid, message } = getErc721Validity({
        supportsERC721: false,
        supportsERC1155: true,
        isContract: true,
        hasDecimals: false
      })

      expect(isValid).toBe(false)
      expect(message).toBe('This type of NFT (ERC-1155) is not supported yet')
    })

    it('rejects a token', () => {
      const { isValid, message } = getErc721Validity({
        supportsERC721: false,
        isContract: true,
        hasDecimals: true
      })

      expect(isValid).toBe(false)
      expect(message).toBe('This is a token, not an NFT collection')
    })

    it('rejects an address that is not a contract', () => {
      const { isValid, message } = getErc721Validity({
        supportsERC721: undefined,
        isContract: false,
        hasDecimals: false
      })

      expect(isValid).toBe(false)
      expect(message).toBe("This address doesn't look like an NFT collection")
    })

    // A collection is tracked regardless of what the account holds of it, the
    // same way a custom token is added regardless of its balance
    it('is a collection even when balanceOf is missing', () => {
      expect(
        getErc721Validity({ supportsERC721: undefined, isContract: true, hasDecimals: false })
      ).toEqual({ isValid: true, message: null })
    })
  })

  describe('mergeCollectionHints', () => {
    const COLLECTION_ADDR = '0x35bAc15f98Fa2F496FCb84e269d8d0a408442272'
    const CUSTOM_ADDR = '0x0000420538CD5AbfBC7Db219B6A1d125f5892Ab0'

    it('keeps the ids of a hidden collection', () => {
      const merged = mergeCollectionHints({
        apiHints: { [COLLECTION_ADDR]: [1n, 2n] },
        specialHints: { custom: {}, hidden: { [COLLECTION_ADDR]: [] }, learn: {} }
      })

      // An empty array marks a collection as enumerable and would replace the ids
      expect(merged[COLLECTION_ADDR]).toEqual([1n, 2n])
    })

    // Adding a collection as custom used to replace the ids of the API with the
    // enumerable marker, losing the collectibles of collections that can't be enumerated
    it('keeps the ids of the API for a custom collection', () => {
      const merged = mergeCollectionHints({
        apiHints: { [CUSTOM_ADDR]: [7n, 8n] },
        specialHints: { custom: { [CUSTOM_ADDR]: [] }, hidden: {}, learn: {} }
      })

      expect(merged[CUSTOM_ADDR]).toEqual([7n, 8n])
    })

    it('requests all collectibles of a custom collection no other source knows', () => {
      const merged = mergeCollectionHints({
        apiHints: {},
        specialHints: { custom: { [CUSTOM_ADDR]: [] }, hidden: {}, learn: {} }
      })

      expect(merged[CUSTOM_ADDR]).toEqual([])
    })

    it('merges the learned and the additional hints with the API ones', () => {
      const merged = mergeCollectionHints({
        additionalHints: { [COLLECTION_ADDR]: [3n] },
        apiHints: { [COLLECTION_ADDR]: [1n] },
        specialHints: { custom: {}, hidden: {}, learn: { [COLLECTION_ADDR]: [2n] } }
      })

      expect(merged[COLLECTION_ADDR]).toEqual([3n, 1n, 2n])
    })
  })

  describe('getVisibleCollectibles', () => {
    it('shows the whole collection when it was not added by the user', () => {
      expect(getVisibleCollectibles({ collectibles: [1n, 2n, 3n] })).toEqual([1n, 2n, 3n])
    })

    // The user adding one collectible must not bring the rest of the collection along
    it('shows only the added collectibles of a custom collection', () => {
      expect(getVisibleCollectibles({ collectibles: [1n, 2n, 3n], customIds: [2n] })).toEqual([2n])
    })

    it('shows every added collectible of a custom collection', () => {
      expect(getVisibleCollectibles({ collectibles: [1n, 2n, 3n], customIds: [3n, 1n] })).toEqual([
        1n,
        3n
      ])
    })

    it('leaves out an added collectible the account no longer owns', () => {
      expect(getVisibleCollectibles({ collectibles: [1n], customIds: [1n, 9n] })).toEqual([1n])
    })

    // Collections added before the ids were recorded have none
    it('shows the whole collection when it was added without ids', () => {
      expect(getVisibleCollectibles({ collectibles: [1n, 2n], customIds: [] })).toEqual([1n, 2n])
    })

    it('leaves out the hidden collectibles', () => {
      expect(getVisibleCollectibles({ collectibles: [1n, 2n, 3n], hiddenIds: [2n] })).toEqual([
        1n,
        3n
      ])
    })

    it('hides an added collectible of a custom collection', () => {
      expect(
        getVisibleCollectibles({ collectibles: [1n, 2n], customIds: [1n, 2n], hiddenIds: [1n] })
      ).toEqual([2n])
    })

    it('shows nothing of a collection whose collectibles are all hidden', () => {
      expect(getVisibleCollectibles({ collectibles: [1n], hiddenIds: [1n] })).toEqual([])
    })
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
  describe('getTotal', () => {
    const firstToken = PORTFOLIO_STATE['1']?.result?.tokens[0]!
    const mockHiddenToken = {
      ...firstToken,
      address: '0xHiddenTokenAddress',
      amount: 10n * 10n ** 6n,
      decimals: 6,
      priceIn: [{ baseCurrency: 'usd', price: 1 }],
      flags: {
        ...firstToken.flags,
        isHidden: true
      }
    }
    it('Calculates total', () => {
      const ethereumState = PORTFOLIO_STATE['1']

      const total = getTotal(ethereumState?.result?.tokens!, ethereumState?.result?.defiPositions!)

      expect(total.usd).toBe(140.05)
    })
    it('Calculates total excluding hidden tokens', () => {
      const ethereumState = structuredClone(PORTFOLIO_STATE['1'])

      ethereumState?.result?.tokens.push(mockHiddenToken)

      const total = getTotal(ethereumState?.result?.tokens!, ethereumState?.result?.defiPositions!)

      expect(total.usd).toBe(140.05)
    })
    it('Calculates total and includes hidden tokens if specified', () => {
      const ethereumState = structuredClone(PORTFOLIO_STATE['1'])

      ethereumState?.result?.tokens.push(mockHiddenToken)

      const total = getTotal(
        ethereumState?.result?.tokens!,
        ethereumState?.result?.defiPositions!,
        { includeHiddenTokens: true }
      )

      expect(total.usd).toBe(150.05)
    })
    it('Returns the defi total when there are no tokens', () => {
      const defiState = structuredClone(PORTFOLIO_STATE['1']?.result?.defiPositions!)

      const total = getTotal([], defiState)

      expect(total.usd).toBeGreaterThan(0)
    })
  })
  describe('getHintsError', () => {
    it('NoApiHintsError is returned if there are no previous hints', () => {
      const error = getHintsError('some error', null)

      expect(error.message).toBe('some error')
      expect(error.level).toBe('critical')
      expect(error.name).toBe(PORTFOLIO_LIB_ERROR_NAMES.NoApiHintsError)
    })
    it('StaleApiHintsError is returned if the update is older than 10 minutes', () => {
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000 - 1

      const error = getHintsError('some error', {
        lastUpdate: tenMinutesAgo,
        hasHints: true
      })

      expect(error.message).toBe('some error')
      expect(error.level).toBe('critical')
      expect(error.name).toBe(PORTFOLIO_LIB_ERROR_NAMES.StaleApiHintsError)
    })
    it('NonCriticalApiHintsError is returned if the update is fresher than 10 minutes', () => {
      const fiveMinutesAgo = Date.now() - 5 * 60 * 1000

      const error = getHintsError('some error', {
        lastUpdate: fiveMinutesAgo,
        hasHints: true
      })

      expect(error.message).toBe('some error')
      expect(error.level).toBe('silent')
      expect(error.name).toBe(PORTFOLIO_LIB_ERROR_NAMES.NonCriticalApiHintsError)
    })
  })
})

describe('isSuspectedToken', () => {
  it('returns null for trusted token', () => {
    const { address, symbol, chainId } = TOKENS.TRUSTED
    expect(isSuspectedToken(address, symbol, chainId)).toBeNull()
  })

  it('returns null for trusted token with non-Latin symbol', () => {
    const { address, symbol, chainId } = TOKENS.TRUSTED_WITH_NON_LATIN_SYMBOL
    expect(isSuspectedToken(address, symbol, chainId)).toBeNull()
  })

  it('returns null for legit token missing from trusted list', () => {
    const { address, symbol, chainId } = TOKENS.LEGIT_BUT_NOT_TRUSTED
    expect(isSuspectedToken(address, symbol, chainId)).toBeNull()
  })

  it('returns "suspected" for spoofed token with same symbol but different address', () => {
    const { address, symbol, chainId } = TOKENS.SPOOFED_WITH_VALID_SYMBOL
    expect(isSuspectedToken(address, symbol, chainId)).toBe('suspected')
  })
})
