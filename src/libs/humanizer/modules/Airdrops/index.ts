import { Interface } from 'ethers'

import { STK_WALLET } from '../../../../consts/addresses'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getToken } from '../../utils'

const iface = new Interface([
  'function claimTokens(uint256 index, uint256 amount, bytes32[] merkleProof)',
  'function claim(uint256 index, address account, uint256 amount, bytes32[] calldata merkleProof)'
])
const MERKLE_DISTRIBUTOR_S1 = '0x71Cfc1Be4AEE4941C58ceF02069f19eE291C0aC3'

const distributors: { [distributor: string]: string } = {
  [MERKLE_DISTRIBUTOR_S1]: STK_WALLET
}
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
    },
    [iface.getFunction('claim')?.selector!]: (call: IrCall) => {
      const { amount } = iface.parseTransaction(call)!.args
      if (!call.to) return call
      if (!distributors[call.to]) return call
      return { ...call, fullVisualization: [getAction('Claim'), getToken(STK_WALLET, amount)] }
    }
  }
  return currentIrCalls.map((call) => {
    const selectedParser = matcher[call.data.slice(0, 10)]
    if (!selectedParser) return call
    return selectedParser(call)
  })
}
