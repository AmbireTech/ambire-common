import { filterStaticBlacklistedAddrs } from './blacklist'

describe('portfolio blacklist', () => {
  it('filters static blacklisted addresses', () => {
    const blacklistedToken = '0x3231Cb76718CDeF2155FC47b5286d82e6eDA273f'
    const allowedToken = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'

    expect(filterStaticBlacklistedAddrs([blacklistedToken, allowedToken], 1n)).toEqual([
      allowedToken
    ])
  })
})
