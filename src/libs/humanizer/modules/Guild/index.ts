import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { HexIrCall, getAction, getLabel, isHexCall } from '../../utils'

const claimAbi = parseAbi([
  'function claim((address receiver, uint8 guildAction, uint256 userId, uint256 guildId, string guildName, uint256 createdAt) pinData, address adminTreasury, uint256 adminFee, uint256 signedAt, string cid, bytes signature) payable'
])

const GuildModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const matcher = {
    [toFunctionSelector(claimAbi[0])]: (call: HexIrCall) => {
      const { args } = decodeFunctionData({ abi: claimAbi, data: call.data })
      const [pinData] = args
      return [getAction('Claim Guild badge'), getLabel('for'), getLabel(pinData.guildName, true)]
    }
  }
  const newCalls = calls.map((call) => {
    const match = matcher[call.data.slice(0, 10)]
    if (call.fullVisualization || !isHexCall(call) || !match) return call
    return { ...call, fullVisualization: match(call) }
  })

  return newCalls
}

export default GuildModule
