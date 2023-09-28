import { ethers } from 'ethers'
import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerVisualization, IrCall } from '../../interfaces'
import { uniUniversalRouter } from './uniUnivarsalRouter'
import { uniV2Mapping } from './uniV2'
import { uniV32Mapping, uniV3Mapping } from './uniV3'
import { getAction, getLabel, getAddress } from '../../utils'

const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
// @TODO finish moving this
const wrpaUnwrapParser = (calls: IrCall[], humanizerInfo: any) => {
  const newCalls: IrCall[] = []
  for (let i = 0; i < calls.length; i++) {
    if (
      humanizerInfo?.[`names:${calls[i].to}`] === 'Uniswap' &&
      calls[i]?.fullVisualization &&
      calls[i].to === calls[i + 1]?.to
    ) {
      if (
        // swapping x of token for y of WETH and unwrapping y WETH for y ETH
        calls[i]?.fullVisualization?.[0].content === 'Swap' &&
        calls[i]?.fullVisualization?.[3].address === WETH_ADDRESS &&
        calls[i]?.fullVisualization?.[3].amount === calls[i + 1]?.fullVisualization?.[2].amount &&
        calls[i + 1]?.fullVisualization?.[0].content === 'Unwrap'
      ) {
        const newVisualization = calls[i]?.fullVisualization?.map((v: HumanizerVisualization) => {
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
        calls[i]?.fullVisualization?.[0].content === 'Swap' &&
        calls[i].value === calls[i]?.fullVisualization?.[1].amount &&
        calls[i]?.fullVisualization?.[1].address === WETH_ADDRESS
      ) {
        const newVisualization = calls[i]?.fullVisualization?.map((v: HumanizerVisualization) => {
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
    '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD': uniUniversalRouter(accountOp.humanizerMeta)
  }
  const newCalls: IrCall[] = []
  currentIrCalls.forEach((call: IrCall) => {
    // check against sus contracts with same func selectors
    if (accountOp.humanizerMeta?.[`names:${call.to}`] === 'Uniswap') {
      if (matcher?.[call.to]?.[call.data.substring(0, 10)]) {
        matcher[call.to]
          [call.data.substring(0, 10)](accountOp, call)
          .forEach((hc: IrCall, index: number) =>
            // if multicall has value it shouldnt result in multiple calls with value
            index === 0 ? newCalls.push(hc) : newCalls.push({ ...hc, value: 0n })
          )
      } else {
        newCalls.push({
          ...call,
          fullVisualization: [
            getAction('Unknown action (Uniswap)'),
            getLabel('to'),
            getAddress(call.to)
          ]
        })
      }
    } else {
      newCalls.push(call)
    }
  })
  const parsedCalls = wrpaUnwrapParser(newCalls, accountOp.humanizerMeta)
  return [parsedCalls, []]
}
