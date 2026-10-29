import { describe, expect, it, jest } from '@jest/globals'

import type { TokenInfo } from './getTokenInfo'
import { getTokenInfoFromChain } from './getTokenInfoFromChain'

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

type GetTokenInfo = (chainId: bigint, address: string) => Promise<TokenInfo | null>

const makeRead = (result: TokenInfo | null) => jest.fn<GetTokenInfo>().mockResolvedValue(result)

describe('getTokenInfoFromChain', () => {
  it('returns the token that is read from the chain', async () => {
    const token = makeToken()
    const getTokenInfo = makeRead(token)

    await expect(
      getTokenInfoFromChain({
        getTokenInfo,
        chainId: 1n,
        address: tokenAddress
      })
    ).resolves.toEqual(token)
  })

  it('reads only the requested token on the requested chain', async () => {
    const getTokenInfo = makeRead(makeToken())

    await getTokenInfoFromChain({ getTokenInfo, chainId: 1n, address: tokenAddress })

    expect(getTokenInfo).toHaveBeenCalledTimes(1)
    expect(getTokenInfo).toHaveBeenCalledWith(1n, tokenAddress)
  })

  it('returns null when the address is not a token', async () => {
    const getTokenInfo = makeRead(null)

    await expect(
      getTokenInfoFromChain({
        getTokenInfo,
        chainId: 1n,
        address: tokenAddress
      })
    ).resolves.toBeNull()
  })

  it('returns null for a token without a symbol', async () => {
    const getTokenInfo = makeRead(makeToken({ symbol: '' }))

    await expect(
      getTokenInfoFromChain({
        getTokenInfo,
        chainId: 1n,
        address: tokenAddress
      })
    ).resolves.toBeNull()
  })

  it.each([blacklistedAddress, blacklistedAddress.toLowerCase()])(
    'returns null for the blacklisted address %s, without reading the chain',
    async (address) => {
      const getTokenInfo = makeRead(makeToken({ address }))

      await expect(
        getTokenInfoFromChain({ getTokenInfo, chainId: 1n, address })
      ).resolves.toBeNull()
      expect(getTokenInfo).not.toHaveBeenCalled()
    }
  )

  it('does not apply the blacklist of another chain', async () => {
    const token = makeToken({ address: blacklistedAddress })
    const getTokenInfo = makeRead(token)

    await expect(
      getTokenInfoFromChain({
        getTokenInfo,
        chainId: 8453n,
        address: blacklistedAddress
      })
    ).resolves.toEqual(token)
  })

  it.each([
    ['symbol', { symbol: 'https://claim-now.example' }],
    ['name', { name: 'Visit www.claim-now.example' }]
  ])('returns null for a spam token by its %s', async (_, overrides) => {
    const getTokenInfo = makeRead(makeToken(overrides))

    await expect(
      getTokenInfoFromChain({
        getTokenInfo,
        chainId: 1n,
        address: tokenAddress
      })
    ).resolves.toBeNull()
  })

  it('does not hide this error: a failed read rejects', async () => {
    const getTokenInfo = jest.fn<GetTokenInfo>().mockRejectedValue(new Error('RPC unavailable'))

    await expect(
      getTokenInfoFromChain({
        getTokenInfo,
        chainId: 1n,
        address: tokenAddress
      })
    ).rejects.toThrow('RPC unavailable')
  })
})
