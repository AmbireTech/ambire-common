import { ethers } from 'ethers'
import { HumanizerFragment, Ir } from '../interfaces'
import { AccountOp } from '../../accountOp/accountOp'
import { getAction, getToken } from '../utils'

const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

export const wethHumanizer = (
  accountOp: AccountOp,
  ir: Ir,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
): [Ir, Array<Promise<HumanizerFragment>>] => {
  const newCalls = ir.calls.map((call) => {
    return call.data.slice(0, 10) === '0xd0e30db0' && call.to === WETH_ADDRESS
      ? {
          ...call,
          fullVisualization: [getAction('Wrap'), getToken(ethers.ZeroAddress, call.value)]
        }
      : call
  })
  const newIr: Ir = { calls: newCalls }
  return [newIr, []]
}
