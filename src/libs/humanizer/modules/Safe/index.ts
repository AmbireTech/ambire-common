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
  getWarning,
  uintToAddress
} from '../../utils'

const iface = new Interface(SafeV2)

const SafeModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]): IrCall[] => {
  const matcher = {
    [iface.getFunction(
      'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)'
    )?.selector!]: (call: IrCall): IrCall | undefined => {
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

      if (operation === 1)
        return {
          ...call,
          fullVisualization,
          warnings: [
            getWarning(
              'Delegate call from Safe{WALLET} account',
              'SAFE{WALLET}_DELEGATE_CALL',
              'danger'
            )
          ]
        }
      return { ...call, fullVisualization }
    }
  }
  const newCalls = calls.map((call) => {
    if (call.fullVisualization || !matcher[call.data.slice(0, 10)]) return call
    const newCall = matcher[call.data.slice(0, 10)](call)
    if (!newCall) return call
    return newCall
  })

  return newCalls
}

export default SafeModule
