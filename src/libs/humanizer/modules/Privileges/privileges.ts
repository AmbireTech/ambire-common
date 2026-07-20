import { decodeFunctionData, parseAbi, toFunctionSelector, zeroHash } from 'viem'

import { ENTRY_POINT_MARKER } from '../../../../consts/deploy'
import { AccountOp } from '../../../accountOp/accountOp'
import {
  HumanizerCallModule,
  HumanizerMeta,
  HumanizerVisualization,
  IrCall
} from '../../interfaces'
import {
  HexIrCall,
  getAction,
  getAddressVisualization,
  getKnownName,
  getLabel,
  isHexCall
} from '../../utils'

const setAddrPrivilegeAbi = parseAbi([
  'function setAddrPrivilege(address addr, bytes32 priv) payable'
])

const parsePrivilegeCall = (
  humanizerMeta: HumanizerMeta,
  call: HexIrCall
): HumanizerVisualization[] => {
  const { args } = decodeFunctionData({ abi: setAddrPrivilegeAbi, data: call.data })
  const [addr, priv] = args
  if (getKnownName(humanizerMeta, addr)?.includes('entry point') && priv === ENTRY_POINT_MARKER)
    return [getAction('Enable'), getAddressVisualization(addr)]
  if (priv === zeroHash)
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
  call: IrCall,
  humanizerMeta?: HumanizerMeta
) => {
  // humanizerMeta should be always provided
  if (!humanizerMeta) return call

  if (isHexCall(call) && call.data.slice(0, 10) === toFunctionSelector(setAddrPrivilegeAbi[0])) {
    return {
      ...call,
      fullVisualization: parsePrivilegeCall(humanizerMeta, call)
    }
  }
  return call
}
