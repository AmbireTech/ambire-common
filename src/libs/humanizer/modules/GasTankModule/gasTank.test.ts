import { ZeroAddress } from 'ethers'

import { describe } from '@jest/globals'

import humanizerInfo from '../../../../consts/humanizer/humanizerInfo.json'
import { HumanizerMeta, HumanizerVisualization, IrCall } from '../../interfaces'
import { compareHumanizerVisualizations } from '../../testHelpers'
import { getAction, getToken } from '../../utils'
import { genericErc20Humanizer } from '../Tokens'
import { gasTankModule } from './gasTankModule'

const txns: IrCall[] = [
  {
    to: '0x942f9CE5D9a33a82F88D233AEb3292E680230348',
    data: '0x0000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000e82193189bbc500000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000767617354616e6b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006574d415449430000000000000000000000000000000000000000000000000000',
    value: 0n
  },
  { to: '0x942f9CE5D9a33a82F88D233AEb3292E680230348', value: 10n ** 18n, data: '0x' },
  {
    to: '0x88800092fF476844f74dC2FC427974BBee2794Ae',
    value: 0n,
    data: '0xa9059cbb000000000000000000000000942f9ce5d9a33a82f88d233aeb3292e68023034800000000000000000000000000000000000000000000005dd2a2dad529a00000'
  }
]

describe('gasTank', () => {
  test('basic', () => {
    const expectedVisualizations: HumanizerVisualization[][] = [
      [getAction('Pay fee with gas tank')],
      [getAction('Fuel gas tank with'), getToken(ZeroAddress, 10n ** 18n)],
      [
        getAction('Fuel gas tank with'),
        getToken('0x88800092fF476844f74dC2FC427974BBee2794Ae', 1730725133158241533952n)
      ]
    ]
    let irCalls = genericErc20Humanizer({} as any, txns, humanizerInfo as HumanizerMeta)
    irCalls = gasTankModule({} as any, irCalls, humanizerInfo as HumanizerMeta)
    compareHumanizerVisualizations(irCalls, expectedVisualizations)
  })
})
