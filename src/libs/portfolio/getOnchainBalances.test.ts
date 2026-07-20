import { describe, expect, test } from '@jest/globals'

import { DEPLOYLESS_SIMULATION_FROM } from '../../consts/deploy'
import { networks } from '../../consts/networks'
import { DeploylessMode } from '../deployless/deployless'
import { getDeploylessOpts } from './getOnchainBalances'

describe('getDeploylessOpts', () => {
  test('uses explicit deployless contract options before simulation state override options', () => {
    const network = networks.find(({ chainId }) => chainId === 1n)!
    const verifierTo = '0x3f58D86408988FBD8aeEA5AD063173F249f5B214'

    expect(
      getDeploylessOpts('0x0000000000000000000000000000000000000001', network, {
        blockTag: 123,
        deployless: {
          mode: DeploylessMode.Predeployed,
          to: verifierTo
        },
        simulation: {} as any
      })
    ).toEqual({
      blockTag: 123,
      from: DEPLOYLESS_SIMULATION_FROM,
      mode: DeploylessMode.Predeployed,
      to: verifierTo,
      stateToOverride: null
    })
  })
})
