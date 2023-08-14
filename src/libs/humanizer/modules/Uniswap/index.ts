import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerFragment, Ir, IrCall } from '../../interfaces'
import { uniUniversalRouter } from './uniUnivarsalRouter'
import { uniV2Mapping } from './uniV2'
import { uniV32Mapping, uniV3Mapping } from './uniV3'

export function uniswapHumanizer(
  accountOp: AccountOp,
  currentIr: Ir,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
): [Ir, Promise<HumanizerFragment>[]] {
  const matcher: { [x: string]: { [x: string]: (a: AccountOp, c: IrCall) => IrCall[] } } = {
    '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D': uniV2Mapping(accountOp.humanizerMeta),
    '0xE592427A0AEce92De3Edee1F18E0157C05861564': uniV3Mapping(accountOp.humanizerMeta),
    '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45': uniV32Mapping(accountOp.humanizerMeta),
    '0x4C60051384bd2d3C01bfc845Cf5F4b44bcbE9de5': uniUniversalRouter(accountOp.humanizerMeta)
  }
  const newCalls: IrCall[] = []
  currentIr.calls.forEach((call: IrCall) => {
    // check against sus contracts with same func selectors
    if (accountOp.humanizerMeta?.[`names:${call.to}`] === 'Uniswap') {
      const humanizedCalls = matcher?.[call.to]?.[call.data.substring(0, 10)](accountOp, call)
      humanizedCalls.forEach((hc: IrCall, index: number) =>
        // if multicall has value it shouldnt result in multiple calls with value
        index === 0 ? newCalls.push(hc) : newCalls.push({ ...hc, value: 0n })
      )
    } else {
      newCalls.push(call)
    }
  })
  const newIr = { calls: newCalls }
  return [newIr, []]
}
