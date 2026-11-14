import { describe, expect, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { Network } from '../../interfaces/network'
import { canPriceNetwork } from './canPriceNetwork'

const ethereum = networks.find(({ chainId }) => chainId === 1n)!
// A network the RPC prices don't cover, and cena does (it has a CoinGecko platform)
const scroll = networks.find(({ chainId }) => chainId === 534352n)!
// A network neither covers, e.g. World Chain, which has no CoinGecko platform
const withoutPlatform: Network = { ...ethereum, chainId: 480n, name: 'World Chain', platformId: '' }

describe('canPriceNetwork', () => {
  test('with our price API, a network can be priced only if it has a CoinGecko platform', () => {
    expect(canPriceNetwork(ethereum, true)).toBe(true)
    expect(canPriceNetwork(scroll, true)).toBe(true)
    expect(canPriceNetwork(withoutPlatform, true)).toBe(false)
  })

  test('from the RPC, a network can be priced only if we have a price config for it', () => {
    expect(canPriceNetwork(ethereum, false)).toBe(true)
    expect(canPriceNetwork(scroll, false)).toBe(false)
    expect(canPriceNetwork(withoutPlatform, false)).toBe(false)
  })

  test('the RPC prices do not depend on the CoinGecko platform', () => {
    expect(canPriceNetwork({ ...ethereum, platformId: '' }, false)).toBe(true)
  })
})
