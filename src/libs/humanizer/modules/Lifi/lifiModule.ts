import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getLabel, getLegacyVisualization } from '../../utils'

const LIFI_ROUTER = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'

export const LifiModule: HumanizerCallModule = (accountOp: AccountOp, call: IrCall): IrCall => {
  if (call.to && call.to.toLowerCase() === LIFI_ROUTER.toLowerCase()) {
    return {
      ...call,
      fullVisualization: getLegacyVisualization([
        getAction('Swap/Bridge'),
        getLabel('with'),
        getAddressVisualization(call.to)
      ])
    }
  }
  return call
}
