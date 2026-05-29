import { Interface } from 'ethers'

import WALLETSupplyControllerABI from '../../../../../contracts/compiled/WALLETSupplyController.json'
import { HumanizerVisualization, IrCall } from '../../interfaces'
import { getAction, getLabel, getToken } from '../../utils'

export const WALLETSupplyControllerMapping = (): {
  [key: string]: (arg1: IrCall) => HumanizerVisualization[]
} => {
  const iface = new Interface(WALLETSupplyControllerABI)

  return {
    [iface.getFunction('claim')?.selector!]: (call: IrCall): HumanizerVisualization[] => {
      const { toBurnBps, stakingPool } = iface.parseTransaction(call)!.args
      const burnPercentage = toBurnBps.toString() / 100
      return burnPercentage > 0
        ? [
            getAction('Claim rewards'),
            getLabel(`with ${burnPercentage}% burn`),
            getLabel('in'),
            getToken(stakingPool, 0n)
          ]
        : [getAction('Claim rewards'), getLabel('in'), getToken(stakingPool, 0n)]
    },
    [iface.getFunction('claimWithRootUpdate')?.selector!]: (
      call: IrCall
    ): HumanizerVisualization[] => {
      const { toBurnBps, stakingPool } = iface.parseTransaction(call)!.args
      const burnPercentage = toBurnBps.toString() / 100

      return burnPercentage > 0
        ? [
            getAction('Claim rewards'),
            getLabel(`with ${burnPercentage}% burn`),
            getLabel('in'),
            getToken(stakingPool, 0n)
          ]
        : [getAction('Claim rewards'), getLabel('in'), getToken(stakingPool, 0n)]
    },

    [iface.getFunction('mintVesting')?.selector!]: (): HumanizerVisualization[] => {
      return [getAction('Claim vested tokens')]
    }
  }
}
