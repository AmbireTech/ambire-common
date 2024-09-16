import { Interface, ZeroHash } from 'ethers'

import AmbireAccount from '../../../../../contracts/compiled/AmbireAccount.json'
import { ENTRY_POINT_MARKER } from '../../../../consts/deploy'
import { AccountOp } from '../../../accountOp/accountOp'
import {
  HumanizerCallModule,
  HumanizerMeta,
  HumanizerVisualization,
  IrCall
} from '../../interfaces'
import { getAction, getAddressVisualization, getKnownName, getLabel } from '../../utils'

const iface = new Interface(AmbireAccount.abi)

const parsePrivilegeCall = (
  humanizerMeta: HumanizerMeta,
  call: IrCall
): HumanizerVisualization[] => {
  const { addr, priv } = iface.parseTransaction(call)!.args
  if (getKnownName(humanizerMeta, addr)?.includes('entry point') && priv === ENTRY_POINT_MARKER)
    return [getAction('Enable'), getAddressVisualization(addr)]
  if (priv === ZeroHash)
    return [getAction('Revoke access'), getLabel('of'), getAddressVisualization(addr)]
  return [
    getAction('Update access status'),
    getLabel('of'),
    getAddressVisualization(addr),
    getLabel('to'),
    priv === '0x0000000000000000000000000000000000000000000000000000000000000001'
      ? getLabel('regular access')
      : getLabel(priv)
  ]
}

export const privilegeHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  humanizerMeta: HumanizerMeta
) => {
  const newCalls = irCalls.map((call) => {
    if (call.data.slice(0, 10) === iface.getFunction('setAddrPrivilege')?.selector) {
      return {
        ...call,
        fullVisualization: parsePrivilegeCall(humanizerMeta, call)
      }
    }
    return call
  })
  return newCalls
}
