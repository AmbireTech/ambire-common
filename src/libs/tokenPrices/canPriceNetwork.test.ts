import { describe, expect, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { Network } from '../../interfaces/network'
import { canPriceNetwork } from './canPriceNetwork'

const ethereum = networks.find(({ chainId }) => chainId === 1n)!
// Covered by cena (it has a CoinGecko platform), but not by the RPC prices (no price config)
const worldChain: Network = {
  ...ethereum,
  chainId: 480n,
  name: 'World Chain',
  platformId: 'world-chain'
}
// Covered by neither, as testnets have no CoinGecko platform and no RPC price config
const baseSepolia: Network = {
  ...ethereum,
  chainId: 84532n,
  name: 'Base Sepolia',
  platformId: '',
  nativeAssetId: ''
}

describe('canPriceNetwork', () => {
  test('with our price API, a network can be priced only if it has a CoinGecko platform', () => {
    expect(canPriceNetwork(ethereum, true)).toBe(true)
    expect(canPriceNetwork(worldChain, true)).toBe(true)
    expect(canPriceNetwork(baseSepolia, true)).toBe(false)
  })

  test('from the RPC, a network can be priced only if we have a price config for it', () => {
    expect(canPriceNetwork(ethereum, false)).toBe(true)
    expect(canPriceNetwork(worldChain, false)).toBe(false)
    expect(canPriceNetwork(baseSepolia, false)).toBe(false)
  })

  test('the RPC prices do not depend on the CoinGecko platform', () => {
    expect(canPriceNetwork({ ...ethereum, platformId: '' }, false)).toBe(true)
  })
})
