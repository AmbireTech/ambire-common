import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, HumanizerMeta, IrCall } from '../../interfaces'
import { HumanizerUniMatcher } from './interfaces'
import { uniUniversalRouter } from './uniUniversalRouter'
import { uniV2Mapping } from './uniV2'
import { uniV32Mapping, uniV3Mapping } from './uniV3'

// this function reduces calls only within uniswaps context. It does virtually the same thins as wrapSwapReducer, but wrapSwapReducer
// lacks the context that is needed for squashing multicalls ONLY SOMETIMES
// lets say a multicall swaps and sends value, but after that we have another send.(2 calls that result in 3 IrCalls)
// this function will squash only the first two, because they originate from the same multicall
// this behavior is achievable with the wrapSwapReducer, but should not be there as
// it has no way of knowing that the third call (send) should not be squashed with the multicall
const reduceMulticall = (calls: IrCall[]): IrCall[] => {
  const newCalls: IrCall[] = []
  // @TODO optimize to not require update=true on every match case
  let updated = false
  for (let i = 0; i < calls.length; i++) {
    // @TODO add test http://localhost:19006/?networkId=base&txnId=0x8c9cf6f2981218108625b6bae8a539d26257d65b7ced2d54f0d59402502177ed
    // should say only swap ETH for 1 WALLET
    // @TODo add test http://localhost:19006/index.html?txnId=0x33e39c985d9abc5f5f3f980db1ca645ce676c622566aa26ad2f180f65c1eab2c&networkId=arbitrum
    // should say swap 0.5 and send 0.1
    if (
      calls[i]?.fullVisualization?.[0].content?.includes('Swap') &&
      calls[i + 1]?.fullVisualization?.[0].content?.includes('Send') &&
      calls[i]?.fullVisualization?.[3].address &&
      calls[i]?.fullVisualization?.[3].address === calls[i + 1]?.fullVisualization?.[1].address
    ) {
      const newVisualization = calls[i].fullVisualization
      newVisualization![3].amount =
        calls[i].fullVisualization![3].amount! - calls[i + 1].fullVisualization![1].amount!

      newCalls.push({
        ...calls[i],
        value: calls[i].value + calls[i + 1].value,
        fullVisualization: newVisualization
      })
      updated = true
      i++
    } else {
      newCalls.push(calls[i])
    }
  }
  return updated ? reduceMulticall(newCalls) : newCalls
}
export const uniswapHumanizer: HumanizerCallModule = (
  accountOp: AccountOp,
  currentIrCalls: IrCall[],
  _: HumanizerMeta,
  options?: any
) => {
  const uniV2MappingObj = uniV2Mapping()
  const uniV3MappingObj = uniV3Mapping()
  const uniV32MappingObj = uniV32Mapping()
  const uniUniversalRouterObj = uniUniversalRouter(options)

  const matcher: {
    [address: string]: HumanizerUniMatcher
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
  const fallbackFlatUniswapsMather = Object.values(matcher).reduce((a, b) => ({ ...a, ...b }), {})
  const newCalls: IrCall[] = []
  currentIrCalls.forEach((call: IrCall) => {
    const sigHash = call.data.substring(0, 10)

    const knownUniswapVersion = matcher[call.to.toLowerCase()]
    if (knownUniswapVersion && knownUniswapVersion?.[sigHash]) {
      const resultingCalls = knownUniswapVersion[sigHash](accountOp, call)
      const squashedCalls = reduceMulticall(resultingCalls)

      squashedCalls.forEach((hc: IrCall, index: number) =>
        // @TODO this might be bad design choice, must be further discussed
        // a more appropriate, safe and UX-y approach would be to have all subcalls into one bubble
        // we should discuss
        // if multicall has value it shouldn't result in multiple calls with value
        index === 0 ? newCalls.push(hc) : newCalls.push({ ...hc, value: 0n })
      )
      // if unknown address, but known sighash
    } else if (fallbackFlatUniswapsMather[sigHash]) {
      fallbackFlatUniswapsMather[sigHash](accountOp, call).forEach((hc: IrCall, index: number) => {
        newCalls.push({ ...hc, value: index === 0 ? hc.value : 0n })
      })
    } else {
      newCalls.push(call)
    }
  })
  return [newCalls, []]
}
