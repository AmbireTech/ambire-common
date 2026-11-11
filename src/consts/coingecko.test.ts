import { ZeroAddress } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { geckoIdMapper } from './coingecko'
import { networks } from './networks'

const ethereum = networks.find(({ chainId }) => chainId === 1n)!
const STK_AAVE = '0x4da27a545c0c5B758a6BA100e3a049001de870f5'

describe('geckoIdMapper', () => {
  test('maps the native token to the network coin id', () => {
    expect(geckoIdMapper(ZeroAddress, ethereum)).toBe(ethereum.nativeAssetId)
  })

  test('maps an aliased token regardless of the address casing', () => {
    expect(geckoIdMapper(STK_AAVE, ethereum)).toBe('aave')
    expect(geckoIdMapper(STK_AAVE.toLowerCase(), ethereum)).toBe('aave')
    expect(geckoIdMapper(STK_AAVE.toUpperCase().replace('0X', '0x'), ethereum)).toBe('aave')
  })

  test('maps no coin id for a regular token', () => {
    expect(geckoIdMapper('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', ethereum)).toBeNull()
  })
})
