import {
  decodeFunctionData,
  getAddress,
  isAddress,
  parseAbi,
  toFunctionSelector,
  zeroAddress
} from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel, getToken, isHexCall } from '../../utils'

const WRAPPED_ST_ETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'
const ST_ETH_ADDRESS = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'
const UNWRAP_CONTRACT_ADDR = '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1'

const wrapAbi = parseAbi(['function wrap(uint256 _stETHAmount) returns (uint256)'])
const unwrapAbi = parseAbi(['function unwrap(uint256 _wstETHAmount) returns (uint256)'])
const requestWithdrawalsAbi = parseAbi([
  'function requestWithdrawals(uint256[] _amounts, address _owner) returns (uint256[] requestIds)'
])
const claimWithdrawalsAbi = parseAbi([
  'function claimWithdrawals(uint256[] calldata _requestIds, uint256[] calldata _hints)'
])
const claimWithdrawalsToAbi = parseAbi([
  'function claimWithdrawalsTo(uint256[] calldata _requestIds, uint256[] calldata _hints, address _recipient)'
])
const claimWithdrawalAbi = parseAbi(['function claimWithdrawal(uint256 _requestId)'])
const submitAbi = parseAbi(['function submit(address _referral) payable returns (uint256)'])

export const LidoModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const newCalls = calls.map((call) => {
    if (!isHexCall(call)) return call

    if (call.to && isAddress(call.to) && getAddress(call.to) === WRAPPED_ST_ETH_ADDRESS) {
      if (call.data.startsWith(toFunctionSelector(wrapAbi[0]))) {
        const { args } = decodeFunctionData({ abi: wrapAbi, data: call.data })
        const [amount] = args
        const fullVisualization = [getAction('Wrap'), getToken(ST_ETH_ADDRESS, amount)]
        return { ...call, fullVisualization }
      }
      if (call.data.startsWith(toFunctionSelector(unwrapAbi[0]))) {
        const { args } = decodeFunctionData({ abi: unwrapAbi, data: call.data })
        const [amount] = args
        const fullVisualization = [getAction('Unwrap'), getToken(ST_ETH_ADDRESS, amount)]
        return { ...call, fullVisualization }
      }
    }

    if (call.to && isAddress(call.to) && getAddress(call.to) === UNWRAP_CONTRACT_ADDR) {
      if (call.data.startsWith(toFunctionSelector(requestWithdrawalsAbi[0]))) {
        const { args } = decodeFunctionData({
          abi: requestWithdrawalsAbi,
          data: call.data
        })
        const [_amounts, _owner] = args
        const amount = _amounts.reduce((acc: bigint, cur: bigint) => acc + cur, 0n)
        const fullVisualization = [getAction('Request withdraw'), getToken(ST_ETH_ADDRESS, amount)]
        if (![zeroAddress, accOp.accountAddr.toLowerCase()].includes(_owner.toLowerCase()))
          fullVisualization.push(getLabel('and authorize'), getAddressVisualization(_owner))
        return { ...call, fullVisualization }
      }

      if (call.data.startsWith(toFunctionSelector(claimWithdrawalsAbi[0]))) {
        return { ...call, fullVisualization: [getAction('Claim withdrawals')] }
      }
      if (call.data.startsWith(toFunctionSelector(claimWithdrawalAbi[0]))) {
        return { ...call, fullVisualization: [getAction('Claim withdrawal')] }
      }
      if (call.data.startsWith(toFunctionSelector(claimWithdrawalsToAbi[0]))) {
        const { args } = decodeFunctionData({
          abi: claimWithdrawalsToAbi,
          data: call.data
        })
        const [, , _recipient] = args
        const fullVisualization = [getAction('Claim withdrawal')]
        if (_recipient.toLowerCase() !== accOp.accountAddr.toLowerCase())
          fullVisualization.push(getLabel('and send to'), getAddressVisualization(_recipient))
        return { ...call, fullVisualization: [getAction('Claim withdrawal')] }
      }
    } else if (call.to && isAddress(call.to) && getAddress(call.to) === ST_ETH_ADDRESS) {
      if (call.data.startsWith(toFunctionSelector(submitAbi[0]))) {
        return {
          ...call,
          fullVisualization: [getAction('Stake'), getToken(ST_ETH_ADDRESS, call.value)]
        }
      }
    }
    return call
  })

  return newCalls
}
