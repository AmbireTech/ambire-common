import { describe, expect, test } from '@jest/globals'

import { networks } from '../../../../consts/networks'
import { getRpcProvider } from '../../../../services/provider'
import { DEBANK_UNI_V3 } from '../../testData'
import { AssetType, Position, PositionsByProvider } from '../../types'
import { getUniV3Positions, mergeUniV3WithApiPositions } from './uniswapV3'

// If this test ever fails because the account removes its positions, you can:
// 1. Go to https://debank.com/protocols/matic_uniswap3/holders
// 2. Find an account that has the required positions and use it in the test
const userAddrUni = '0xbd67a10726e6d112295a698ea348f40d27fe5149'

const polygon = networks.find((n) => n.chainId === 137n)
if (!polygon) throw new Error('unable to find polygon network in consts')

const providerPolygon = getRpcProvider(['https://invictus.ambire.com/polygon'], 137n)

const apiUniV3 = DEBANK_UNI_V3[0]!
const firstApiPosition = apiUniV3.positions[0]!

const getRpcPosition = (positionIndex: string | undefined, inRange: boolean): Position => ({
  id: positionIndex || 'no-index',
  additionalData: {
    inRange,
    positionIndex,
    liquidity: 1000n,
    name: 'Liquidity Pool'
  },
  assets: [
    {
      address: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
      symbol: 'WPOL',
      name: 'Wrapped POL',
      decimals: 18,
      iconUrl: '',
      amount: 1n,
      type: AssetType.Liquidity
    }
  ]
})

const getRpcUniV3 = (positions: Position[]): PositionsByProvider => ({
  providerName: 'Uniswap V3',
  chainId: 137n,
  source: 'custom',
  iconUrl: '',
  siteUrl: 'https://app.uniswap.org/swap',
  type: 'common',
  positions
})

describe('Uniswap V3 positions read from the chain', () => {
  test('Get uni v3 positions on Polygon', async () => {
    const uniV3Positions = await getUniV3Positions(userAddrUni, providerPolygon, polygon)
    expect(uniV3Positions).not.toBeNull()

    if (uniV3Positions !== null) {
      const firstPos = uniV3Positions.positions[0]!
      expect(firstPos.additionalData.liquidity).toBeGreaterThan(0)
      expect(firstPos.assets.length).toBeGreaterThan(0)
    }
  })
  test('Uni V3 returns multiple positions', async () => {
    const uniV3Positions = await getUniV3Positions(userAddrUni, providerPolygon, polygon)

    expect(uniV3Positions?.positions.length).toBeGreaterThan(1)
  })
  test('returns null on a network Uniswap V3 is not supported on', async () => {
    const scroll = networks.find((n) => n.chainId === 534352n)
    if (!scroll) throw new Error('unable to find scroll network in consts')

    expect(await getUniV3Positions(userAddrUni, providerPolygon, scroll)).toBeNull()
  })
})

describe('mergeUniV3WithApiPositions', () => {
  test('keeps the API data of a position found in both and adds whether it is in range', () => {
    const rpcPositions = getRpcUniV3([
      getRpcPosition(firstApiPosition.additionalData.positionIndex, false)
    ])

    const merged = mergeUniV3WithApiPositions({ rpcPositions, apiPositions: apiUniV3 })
    const mergedPosition = merged.positions.find(
      (p) => p.additionalData.positionIndex === firstApiPosition.additionalData.positionIndex
    )!

    expect(merged.source).toBe('mixed')
    expect(merged.iconUrl).toBe(apiUniV3.iconUrl)
    expect(mergedPosition.id).toBe(firstApiPosition.id)
    expect(mergedPosition.assets).toEqual(firstApiPosition.assets)
    expect(mergedPosition.additionalData.inRange).toBe(false)
    expect(mergedPosition.additionalData.liquidity).toBe(1000n)
  })
  test('keeps the positions found only in the API or only on the chain', () => {
    const rpcPositions = getRpcUniV3([getRpcPosition('only-on-chain', true)])

    const merged = mergeUniV3WithApiPositions({ rpcPositions, apiPositions: apiUniV3 })
    const positionIndexes = merged.positions.map((p) => p.additionalData.positionIndex)

    expect(merged.positions).toHaveLength(apiUniV3.positions.length + 1)
    expect(positionIndexes).toContain('only-on-chain')
    apiUniV3.positions.forEach((apiPosition) => {
      expect(positionIndexes).toContain(apiPosition.additionalData.positionIndex)
    })
  })
  test('drops the positions without an index, as they cannot be matched', () => {
    const rpcPositions = getRpcUniV3([getRpcPosition(undefined, true)])

    const merged = mergeUniV3WithApiPositions({ rpcPositions, apiPositions: apiUniV3 })

    expect(merged.positions).toHaveLength(apiUniV3.positions.length)
    expect(merged.positions.some((p) => p.id === 'no-index')).toBe(false)
  })
  test('does not mutate the passed positions', () => {
    const rpcPositions = getRpcUniV3([
      getRpcPosition(firstApiPosition.additionalData.positionIndex, false)
    ])
    const apiPositions = structuredClone(apiUniV3)

    mergeUniV3WithApiPositions({ rpcPositions, apiPositions })

    expect(apiPositions).toEqual(apiUniV3)
  })
})
