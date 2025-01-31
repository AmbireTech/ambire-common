import { CustomToken, LegacyTokenPreference, TokenPreference } from '../customToken'
import { migrateTokenPreferences } from './tokenPreferences'

const storageTokenPreferences: LegacyTokenPreference[] = [
  {
    address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
    networkId: 'ethereum',
    isHidden: true,
    symbol: 'ETH',
    decimals: 18,
    standard: 'ERC20'
  },
  {
    address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce',
    networkId: 'ethereum',
    isHidden: false,
    symbol: 'ETH',
    decimals: 18,
    standard: 'ERC20'
  },
  {
    address: '0x6b175474e89094c44da98b954eedeac495271d0f',
    networkId: 'ethereum',
    isHidden: false,
    symbol: 'DAI',
    decimals: 18,
    // @ts-ignore
    standard: undefined // Missing on purpose
  }
]

describe('Token preferences migration', () => {
  it('Old storage version', () => {
    const storageCustomTokens: CustomToken[] = []

    const { tokenPreferences, customTokens, shouldUpdateStorage } = migrateTokenPreferences(
      storageTokenPreferences,
      storageCustomTokens
    )

    expect(shouldUpdateStorage).toBe(true)
    expect(tokenPreferences).toEqual([
      {
        address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
        networkId: 'ethereum',
        isHidden: true
      }
    ])
    expect(customTokens).toEqual([
      {
        address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7',
        networkId: 'ethereum',
        standard: 'ERC20'
      },
      {
        address: '0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce',
        networkId: 'ethereum',
        standard: 'ERC20'
      }
    ])
  })
  it('New storage version', () => {
    const newStorageTokenPreferences: TokenPreference[] = storageTokenPreferences.map(
      ({ address, networkId, isHidden }) => ({
        address,
        networkId,
        isHidden
      })
    )
    const storageCustomTokens: CustomToken[] = storageTokenPreferences.map(
      ({ address, networkId, standard }) => ({
        address,
        networkId,
        standard: standard || 'ERC20'
      })
    )

    const { tokenPreferences, customTokens, shouldUpdateStorage } = migrateTokenPreferences(
      newStorageTokenPreferences as LegacyTokenPreference[],
      storageCustomTokens
    )

    expect(shouldUpdateStorage).toBe(false)
    expect(tokenPreferences).toEqual(newStorageTokenPreferences)
    expect(tokenPreferences.length).toBe(3)
    expect(customTokens).toEqual(storageCustomTokens)
    expect(customTokens.length).toBe(3)
  })
})
