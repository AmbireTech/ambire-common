import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { uniUniversalRouter } from './uniUnivarsalRouter'
import { uniV2Mapping } from './uniV2'
import { uniV32Mapping, uniV3Mapping } from './uniV3'
import { getUnknownVisualization } from '../../utils'

export const uniswapHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
) => {
  const matcher: { [x: string]: { [x: string]: (a: AccountOp, c: IrCall) => IrCall[] } } = {
    '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D': uniV2Mapping(accountOp.humanizerMeta),
    '0xE592427A0AEce92De3Edee1F18E0157C05861564': uniV3Mapping(accountOp.humanizerMeta),
    // Mainnet, Goerli, Arbitrum, Optimism, Polygon Address
    '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45': uniV32Mapping(accountOp.humanizerMeta),
    // same as above line but on on base (https://docs.uniswap.org/contracts/v3/reference/deployments)
    '0x2626664c2603336E57B271c5C0b26F421741e481': uniV32Mapping(accountOp.humanizerMeta),
    // empirical address from wallet txns
    '0x4C60051384bd2d3C01bfc845Cf5F4b44bcbE9de5': uniUniversalRouter(accountOp.humanizerMeta),
    // same as above but with address from official documentation (https://docs.uniswap.org/contracts/v3/reference/deployments)
    '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD': uniUniversalRouter(accountOp.humanizerMeta),
    '0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4': uniUniversalRouter(accountOp.humanizerMeta)
  }
  const newCalls: IrCall[] = []
  currentIrCalls.forEach((call: IrCall) => {
    const sigHash = call.data.substring(0, 10)
    // if (call.to === '0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4') {
    //   console.log('musaka')
    //   const parsed = matcher[call.to][sigHash](accountOp, call)
    //   console.log(parsed.length)
    // }
    // check against sus contracts with same func selectors
    if (call.to === '0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4')
      console.log(accountOp.humanizerMeta?.[`names:${call.to}`]?.includes('Uniswap'))

    if (accountOp.humanizerMeta?.[`names:${call.to}`]?.includes('Uniswap')) {
      if (call.to === '0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4') console.log('asd')

      if (matcher?.[call.to]?.[sigHash]) {
        if (call.to === '0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4') console.log('in')
        matcher[call.to][sigHash](accountOp, call).forEach((hc: IrCall, index: number) =>
          // if multicall has value it shouldnt result in multiple calls with value
          index === 0 ? newCalls.push(hc) : newCalls.push({ ...hc, value: 0n })
        )
        if (call.to === '0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4') console.log('recognized')
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
