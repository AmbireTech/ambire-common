import { ethers } from 'ethers'
import { AccountOp } from '../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../interfaces'
import { getAction, getLabel, getAddress } from '../utils'
import AmbireAccount from '../../../../contracts/compiled/AmbireAccount.json'
import { ENTRY_POINT_MARKER } from '../../../consts/deploy'

const iface = new ethers.Interface(AmbireAccount.abi)

export const privilegeHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const matcher = {
    [iface.getFunction('setAddrPrivilege')?.selector!]: (accounutOp: AccountOp, call: IrCall) => {
      const { addr, priv } = iface.parseTransaction(call)!.args
      if (
        accountOp.humanizerMeta?.[`names:${addr}`]?.includes('Entry Point') &&
        priv === ENTRY_POINT_MARKER
      )
        return [getAction('Enable'), getAddress(addr)]
      if (priv === ethers.ZeroHash)
        return [getAction('Revoke access'), getLabel('of'), getAddress(addr)]
      return [
        getAction('Update access status'),
        getLabel('of'),
        getAddress(addr),
        getLabel('to'),
        priv === '0x0000000000000000000000000000000000000000000000000000000000000001'
          ? getLabel('regular access')
          : getLabel(priv)
      ]
    }
  }
  const newCalls = irCalls.map((call) => {
    // @NOTE should we check if call.to == accountOp.accountAddr
    const sigHash = call.data.slice(0, 10)

    if (call.to === accountOp.accountAddr && matcher[sigHash]) {
      return {
        ...call,
        fullVisualization: matcher[sigHash](accountOp, call)
      }
    }
    return call
  })
  return [newCalls, []]
}
