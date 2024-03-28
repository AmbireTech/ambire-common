import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerMeta, HumanizerWarning, IrCall } from '../../interfaces'
import { getUnknownVisualization, getWarning } from '../../utils'
import { uniUniversalRouter } from './uniUnivarsalRouter'
import { uniV2Mapping } from './uniV2'
import { uniV32Mapping, uniV3Mapping } from './uniV3'

export const uniswapHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[],
  humanizerMeta: HumanizerMeta,
  options?: any
) => {
  const uniV2MappingObj = uniV2Mapping(humanizerMeta, options)
  const uniV3MappingObj = uniV3Mapping(humanizerMeta, options)
  const uniV32MappingObj = uniV32Mapping(humanizerMeta, options)
  const uniUniversalRouterObj = uniUniversalRouter(humanizerMeta, options)

  const matcher: {
    [address: string]: {
      [selector: string]: (a: AccountOp, c: IrCall) => IrCall[]
    }
  } = {
    '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D': uniV2MappingObj,
    '0xe592427a0aece92de3edee1f18e0157c05861564': uniV3MappingObj,
    // Mainnet, Goerli, Arbitrum, Optimism, Polygon Address
    '0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45': uniV32MappingObj,
    // same as above line but on on base (https://docs.uniswap.org/contracts/v3/reference/deployments)
    '0x2626664c2603336e57b271c5c0b26f421741e481': uniV32MappingObj,
    // empirical address from wallet txns
    '0x4c60051384bd2d3c01bfc845cf5f4b44bcbe9de5': uniUniversalRouterObj,
    // same as above but with address from official documentation (https://docs.uniswap.org/contracts/v3/reference/deployments)
    '0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad': uniUniversalRouterObj,
    // optimism
    '0xec8b0f7ffe3ae75d7ffab09429e3675bb63503e4': uniUniversalRouterObj,
    '0xcb1355ff08ab38bbce60111f1bb2b784be25d7e8': uniUniversalRouterObj,
    // polygon
    '0x643770e279d5d0733f21d6dc03a8efbabf3255b4': uniUniversalRouterObj,
    '0xec7be89e9d109e7e3fec59c222cf297125fefda2': uniUniversalRouterObj,
    // avalanche
    '0x82635af6146972cd6601161c4472ffe97237d292': uniUniversalRouterObj,
    // arbitrum
    '0x5e325eda8064b456f4781070c0738d849c824258': uniUniversalRouterObj
  }
  const fallbackFlatUniswapsObject = Object.values(matcher).reduce((a, b) => ({ ...a, ...b }), {})
  const newCalls: IrCall[] = []
  currentIrCalls.forEach((call: IrCall) => {
    const sigHash = call.data.substring(0, 10)
    // check against sus contracts with same func selectors
    const matchedObj = matcher[call.to.toLowerCase()]
    // if known address
    if (matchedObj) {
      if (matchedObj?.[sigHash]) {
        matchedObj[sigHash](accountOp, call).forEach((hc: IrCall, index: number) =>
          // if multicall has value it shouldnt result in multiple calls with value
          index === 0 ? newCalls.push(hc) : newCalls.push({ ...hc, value: 0n })
        )
      } else {
        newCalls.push({
          ...call,
          fullVisualization: getUnknownVisualization('Uniswap', call)
        })
      }
      // if unknown address, but known sighash
    } else if (fallbackFlatUniswapsObject[sigHash]) {
      fallbackFlatUniswapsObject[sigHash](accountOp, call).forEach((hc: IrCall, index: number) => {
        // if multicall has value it shouldnt result in multiple calls with value
        const warnings: HumanizerWarning[] = [getWarning('Unknown uniswap address', 'alarm')]
        index === 0
          ? newCalls.push({ ...hc, warnings })
          : newCalls.push({ ...hc, value: 0n, warnings })
      })
    } else {
      newCalls.push(call)
    }
  })
  return [newCalls, []]
}
