import { Interface, ZeroHash } from 'ethers'

import AmbireAccount from '../../../../contracts/compiled/AmbireAccount.json'
import { ENTRY_POINT_MARKER } from '../../../consts/deploy'
import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerVisualization, IrCall } from '../interfaces'
import { getAction, getAddressVisualization, getKnownName, getLabel } from '../utils'

const iface = new Interface(AmbireAccount.abi)

const parsePriviligeCall = (accountOp: AccountOp, call: IrCall): HumanizerVisualization[] => {
  const { addr, priv } = iface.parseTransaction(call)!.args
  if (
    getKnownName(accountOp.humanizerMeta, addr)?.includes('entry point') &&
    priv === ENTRY_POINT_MARKER
  )
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const newCalls = irCalls.map((call) => {
    if (
      call.to === accountOp.accountAddr &&
      call.data.slice(0, 10) === iface.getFunction('setAddrPrivilege')?.selector &&
      call.to === accountOp.accountAddr
    ) {
      return {
        ...call,
        fullVisualization: parsePriviligeCall(accountOp, call)
      }
    }
    return call
  })
  return [newCalls, []]
}
