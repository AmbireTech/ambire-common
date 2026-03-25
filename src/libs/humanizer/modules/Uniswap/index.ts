import { getAddress, isAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction } from '../../utils'
import { uniUniversalRouter } from './uniUniversalRouter'
import { uniV2Mapping } from './uniV2'
import { uniV3Mapping } from './uniV3'

const uniV3MappingObj = uniV3Mapping()

const fullUniswapHumanizerMapping = {
  ...uniV2Mapping,
  ...uniV3MappingObj,
  ...uniUniversalRouter
}

const uniAddresses = [
  '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
  '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  // Mainnet, Goerli, Arbitrum, Optimism, Polygon Address
  '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  // same as above line but on on base (https://docs.uniswap.org/contracts/v3/reference/deployments)
  '0x2626664c2603336E57B271c5C0b26F421741e481',
  // empirical address from wallet txns
  '0x4C60051384bd2d3C01bfc845Cf5F4b44bcbE9de5',
  // same as above but with address from official documentation (https://docs.uniswap.org/contracts/v3/reference/deployments)
  '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD',
  // optimism
  '0xeC8B0F7Ffe3ae75d7FfAb09429e3675bb63503e4',
  '0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8',
  // polygon
  '0x643770E279d5D0733F21d6DC03A8efbABf3255B4',
  '0xec7BE89e9d109e7e3Fec59c222CF297125FEFda2',
  // avalanche
  '0x82635AF6146972cD6601161c4472ffe97237D292',
  // arbitrum
  '0x5E325eDA8064b456f4781070C0738d849c824258',
  // base
  '0x6fF5693b99212Da76ad316178A184AB56D299b43',
  '0x6Df1c91424F79E40E33B1A48F0687B666bE71075',
  // binance
  '0x1A0A18AC4BECDDbd6389559687d1A73d8927E416',
  '0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B',
  '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af',
  '0xb555edF5dcF85f42cEeF1f3630a52A108E55A654',
  '0x851116D9223fabED8E56C0E6b8Ad0c31d98B3507',
  '0x1095692A6237d83C6a72F3F5eFEdb9A670C49223'
]

export const uniswapHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[]
) => {
  const newCalls: IrCall[] = []
  currentIrCalls.forEach((call: IrCall) => {
    if (!call.to || !isAddress(call.to) || !uniAddresses.includes(getAddress(call.to))) {
      newCalls.push(call)
      return
    }

    const sigHash = call.data.substring(0, 10)
    if (fullUniswapHumanizerMapping[sigHash])
      newCalls.push({
        ...call,
        fullVisualization: fullUniswapHumanizerMapping[sigHash](accountOp, call)
      })
    else newCalls.push({ ...call, fullVisualization: [getAction('Uniswap action')] })
  })
  return newCalls
}
