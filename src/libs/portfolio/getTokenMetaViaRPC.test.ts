import { describe, expect, it, jest } from '@jest/globals'

import { networks } from '../../consts/networks'
import { RPCProvider } from '../../interfaces/provider'
import { getTokenInfo, TokenInfo } from './getTokenInfo'
import { getTokenMetaViaRPC } from './getTokenMetaViaRPC'

jest.mock('./getTokenInfo')

const tokenAddress = '0x4d224452801ACEd8B2F0aebE155379bb5D594381'
// A statically blacklisted token on Ethereum (a duplicate of another token)
const blacklistedAddress = '0x3231Cb76718CDeF2155FC47b5286d82e6eDA273f'

const makeToken = (overrides: Partial<TokenInfo> = {}): TokenInfo => ({
  address: tokenAddress,
  symbol: 'APE',
  name: 'ApeCoin',
  decimals: 18,
  ...overrides
})

const ETHEREUM = networks.find(({ chainId }) => chainId === 1n)!
const BASE = networks.find(({ chainId }) => chainId === 8453n)!
const provider = {} as RPCProvider

const makeRead = (result: TokenInfo | null) =>
  jest.mocked(getTokenInfo).mockReset().mockResolvedValue(result)

describe('getTokenMetaViaRPC', () => {
  it('returns the token that is read from the chain', async () => {
    const token = makeToken()
    makeRead(token)

    await expect(
      getTokenMetaViaRPC({
        provider,
        network: ETHEREUM,
        address: tokenAddress
      })
    ).resolves.toEqual(token)
  })

  it('reads only the requested token on the requested chain', async () => {
    const read = makeRead(makeToken())

    await getTokenMetaViaRPC({ provider, network: ETHEREUM, address: tokenAddress })

    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith({ provider, network: ETHEREUM, address: tokenAddress })
  })

  it('returns null when the address is not a token', async () => {
    makeRead(null)

    await expect(
      getTokenMetaViaRPC({
        provider,
        network: ETHEREUM,
        address: tokenAddress
      })
    ).resolves.toBeNull()
  })

  it('returns null for a token without a symbol', async () => {
    makeRead(makeToken({ symbol: '' }))

    await expect(
      getTokenMetaViaRPC({
        provider,
        network: ETHEREUM,
        address: tokenAddress
      })
    ).resolves.toBeNull()
  })

  it.each([blacklistedAddress, blacklistedAddress.toLowerCase()])(
    'returns null for the blacklisted address %s, without reading the chain',
    async (address) => {
      const read = makeRead(makeToken({ address }))

      await expect(getTokenMetaViaRPC({ provider, network: ETHEREUM, address })).resolves.toBeNull()
      expect(read).not.toHaveBeenCalled()
    }
  )

  it('does not apply the blacklist of another chain', async () => {
    const token = makeToken({ address: blacklistedAddress })
    makeRead(token)

    await expect(
      getTokenMetaViaRPC({
        provider,
        network: BASE,
        address: blacklistedAddress
      })
    ).resolves.toEqual(token)
  })

  it.each([
    ['symbol', { symbol: 'https://claim-now.example' }],
    ['name', { name: 'Visit www.claim-now.example' }]
  ])('returns null for a spam token by its %s', async (_, overrides) => {
    makeRead(makeToken(overrides))

    await expect(
      getTokenMetaViaRPC({
        provider,
        network: ETHEREUM,
        address: tokenAddress
      })
    ).resolves.toBeNull()
  })

  it('does not hide this error: a failed read rejects', async () => {
    jest.mocked(getTokenInfo).mockReset().mockRejectedValue(new Error('RPC unavailable'))

    await expect(
      getTokenMetaViaRPC({
        provider,
        network: ETHEREUM,
        address: tokenAddress
      })
    ).rejects.toThrow('RPC unavailable')
  })
})
