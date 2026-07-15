import { MaxUint256 } from 'ethers'
import { decodeFunctionData, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getDeadline,
  getLabel,
  getOnBehalfOf,
  getToken,
  isHexCall
} from '../../utils'

// DAI predates EIP-2612, so its permit has no `value` param - only a boolean
// `allowed` that grants an unlimited allowance when true and revokes it when false
const daiPermitAbi = parseAbi([
  'function permit(address holder, address spender, uint256 nonce, uint256 expiry, bool allowed, uint8 v, bytes32 r, bytes32 s)'
])

const daiPermitModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]): IrCall[] =>
  calls.map((call) => {
    if (call.fullVisualization || !isHexCall(call) || !call.to) return call
    if (call.data.slice(0, 10) !== toFunctionSelector(daiPermitAbi[0])) return call

    const { args } = decodeFunctionData({ abi: daiPermitAbi, data: call.data })
    const [holder, spender, , expiry, allowed] = args

    if (!allowed)
      return {
        ...call,
        fullVisualization: [
          getAction('Revoke approval'),
          getToken(call.to, 0n),
          getLabel('for'),
          getAddressVisualization(spender),
          ...getOnBehalfOf(holder, accOp.accountAddr)
        ]
      }

    return {
      ...call,
      fullVisualization: [
        getAction('Grant approval'),
        getLabel('for'),
        getToken(call.to, MaxUint256),
        getLabel('to'),
        getAddressVisualization(spender),
        // an expiry of 0 means the permit never expires
        ...(expiry ? [getDeadline(expiry)] : []),
        ...getOnBehalfOf(holder, accOp.accountAddr)
      ]
    }
  })

export default daiPermitModule
