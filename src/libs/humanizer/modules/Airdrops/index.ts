import { Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getToken } from '../../utils'

const iface = new Interface([
  'function claimTokens(uint256 index, uint256 amount, bytes32[] merkleProof)'
])
const WTC_TOKEN_ADDRESS = '0xeF4461891DfB3AC8572cCf7C794664A8DD927945'

export const airdropsModule: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[]
) => {
  const matcher = {
    [iface.getFunction('claimTokens')!.selector]: (call: IrCall): IrCall => {
      if (call.to !== '0x4ee97a759AACa2EdF9c1445223b6Cd17c2eD3fb4') return call
      const { amount } = iface.parseTransaction(call)!.args
      const fullVisualization = [getAction('Claim'), getToken(WTC_TOKEN_ADDRESS, amount)]
      return { ...call, fullVisualization }
    }
  }
  return currentIrCalls.map((call) =>
    matcher[call.data.slice(0, 10)] ? matcher[call.data.slice(0, 10)](call) : call
  )
}
