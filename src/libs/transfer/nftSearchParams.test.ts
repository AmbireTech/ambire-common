import { getNftParamsFromSearchParams } from './nftSearchParams'

const ADDRESS = '0x59468516a8259058baD1cA5F8f4BFF190d30E066'

describe('getNftParamsFromSearchParams', () => {
  test('should read the collection, chain and token id', () => {
    expect(
      getNftParamsFromSearchParams({ address: ADDRESS, chainId: '8453', tokenId: '42' })
    ).toEqual({ address: ADDRESS, chainId: 8453n, tokenId: 42n })
  })

  test('should accept token id 0', () => {
    expect(
      getNftParamsFromSearchParams({ address: ADDRESS, chainId: '1', tokenId: '0' })?.tokenId
    ).toBe(0n)
  })

  test('should keep token ids bigger than Number.MAX_SAFE_INTEGER exact', () => {
    const hugeTokenId = (2n ** 255n + 7n).toString()

    expect(
      getNftParamsFromSearchParams({ address: ADDRESS, chainId: '1', tokenId: hugeTokenId })
        ?.tokenId
    ).toBe(2n ** 255n + 7n)
  })

  test('should not treat a token route without a token id as an NFT', () => {
    expect(getNftParamsFromSearchParams({ address: ADDRESS, chainId: '1' })).toBeNull()
    expect(getNftParamsFromSearchParams(undefined)).toBeNull()
  })

  test.each([
    ['a non-numeric token id', { address: ADDRESS, chainId: '1', tokenId: 'abc' }],
    ['a negative token id', { address: ADDRESS, chainId: '1', tokenId: '-1' }],
    ['an empty token id', { address: ADDRESS, chainId: '1', tokenId: '' }],
    ['a blank token id', { address: ADDRESS, chainId: '1', tokenId: '  ' }],
    ['an invalid address', { address: '0x123', chainId: '1', tokenId: '1' }],
    ['a non-numeric chain id', { address: ADDRESS, chainId: 'mainnet', tokenId: '1' }],
    ['a zero chain id', { address: ADDRESS, chainId: '0', tokenId: '1' }]
  ])('should reject %s', (_, searchParams) => {
    expect(getNftParamsFromSearchParams(searchParams)).toBeNull()
  })
})
