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
  '0x3315ef7cA28dB74aBADC6c44570efDF06b04B020',
  '0x4C82D1fBFe28C977cBB58D8C7FF8FCF9F70a2cCA',
  '0x66a9893cc07d91d95644aedd05d03f95e1dba8af',
  '0xCb640A86855f1A828c27241bA364348de28abe66',
  '0x851116d9223fabed8e56c0e6b8ad0c31d98b3507',
  '0x8B844f885672f333Bc0042cB669255f93a4C1E6b',
  '0x1906c1d672b88cd1b9ac7593301ca990f94eae07',
  '0x4D73A4411CA1c660035e4AECC8270E5DdDEC8C17',
  '0xef740bf23acae26f6492b10de645d6b98dc8eaf3',
  '0x1095692a6237d83c6a72f3f5efedb9a670c49223',
  '0x0d97dc33264bfc1c226207428a79b26757fb9dc3',
  '0x5507749f2c558bb3e162c6e90c314c092e7372ff',
  '0x28731BCC616B5f51dD52CF2e4dF0E78dD1136C06',
  '0x8ac7bee993bb44dab564ea4bc9ea67bf9eb5e743',
  '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6',
  '0xf70536b3bcc1bd1a972dc186a2cf84cc6da6be5d',
  '0x0e2850543f69f678257266e0907ff9a58b3f13de',
  '0x1febb76be10aaf3a1402f04e8e835f2c382f7914',
  '0x48fd03529d2a91be835f07f6b72f53b4aad6093d',
  '0x47837eb80db5908eabba9105626d9b348bea7b02',
  '0x6ff5693b99212da76ad316178a184ab56d299b43',
  '0xfdf682f51fe81aa4898f0ae2163d8a55c127fbc7',
  '0x3ae6d8a282d67893e17aa70ebffb33ee5aa65893',
  '0xa51afafe0263b40edaef0df8781ea9aa03e381a3',
  '0x643770e279d5d0733f21d6dc03a8efbabf3255b4',
  '0xcb695bc5D3Aa22cAD1E6DF07801b061a05A0233A',
  '0x94b75331ae8d42c1b61065089b7d48fe14aa73b7',
  '0x661e93cca42afacb172121ef892830ca3b70f08d',
  '0xeabbcb3e8e415306207ef514f660a3f820025be3',
  '0xd0872d928672ae2ff74bdb2f5130ac12229cafaf',
  '0x492e6456d9528771018deb9e87ef7750ef184104',
  '0x2986d9721A49838ab4297b695858aF7F17f38014',
  '0x3315ef7ca28db74abadc6c44570efdf06b04b020',
  '0x3a9d48ab9751398bbfa63ad67599bb04e4bdf98b',
  '0xB0C89059d7190EDb17eFF19829cc009cEe923916'
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
