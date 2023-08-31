/* eslint-disable @typescript-eslint/no-unused-vars */
import { ethers } from 'ethers'
// @TODO fix imports
import { HumanizerVisualization, IrCall } from '../../interfaces'
import { getAction, getLabel } from '../../utils'
import { AccountOp } from '../../../accountOp/accountOp'
import WALLETSupplyControllerABI from '../../../../../contracts/compiled/WALLETSupplyController.json'

// @TODO add abi to humanizer info
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const WALLETSupplyControllerMapping = (
  humanizerMeta: any
): { [key: string]: (arg0: AccountOp, arg1: IrCall) => HumanizerVisualization[] } => {
  const iface = new ethers.Interface(WALLETSupplyControllerABI)

  return {
    [`${iface.getFunction('claim')?.selector}`]: (
      accountop: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const { toBurnBps } = iface.parseTransaction(call)!.args
      const burnPercentage = toBurnBps.toString() / 100
      return burnPercentage > 0
        ? [getAction('Claim rewards'), getLabel(`with ${burnPercentage}% burn`)]
        : [getAction('Claim rewards')]
    },
    [`${iface.getFunction('claimWithRootUpdate')?.selector}`]: (
      accountop: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      const { toBurnBps } = iface.parseTransaction(call)!.args
      const burnPercentage = toBurnBps.toString() / 100

      return burnPercentage > 0
        ? [getAction('Claim rewards'), getLabel(`with ${burnPercentage}% burn`)]
        : [getAction('Claim rewards')]
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    [`${iface.getFunction('mintVesting')?.selector}`]: (
      accountop: AccountOp,
      call: IrCall
    ): HumanizerVisualization[] => {
      return [getAction('Claim vested tokens')]
    }
  }
}
