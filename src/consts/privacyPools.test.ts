import { expect } from '@jest/globals'

import { ZERO_ADDRESS } from '../services/socket/constants'
import {
  fromPrivacyPoolsAssetAddress,
  getPrivacyPoolsAsset,
  isPrivacyPoolsNativeAsset,
  PRIVACY_POOLS_CHAINS,
  PRIVACY_POOLS_NATIVE_ASSET_ADDRESS,
  toPrivacyPoolsAssetAddress
} from './privacyPools'

const USDC_MAINNET = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

describe('consts/privacyPools', () => {
  describe('native asset translation', () => {
    it('sends the SDK its own sentinel for native', () => {
      expect(toPrivacyPoolsAssetAddress(ZERO_ADDRESS)).toBe(PRIVACY_POOLS_NATIVE_ASSET_ADDRESS)
    })

    it('brings the sentinel back as the address the rest of the wallet uses', () => {
      expect(fromPrivacyPoolsAssetAddress(PRIVACY_POOLS_NATIVE_ASSET_ADDRESS)).toBe(ZERO_ADDRESS)
    })

    // The SDK stores addresses as bigints, which is what `notes()` hands back.
    it('accepts the sentinel as the bigint the SDK actually reports', () => {
      expect(fromPrivacyPoolsAssetAddress(BigInt(PRIVACY_POOLS_NATIVE_ASSET_ADDRESS))).toBe(
        ZERO_ADDRESS
      )
    })

    it('round-trips native without leaking the sentinel', () => {
      expect(fromPrivacyPoolsAssetAddress(toPrivacyPoolsAssetAddress(ZERO_ADDRESS))).toBe(
        ZERO_ADDRESS
      )
    })

    it('round-trips an ERC-20 unchanged', () => {
      expect(fromPrivacyPoolsAssetAddress(toPrivacyPoolsAssetAddress(USDC_MAINNET))).toBe(
        USDC_MAINNET.toLowerCase()
      )
    })

    it('pads a bigint address back to full width', () => {
      expect(fromPrivacyPoolsAssetAddress(1n)).toBe('0x0000000000000000000000000000000000000001')
    })

    it('recognises native only by the wallet’s own convention, not the sentinel', () => {
      expect(isPrivacyPoolsNativeAsset(ZERO_ADDRESS)).toBe(true)
      expect(isPrivacyPoolsNativeAsset(PRIVACY_POOLS_NATIVE_ASSET_ADDRESS)).toBe(false)
      expect(isPrivacyPoolsNativeAsset(USDC_MAINNET)).toBe(false)
    })
  })

  describe('getPrivacyPoolsAsset', () => {
    it('resolves a configured token regardless of address casing', () => {
      expect(getPrivacyPoolsAsset(1n, USDC_MAINNET.toLowerCase())).toMatchObject({
        symbol: 'USDC',
        decimals: 6,
        isNative: false
      })
    })

    it('resolves native by the zero address', () => {
      expect(getPrivacyPoolsAsset(1n, ZERO_ADDRESS)).toMatchObject({
        symbol: 'ETH',
        decimals: 18,
        isNative: true
      })
    })

    it('returns nothing for a token this chain has no pool for', () => {
      expect(
        getPrivacyPoolsAsset(1n, '0x0000000000000000000000000000000000000dead')
      ).toBeUndefined()
    })

    it('returns nothing for an unsupported chain', () => {
      expect(getPrivacyPoolsAsset(137n, ZERO_ADDRESS)).toBeUndefined()
    })

    // Sepolia and mainnet share symbols but not addresses; a lookup must not cross chains.
    it('does not resolve a mainnet token against Sepolia', () => {
      expect(getPrivacyPoolsAsset(11155111n, USDC_MAINNET)).toBeUndefined()
    })
  })

  describe('chain config', () => {
    it('lists native first on every chain, since it is the common case', () => {
      Object.values(PRIVACY_POOLS_CHAINS).forEach((chain) => {
        expect(chain.assets[0].isNative).toBe(true)
      })
    })

    // The SDK looks the adapter up by the lowercase pool address, so a checksummed key never matches
    // and the withdrawal fails with "no paymaster adapter configured".
    it('keys every paymaster adapter by the lowercase pool address', () => {
      Object.values(PRIVACY_POOLS_CHAINS).forEach((chain) => {
        Object.keys(chain.paymaster?.poolAdapters || {}).forEach((poolAddress) => {
          expect(poolAddress).toBe(poolAddress.toLowerCase())
        })
      })
    })

    it('declares exactly one native asset per chain', () => {
      Object.values(PRIVACY_POOLS_CHAINS).forEach((chain) => {
        expect(chain.assets.filter((asset) => asset.isNative)).toHaveLength(1)
      })
    })

    it('has no duplicate asset addresses within a chain', () => {
      Object.values(PRIVACY_POOLS_CHAINS).forEach((chain) => {
        const addresses = chain.assets.map((asset) => asset.address.toLowerCase())
        expect(new Set(addresses).size).toBe(addresses.length)
      })
    })
  })
})
