import { describe, expect, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { getRpcProvider } from '../../services/provider'
import { getTokenInfo } from './getTokenInfo'

const ETHEREUM = networks.find(({ chainId }) => chainId === 1n)!
const APE = '0x4d224452801ACEd8B2F0aebE155379bb5D594381'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
// Not a token: the CoW Swap settlement contract
const NOT_A_TOKEN = '0x9008D19f58AAbD9eD0D60971565AA8510560ab41'
// Not a contract at all
const EOA = '0x0000000000000000000000000000000000000001'

// These tests use a real RPC
describe('getTokenInfo', () => {
  const provider = getRpcProvider(ETHEREUM.rpcUrls, ETHEREUM.chainId)

  test.each([
    [APE, { name: 'ApeCoin', symbol: 'APE', decimals: 18 }],
    // The metadata of this one is in the contract code, not in the storage
    [WETH, { name: 'Wrapped Ether', symbol: 'WETH', decimals: 18 }]
  ])('reads the info of the token %s', async (address, expected) => {
    await expect(getTokenInfo({ provider, network: ETHEREUM, address })).resolves.toEqual({
      address,
      ...expected
    })
  })

  test.each([NOT_A_TOKEN, EOA])('returns null for %s, which is not a token', async (address) => {
    await expect(getTokenInfo({ provider, network: ETHEREUM, address })).resolves.toBeNull()
  })

  test('reads the info without state override too', async () => {
    const network = { ...ETHEREUM, rpcNoStateOverride: true }

    await expect(getTokenInfo({ provider, network, address: APE })).resolves.toMatchObject({
      symbol: 'APE',
      decimals: 18
    })
  })
})
