import { AbiCoder, Contract, ethers, JsonRpcProvider } from 'ethers'

import { describe, expect, jest, test } from '@jest/globals'

import { networks } from '../../consts/networks'
import { getAAVEPositions } from './aaveV3'
import { Position } from './types'
import { getUniV3Positions } from './uniV3'

describe('Portfolio', () => {
  const userAddrUni = '0xC2E6dFcc2C6722866aD65F211D5757e1D2879337'
  const userAddrAave = '0x215f75a12A4934ae57deF7398EaeaFf87365F1Db'

  const optimism = networks.find((x) => x.id === 'optimism')
  if (!optimism) throw new Error('unable to find optimism network in consts')

  const polygon = networks.find((x) => x.id === 'polygon')
  if (!polygon) throw new Error('unable to find polygon network in consts')

  const providerOptimism = new JsonRpcProvider('https://invictus.ambire.com/optimism')
  const providerPolygon = new JsonRpcProvider('https://invictus.ambire.com/polygon')

  test(`get aave positions for ${userAddrAave} on Optimism`, async () => {
    const aavePositions: Position[] | null = await getAAVEPositions(
      userAddrAave,
      providerOptimism,
      optimism
    )

    expect(aavePositions).not.toBeNull()
    if (aavePositions !== null) {
      const pos1 = aavePositions[0]
      expect(pos1.additionalData.healthRate).toBeGreaterThan(1)
    }
  })

  test(`get uni v3 positions for ${userAddrUni} on Polygon`, async () => {
    const uniV3Positions: Position[] | null = await getUniV3Positions(
      userAddrUni,
      providerPolygon,
      polygon
    )
    expect(uniV3Positions).not.toBeNull()

    if (uniV3Positions !== null) {
      expect(uniV3Positions[0].additionalData.inRange).toBe(false)
    }
  })
})
