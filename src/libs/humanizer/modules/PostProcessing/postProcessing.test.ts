import { ZeroAddress } from 'ethers'

import { compareHumanizerVisualizations } from '../../testHelpers'
import { EMPTY_HUMANIZER_META, getAction, getToken } from '../../utils'
import { postProcessing } from './postProcessModule'

describe('postProcessing', () => {
  test('add hidden token hint', () => {
    const irCalls = [
      {
        to: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        data: '0xd0e30db0',
        value: 100n,
        fullVisualization: [getAction('Wrap'), getToken(ZeroAddress, 100n)]
      }
    ].map((c) => postProcessing({} as any, c, EMPTY_HUMANIZER_META))
    compareHumanizerVisualizations(irCalls, [[getAction('Wrap'), getToken(ZeroAddress, 100n)]])
  })
})
