import { getAddress, Interface } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel } from '../../utils'

const ENS_CONTROLLER = '0x253553366Da8546fC250F225fe3d25d0C782303b'

const iface = new Interface([
  'function register(string name,address owner, uint256 duration, bytes32 secret, address resolver, bytes[] data, bool reverseRecord, uint16 ownerControlledFuses)',
  'function commit(bytes32)'
])

export const ensModule: HumanizerCallModule = (
  accountOp: AccountOp,
  irCalls: IrCall[]
  // humanizerMeta: HumanizerMeta
) => {
  return irCalls.map((call) => {
    if (getAddress(call.to) === ENS_CONTROLLER) {
      if (call.data.slice(0, 10) === iface.getFunction('register')!.selector) {
        const {
          name,
          owner,
          duration
          // secret,
          // resolver,
          // data,
          // reverseRecord,
          // ownerControlledFuses
        } = iface.decodeFunctionData('register', call.data)
        const fullVisualization = [getAction('Register'), getLabel(`${name}.ens`, true)]

        if (owner !== accountOp.accountAddr)
          fullVisualization.push(getLabel('to'), getAddressVisualization(owner))
        const durationInYears = parseFloat((Number(duration / 60n / 60n / 24n) / 365).toFixed(2))
        fullVisualization.push(getLabel('for'), getLabel(`${durationInYears} years`, true))

        return { ...call, fullVisualization }
      }
      if (call.data.slice(0, 10) === iface.getFunction('commit')!.selector) {
        return {
          ...call,
          fullVisualization: [getAction('Request'), getLabel('to register an ENS record')]
        }
      }
    }
    return call
  })
}
