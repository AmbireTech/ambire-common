import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { STK_WALLET } from '../../../../consts/addresses'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { HexIrCall, getAction, getToken, isHexCall } from '../../utils'

const claimTokensAbi = parseAbi([
  'function claimTokens(uint256 index, uint256 amount, bytes32[] merkleProof)'
])
const claimAbi = parseAbi([
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
    [toFunctionSelector(claimTokensAbi[0])]: (call: HexIrCall): IrCall => {
      if (call.to !== '0x4ee97a759AACa2EdF9c1445223b6Cd17c2eD3fb4') return call
      const { args } = decodeFunctionData({ abi: claimTokensAbi, data: call.data })
      const [, amount] = args
      const fullVisualization = [getAction('Claim'), getToken(WTC_TOKEN_ADDRESS, amount)]
      return { ...call, fullVisualization }
    },
    [toFunctionSelector(claimAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({ abi: claimAbi, data: call.data })
      const [, , amount] = args
      if (!call.to) return call
      if (!distributors[call.to]) return call
      return { ...call, fullVisualization: [getAction('Claim'), getToken(STK_WALLET, amount)] }
    }
  }
  return currentIrCalls.map((call) => {
    if (!isHexCall(call)) return call
    const selectedParser = matcher[call.data.slice(0, 10)]
    if (!selectedParser) return call
    return selectedParser(call)
  })
}
