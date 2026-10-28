import { describe, expect, it, jest } from '@jest/globals'

import { getTokenInfoFromChain } from './getTokenInfoFromChain'
import type { TokenError, TokenResult } from './interfaces'

const tokenAddress = '0x4d224452801ACEd8B2F0aebE155379bb5D594381'
// A statically blacklisted token on Ethereum (a duplicate of another token)
const blacklistedAddress = '0x3231Cb76718CDeF2155FC47b5286d82e6eDA273f'

const makeToken = (overrides: Partial<TokenResult> = {}) =>
  ({
    address: tokenAddress,
    chainId: 1n,
    symbol: 'APE',
    name: 'ApeCoin',
    decimals: 18,
    amount: 0n,
    priceIn: [],
    marketDataIn: [],
    ...overrides
  }) as TokenResult

type GetTokensInfo = (chainId: bigint, tokenAddrs: string[]) => Promise<[TokenError, TokenResult][]>

const makeRead = (result: [TokenError, TokenResult][]) =>
  jest.fn<GetTokensInfo>().mockResolvedValue(result)

describe('getTokenInfoFromChain', () => {
  it('returns the token that is read from the chain', async () => {
    const token = makeToken()
    const getTokensInfo = makeRead([['0x', token]])

    await expect(
      getTokenInfoFromChain({
        getTokensInfo,
        chainId: 1n,
        address: tokenAddress
      })
    ).resolves.toEqual(token)
  })

  it('reads only the requested token on the requested chain', async () => {
    const getTokensInfo = makeRead([['0x', makeToken()]])

    await getTokenInfoFromChain({ getTokensInfo, chainId: 1n, address: tokenAddress })

    expect(getTokensInfo).toHaveBeenCalledTimes(1)
    expect(getTokensInfo).toHaveBeenCalledWith(1n, [tokenAddress])
  })

  it('returns null when the address is not a token', async () => {
    const getTokensInfo = makeRead([
      ['0x756e6b6e', makeToken({ symbol: '', name: '', decimals: 0 })]
    ])

    await expect(
      getTokenInfoFromChain({
        getTokensInfo,
        chainId: 1n,
        address: tokenAddress
      })
    ).resolves.toBeNull()
  })

  it('returns null when the read gives no result', async () => {
    const getTokensInfo = makeRead([])

    await expect(
      getTokenInfoFromChain({
        getTokensInfo,
        chainId: 1n,
        address: tokenAddress
      })
    ).resolves.toBeNull()
  })

  it('returns null for a token without a symbol', async () => {
    const getTokensInfo = makeRead([['0x', makeToken({ symbol: '' })]])

    await expect(
      getTokenInfoFromChain({
        getTokensInfo,
        chainId: 1n,
        address: tokenAddress
      })
    ).resolves.toBeNull()
  })

  it.each([blacklistedAddress, blacklistedAddress.toLowerCase()])(
    'returns null for the blacklisted address %s, without reading the chain',
    async (address) => {
      const getTokensInfo = makeRead([['0x', makeToken({ address })]])

      await expect(
        getTokenInfoFromChain({ getTokensInfo, chainId: 1n, address })
      ).resolves.toBeNull()
      expect(getTokensInfo).not.toHaveBeenCalled()
    }
  )

  it('does not apply the blacklist of another chain', async () => {
    const token = makeToken({ address: blacklistedAddress })
    const getTokensInfo = makeRead([['0x', token]])

    await expect(
      getTokenInfoFromChain({
        getTokensInfo,
        chainId: 8453n,
        address: blacklistedAddress
      })
    ).resolves.toEqual(token)
  })

  it.each([
    ['symbol', { symbol: 'https://claim-now.example' }],
    ['name', { name: 'Visit www.claim-now.example' }]
  ])('returns null for a spam token by its %s', async (_, overrides) => {
    const getTokensInfo = makeRead([['0x', makeToken(overrides)]])

    await expect(
      getTokenInfoFromChain({
        getTokensInfo,
        chainId: 1n,
        address: tokenAddress
      })
    ).resolves.toBeNull()
  })

  it('does not hide this error: a failed read rejects', async () => {
    const getTokensInfo = jest.fn<GetTokensInfo>().mockRejectedValue(new Error('RPC unavailable'))

    await expect(
      getTokenInfoFromChain({
        getTokensInfo,
        chainId: 1n,
        address: tokenAddress
      })
    ).rejects.toThrow('RPC unavailable')
  })
})
