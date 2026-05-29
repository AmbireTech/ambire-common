import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { HumanizerVisualization } from '../../interfaces'
import { HexIrCall, getAction, getLabel, getToken } from '../../utils'

const claimAbi = parseAbi([
  'function claim(uint256 totalRewardInTree, bytes32[] proof, uint256 toBurnBps, address stakingPool)'
])
const claimWithRootUpdateAbi = parseAbi([
  'function claimWithRootUpdate(uint256 totalRewardInTree, bytes32[] proof, uint256 toBurnBps, address stakingPool, bytes32 newRoot, bytes signature)'
])
const mintVestingAbi = parseAbi([
  'function mintVesting(address recipient, uint256 end, uint256 amountPerSecond)'
])

export const WALLETSupplyControllerMapping = (): {
  [key: string]: (arg1: HexIrCall) => HumanizerVisualization[]
} => {
  return {
    [toFunctionSelector(claimAbi[0])]: (call: HexIrCall): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({ abi: claimAbi, data: call.data })
      const [, , toBurnBps, stakingPool] = args
      const burnPercentage = Number(toBurnBps) / 100
      return burnPercentage > 0
        ? [
            getAction('Claim rewards'),
            getLabel(`with ${burnPercentage}% burn`),
            getLabel('in'),
            getToken(stakingPool, 0n)
          ]
        : [getAction('Claim rewards'), getLabel('in'), getToken(stakingPool, 0n)]
    },
    [toFunctionSelector(claimWithRootUpdateAbi[0])]: (
      call: HexIrCall
    ): HumanizerVisualization[] => {
      const { args } = decodeFunctionData({ abi: claimWithRootUpdateAbi, data: call.data })
      const [, , toBurnBps, stakingPool] = args
      const burnPercentage = Number(toBurnBps) / 100

      return burnPercentage > 0
        ? [
            getAction('Claim rewards'),
            getLabel(`with ${burnPercentage}% burn`),
            getLabel('in'),
            getToken(stakingPool, 0n)
          ]
        : [getAction('Claim rewards'), getLabel('in'), getToken(stakingPool, 0n)]
    },
    [toFunctionSelector(mintVestingAbi[0])]: (): HumanizerVisualization[] => {
      return [getAction('Claim vested tokens')]
    }
  }
}
