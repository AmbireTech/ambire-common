import { ethers } from 'ethers'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerFragment, Ir, IrCall } from '../../interfaces'
import { uniUniversalRouter } from './uniUnivarsalRouter'
import { uniV2Mapping } from './uniV2'
import { uniV32Mapping, uniV3Mapping } from './uniV3'

const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

const wrpaUnwrapParser = (calls: IrCall[], humanizerInfo: any) => {
  const newCalls: IrCall[] = []
  for (let i = 0; i < calls.length; i++) {
    if (humanizerInfo?.[`names:${calls[i].to}`] === 'Uniswap') {
      if (
        // same contract
        calls[i].to === calls[i + 1]?.to &&
        // swapping x of token for y of WETH and unwrapping y WETH for y ETH
        calls[i].fullVisualization[0].content === 'Swap' &&
        calls[i].fullVisualization[3].address === WETH_ADDRESS &&
        calls[i].fullVisualization[3].amount === calls[i + 1]?.fullVisualization[2].amount &&
        calls[i + 1]?.fullVisualization[0].content === 'Unwrap'
      ) {
        const newVisualization = calls[i].fullVisualization.map((v: any) => {
          return v.type === 'token' && v.address === WETH_ADDRESS
            ? { ...v, address: ethers.ZeroAddress }
            : v
        })
        newCalls.push({
          to: calls[i].to,
          value: calls[i].value + calls[i + 1].value,
          // might cause bugs
          data: `${calls[i].data} AND ${calls[i + 1].data}`,
          fullVisualization: newVisualization
        })
        i += 1
      } else if (
        calls[i].fullVisualization[0].content === 'Swap' &&
        calls[i].value === calls[i].fullVisualization[1].amount &&
        calls[i].fullVisualization[1].address === WETH_ADDRESS
      ) {
        const newVisualization = calls[i].fullVisualization.map((v: any) => {
          return v.type === 'token' && v.address === WETH_ADDRESS
            ? { ...v, address: ethers.ZeroAddress }
            : v
        })
        newCalls.push({ ...calls[i], fullVisualization: newVisualization })
      } else {
        newCalls.push(calls[i])
      }
    } else {
      newCalls.push(calls[i])
    }
  }
  return newCalls
}
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
  const parsedCalls = wrpaUnwrapParser(newCalls, accountOp.humanizerMeta)
  const newIr = { calls: parsedCalls }
  return [newIr, []]
}
