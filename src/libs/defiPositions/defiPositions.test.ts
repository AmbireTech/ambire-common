import { JsonRpcProvider } from 'ethers'

import { describe, expect, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { getAAVEPositions, getUniV3Positions } from './providers'

describe('DeFi positions', () => {
  const userAddrUni = '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337'
  const userAddrAave = '0x215f75a12A4934ae57deF7398EaeaFf87365F1Db'

  const optimism = networks.find((x) => x.id === 'optimism')
  if (!optimism) throw new Error('unable to find optimism network in consts')

  const polygon = networks.find((x) => x.id === 'polygon')
  if (!polygon) throw new Error('unable to find polygon network in consts')

  const providerOptimism = new JsonRpcProvider('https://invictus.ambire.com/optimism')
  const providerPolygon = new JsonRpcProvider('https://invictus.ambire.com/polygon')

  describe('Uni V3', () => {
    test('Get uni v3 positions on Polygon', async () => {
      const uniV3Positions = await getUniV3Positions(userAddrUni, providerPolygon, polygon)
      expect(uniV3Positions).not.toBeNull()

      if (uniV3Positions !== null) {
        const firstPos = uniV3Positions.positions[0]
        expect(firstPos.additionalData.inRange).toBe(false)
        expect(firstPos.additionalData.liquidity).toBeGreaterThan(0)
      }
    })
    test('Uni V3 returns multiple positions', async () => {
      const uniV3Positions = await getUniV3Positions(userAddrUni, providerPolygon, polygon)

      expect(uniV3Positions?.positions.length).toBeGreaterThan(1)
    })
  })
  describe('AAVE v3', () => {
    test('Get AAVE positions on Optimism', async () => {
      const aavePositions = await getAAVEPositions(userAddrAave, providerOptimism, optimism)

      expect(aavePositions).not.toBeNull()
      if (aavePositions !== null) {
        const pos1 = aavePositions.positions[0]
        expect(pos1.additionalData.healthRate).toBeGreaterThan(1)
      }
    })
    test('AAVE returns prices, health rate, additional date and asset value', async () => {
      const aavePositions = await getAAVEPositions(userAddrAave, providerOptimism, optimism)
      const pos = aavePositions?.positions[0]

      if (!pos) throw new Error('no positions found')

      expect(aavePositions?.positionInUSD).toBeGreaterThan(0)
      expect(pos.additionalData.positionInUSD).toBeGreaterThan(0)
      expect(pos.additionalData.healthRate).toBeGreaterThan(0)
      expect(pos.additionalData.collateralInUSD).toBeGreaterThan(0)
    })
  })
})
