/* eslint-disable @typescript-eslint/no-unused-vars */
import { getAddress, Interface, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { SafeV2 } from '../../const/abis/Safe'
import { HumanizerCallModule, HumanizerVisualization, IrCall } from '../../interfaces'
import {
  eToNative,
  getAction,
  getAddressVisualization,
  getLabel,
  getRecipientText,
  getToken,
  uintToAddress
} from '../../utils'

const iface = new Interface(SafeV2)

const SafeModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]): IrCall[] => {
  const matcher = {
    [iface.getFunction(
      'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)'
    )?.selector!]: (call: IrCall): HumanizerVisualization[] | undefined => {
      if (!call.to) return
      if (call.value) return
      const {
        to,
        value,
        data,
        operation,
        safeTxGas,
        baseGas,
        gasPrice,
        gasToken,
        refundReceiver,
        signatures
      } = iface.parseTransaction(call)!.args

      if (operation === 1)
        return [
          getAction('Delegate control of Safe{Wallet} account', { warning: true }),
          getAddressVisualization(call.to),
          getLabel('to'),
          getAddressVisualization(to)
        ]
      const fullVisualization = [
        getAction('Execute a Safe{WALLET} transaction'),
        getLabel('from'),
        getAddressVisualization(call.to),
        getLabel('to'),
        getAddressVisualization(to)
      ]
      if (value)
        fullVisualization.push(
          ...[getLabel('and'), getAction('Send'), getToken(ZeroAddress, value)]
        )
      return fullVisualization
    }
  }
  const newCalls = calls.map((call) => {
    if (call.fullVisualization || !matcher[call.data.slice(0, 10)]) return call
    const fullVisualization = matcher[call.data.slice(0, 10)](call)
    if (!fullVisualization) return call
    return { ...call, fullVisualization }
  })

  return newCalls
}

export default SafeModule
