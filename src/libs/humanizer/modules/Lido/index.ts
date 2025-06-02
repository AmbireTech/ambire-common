import { getAddress, Interface, isAddress, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { stETH, unstETH, WrappedStETH } from '../../const/abis/Lido'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel, getToken } from '../../utils'

const WRAPPED_ST_ETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'
const ST_ETH_ADDRESS = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'
const UNWRAP_CONTRACT_ADDR = '0x889edC2eDab5f40e902b864aD4d7AdE8E412F9B1'
const wrapIface = new Interface(WrappedStETH)
const unwrapIface = new Interface(unstETH)
const stethIface = new Interface(stETH)
export const LidoModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const newCalls = calls.map((call) => {
    if (isAddress(call.to) && getAddress(call.to) === WRAPPED_ST_ETH_ADDRESS) {
      if (call.data.startsWith(wrapIface.getFunction('wrap(uint256)')!.selector)) {
        const [amount] = wrapIface.parseTransaction(call)!.args
        const fullVisualization = [getAction('Wrap'), getToken(ST_ETH_ADDRESS, amount)]
        return { ...call, fullVisualization }
      }
      if (call.data.startsWith(wrapIface.getFunction('unwrap(uint256)')!.selector)) {
        const [amount] = wrapIface.parseTransaction(call)!.args
        const fullVisualization = [getAction('Unwrap'), getToken(ST_ETH_ADDRESS, amount)]
        return { ...call, fullVisualization }
      }
    }

    if (isAddress(call.to) && getAddress(call.to) === UNWRAP_CONTRACT_ADDR) {
      if (call.data.startsWith(unwrapIface.getFunction('requestWithdrawals')!.selector)) {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const { _amounts, _owner } = unwrapIface.parseTransaction(call)!.args
        const amount = _amounts.reduce((acc: bigint, cur: bigint) => acc + cur, 0n)
        const fullVisualization = [getAction('Request withdraw'), getToken(ST_ETH_ADDRESS, amount)]
        if (![ZeroAddress, accOp.accountAddr.toLowerCase()].includes(_owner.toLowerCase()))
          fullVisualization.push(getLabel('and authorize'), getAddressVisualization(_owner))
        return { ...call, fullVisualization }
      }

      if (call.data.startsWith(unwrapIface.getFunction('claimWithdrawals')!.selector)) {
        return { ...call, fullVisualization: [getAction('Claim withdrawals')] }
      }
      if (call.data.startsWith(unwrapIface.getFunction('claimWithdrawal')!.selector)) {
        return { ...call, fullVisualization: [getAction('Claim withdrawal')] }
      }
      if (call.data.startsWith(unwrapIface.getFunction('claimWithdrawalsTo')!.selector)) {
        // eslint-disable-next-line @typescript-eslint/naming-convention, @typescript-eslint/no-unused-vars
        const { _requestIds, _hints, _recipient } = unwrapIface.parseTransaction(call)!.args
        const fullVisualization = [getAction('Claim withdrawal')]
        if (_recipient.toLowerCase() !== accOp.accountAddr.toLowerCase())
          fullVisualization.push(getLabel('and send to'), getAddressVisualization(_recipient))
        return { ...call, fullVisualization: [getAction('Claim withdrawal')] }
      }
    } else if (isAddress(call.to) && getAddress(call.to) === ST_ETH_ADDRESS) {
      if (call.data.startsWith(stethIface.getFunction('submit')!.selector)) {
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
