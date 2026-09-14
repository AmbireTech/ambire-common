import { getAddress, isAddress, parseAbi, toFunctionSelector } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getLabel } from '../../utils'

const pledgeAbi = parseAbi(['function pledge()'])

const TrustlessManifestoModule: HumanizerCallModule = (accOp: AccountOp, call: IrCall) => {
  if (
    call.data &&
    call.data.startsWith(toFunctionSelector(pledgeAbi[0])) &&
    call.to &&
    isAddress(call.to) &&
    getAddress(call.to) === '0x32AA964746ba2be65C71fe4A5cB3c4a023cA3e20'
  )
    return {
      ...call,
      fullVisualization: [
        getAction('Sign'),
        getLabel('the'),
        getLabel('Trustless Manifesto Pledge', true)
      ]
    }
  return call
}

export default TrustlessManifestoModule
