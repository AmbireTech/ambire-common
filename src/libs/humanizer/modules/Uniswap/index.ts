import { AccountOp } from '../../../accountOp/accountOp'
import { Ir, IrCall } from '../../interfaces'
import { uniUniversalRouter } from './uniUnivarsalRouter'
import { uniV2Mapping } from './uniV2'
import { uniV32Mapping, uniV3Mappinig } from './uniV3'

export function uniswapHumanizer(
  accountOp: AccountOp,
  currentIr: Ir,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
): [Ir, Promise<any>[]] {
  // @TODO: Unify using imported abis vs abis from accountOp
  const matcher = {
    ...uniV2Mapping(accountOp.humanizerMeta),
    ...uniV3Mappinig(accountOp.humanizerMeta),
    ...uniV32Mapping(accountOp.humanizerMeta),
    ...uniUniversalRouter(accountOp.humanizerMeta)
  }
  const newCalls = currentIr.calls.map((call: IrCall) => {
    // check against sus contracts with same func selectors
    return accountOp.humanizerMeta?.[`names:${call.to}`] === 'Uniswap'
      ? { ...call, fullVisualization: matcher[call.data.substring(0, 10)](accountOp, call) }
      : call
  })
  const newIr = { calls: newCalls }
  return [newIr, []]
}
