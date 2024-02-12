import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getUnknownVisualization } from '../../utils'
import { uniUniversalRouter } from './uniUnivarsalRouter'
import { uniV2Mapping } from './uniV2'
import { uniV32Mapping, uniV3Mapping } from './uniV3'

export const uniswapHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[],
  options?: any
) => {
  const matcher: {
    [address: string]: { [selector: string]: (a: AccountOp, c: IrCall) => IrCall[] }
  } = {
    '0x7a250d5630b4cf539739df2c5dacb4c659f2488d': uniV2Mapping(accountOp.humanizerMeta!),
    '0xe592427a0aece92de3edee1f18e0157c05861564': uniV3Mapping(accountOp.humanizerMeta!),
    // Mainnet, Goerli, Arbitrum, Optimism, Polygon Address
    '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': uniV32Mapping(accountOp.humanizerMeta!),
    // same as above line but on on base (https://docs.uniswap.org/contracts/v3/reference/deployments)
    '0x2626664c2603336e57b271c5c0b26f421741e481': uniV32Mapping(accountOp.humanizerMeta!),
    // empirical address from wallet txns
    '0x4c60051384bd2d3c01bfc845cf5f4b44bcbe9de5': uniUniversalRouter(
      accountOp.humanizerMeta!,
      options
    ),
    // same as above but with address from official documentation (https://docs.uniswap.org/contracts/v3/reference/deployments)
    '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': uniUniversalRouter(
      accountOp.humanizerMeta!,
      options
    ),
    // optimism
    '0xec8b0f7ffe3ae75d7ffab09429e3675bb63503e4': uniUniversalRouter(
      accountOp.humanizerMeta!,
      options
    ),
    // polygon
    '0x643770e279d5d0733f21d6dc03a8efbabf3255b4': uniUniversalRouter(
      accountOp.humanizerMeta!,
      options
    ),
    // avalanche
    '0x82635af6146972cd6601161c4472ffe97237d292': uniUniversalRouter(
      accountOp.humanizerMeta!,
      options
    )
  }

  const newCalls: IrCall[] = []
  currentIrCalls.forEach((call: IrCall) => {
    const sigHash = call.data.substring(0, 10)
    // check against sus contracts with same func selectors
    if (accountOp.humanizerMeta?.knownAddresses[call.to.toLowerCase()]?.name?.includes('Uniswap')) {
      if (matcher?.[call.to.toLowerCase()]?.[sigHash]) {
        matcher[call.to.toLowerCase()]
          [sigHash](accountOp, call)
          .forEach((hc: IrCall, index: number) =>
            // if multicall has value it shouldnt result in multiple calls with value
            index === 0 ? newCalls.push(hc) : newCalls.push({ ...hc, value: 0n })
          )
      } else {
        newCalls.push({
          ...call,
          fullVisualization: getUnknownVisualization('Uniswap', call)
        })
      }
    } else {
      newCalls.push(call)
    }
  })
  return [newCalls, []]
}
