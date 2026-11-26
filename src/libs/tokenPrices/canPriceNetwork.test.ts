import { describe, expect, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { Network } from '../../interfaces/network'
import { canPriceNetwork, canRpcPriceEveryToken, isMissingPriceMeaningful } from './canPriceNetwork'

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

// Scroll has the native token's USD feed but not 1inch's spot price aggregator
const SCROLL_CHAIN_ID = 534352n

describe('canRpcPriceEveryToken', () => {
  test('is true only for networks with both the native USD feed and the spot price aggregator', () => {
    expect(canRpcPriceEveryToken(1n)).toBe(true)
    expect(canRpcPriceEveryToken(SCROLL_CHAIN_ID)).toBe(false)
    expect(canRpcPriceEveryToken(480n)).toBe(false)
  })
})

describe('isMissingPriceMeaningful', () => {
  test('with our price API, a token without a price has no market', () => {
    expect(isMissingPriceMeaningful(1n, true, true)).toBe(true)
    expect(isMissingPriceMeaningful(480n, true, false)).toBe(true)
  })

  test('with the RPC prices and auto discovery on, a missing price says nothing about the token', () => {
    expect(isMissingPriceMeaningful(1n, false, true)).toBe(false)
  })

  test('with the RPC prices and auto discovery off, it means no market only where the RPC can price every token', () => {
    expect(isMissingPriceMeaningful(1n, false, false)).toBe(true)
    expect(isMissingPriceMeaningful(SCROLL_CHAIN_ID, false, false)).toBe(false)
    expect(isMissingPriceMeaningful(480n, false, false)).toBe(false)
  })
})
