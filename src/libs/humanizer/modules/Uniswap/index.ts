import { getAddress, isAddress } from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, isHexCall } from '../../utils'
import { uniUniversalRouter } from './uniUniversalRouter'
import { uniV2Mapping } from './uniV2'
import { uniV3Mapping } from './uniV3'

const uniV3MappingObj = uniV3Mapping()

const fullUniswapHumanizerMapping = {
  ...uniV2Mapping,
  ...uniV3MappingObj,
  ...uniUniversalRouter
}

// fetched from https://api.github.com/repos/Uniswap/universal-router/contents/deploy-addresses
// and https://docs.uniswap.org/contracts/v3/reference/deployments/
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
  '0xFdf682F51FE81Aa4898F0AE2163d8A55c127fbC7',
  '0x6Df1c91424F79E40E33B1A48F0687B666bE71075',
  // binance
  '0x1A0A18AC4BECDDbd6389559687d1A73d8927E416',
  '0xEf1c6E67703c7BD7107eed8303Fbe6EC2554BF6B',
  '0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af',
  '0xb555edF5dcF85f42cEeF1f3630a52A108E55A654',
  '0x851116D9223fabED8E56C0E6b8Ad0c31d98B3507',
  '0x1095692A6237d83C6a72F3F5eFEdb9A670C49223',
  '0x4648a43B2C14Da09FdF82B161150d3F634f40491',
  '0x5302086A3a25d473aAbBd0356eFf8Dd811a4d89B',
  '0xA51afAFe0263b40EdaEf0Df8781eA9aa03E381a3',
  '0x4Dae2f939ACf50408e13d58534Ff8c2776d45265',
  '0xD0872D928672ae2fF74Bdb2F5130Ac12229CAfAF',
  '0x7B46ee9BaB49bd5b37117494689A035b0F187B59',
  '0x95273d871c8156636e114b63797d78D7E1720d81',
  '0x76870DEbef0BE25589A5CddCe9B1D99276C73B4e',
  '0x9E18Efb3BE848940b0C92D300504Fb08C287FE85',
  '0xe463635f6e73C1E595554C3ae216472D0fb929a9',
  '0x5ab1B56FB16238dB874258FB7847EFe248eb8496',
  '0xeAbBcB3E8E415306207ef514f660A3F820025BE3',
  '0x5Dc88340E1c5c6366864Ee415d6034cadd1A9897',
  '0x1906c1d672b88cD1B9aC7593301cA990F94Eae07',
  '0xC73d61d192FB994157168Fb56730FdEc64C9Cb8F',
  '0x112908daC86e20e7241B0927479Ea3Bf935d1fa0',
  '0x76D631990d505E4e5b432EEDB852A60897824D68',
  '0xFC885F37F5A9FA8159c8dBb907fc1b0C2fB31323',
  '0x40d51104Da22E3e77b683894E7e3E12e8FC61E65',
  '0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b',
  '0x4cded7Edf52c8AA5259A54Ec6a3CE7C6D2a455Df',
  '0x8702463e73f74d0b6765aBceb314Ef07aCb92650',
  '0x986daDb82491834F6D17bD3287eb84bE0B4D4cc7',
  '0xEf740bf23aCaE26f6492B10de645D6B98dC8Eaf3',
  '0x16D4F26C15f3658ec65B1126ff27DD3dF2a2996b',
  '0x8ac7bEE993bb44dAb564Ea4bc9EA67Bf9Eb5e743',
  '0x3315ef7cA28dB74aBADC6c44570efDF06b04B020'
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

    if (!isHexCall(call)) {
      newCalls.push({ ...call, fullVisualization: [getAction('Uniswap action')] })
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
