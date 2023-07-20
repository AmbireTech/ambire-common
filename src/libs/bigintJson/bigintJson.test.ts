import { describe, expect } from '@jest/globals'
import { parse, stringify } from './bigintJson'

describe('bigintJson', () => {
  it('stringify/parse bigint object values', async () => {
    expect(parse(stringify({ num: 1n }))).toEqual({ num: 1n })
  })

  it('stringify/parse bigint object array values', async () => {
    expect(parse(stringify({ num: [1n, 2n, 3n] }))).toEqual({ num: [1n, 2n, 3n] })
  })

  it("it doesn't cast integer numbers to bigint", async () => {
    expect(parse(stringify({ num: 1 }))).toEqual({ num: 1 })
  })

  it('has not a performance overhead', async () => {
    // We are creating a relatively large data object to test performance.
    // In a real-world scenario, the data would be much smaller.
    const bigData = Array.from(Array(1000).keys()).reduce((data: any, current) => {
      const accountOp: any = {
        accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
        signingKeyAddr: '0xe5a4Dad2Ea987215460379Ab285DF87136E83BEA',
        gasLimit: null,
        gasFeePayment: null,
        networkId: 'ethereum',
        nonce: 6,
        signature: '0x000000000000000000000000e5a4Dad2Ea987215460379Ab285DF87136E83BEA03',
        calls: [
          {
            to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            value: BigInt(500),
            data: '0xa9059cbb000000000000000000000000e5a4dad2ea987215460379ab285df87136e83bea00000000000000000000000000000000000000000000000000000000005040aa'
          }
        ]
      }

      // eslint-disable-next-line no-param-reassign
      data[`account-${current}`] = {
        accountAddr: '0x77777777789A8BBEE6C64381e5E89E501fb0e4c8',
        accountOp,
        tokenBalances: [BigInt(100), BigInt(1000), BigInt(300), BigInt(250), BigInt(1000)]
      }

      return data
    }, {})

    const start = Date.now()

    parse(stringify(bigData))

    const end = Date.now()

    // For 1k items, we expect no more of 50ms overhead
    expect(end - start).toBeLessThan(50)
  })
})
