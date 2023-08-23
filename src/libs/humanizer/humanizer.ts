import { ethers } from 'ethers'
import { AccountOp } from '../accountOp/accountOp'
import { genericErc20Humanizer, genericErc721Humanizer } from './modules/tokens'
import { uniswapHumanizer } from './modules/Uniswap'
import { wethHumanizer } from './modules/weth'
import { oneInchHumanizer } from './modules/oneInch'
import { IrCall, Ir, HumanizerFragment } from './interfaces'
import { aaveHumanizer } from './modules/Aave'
import { WALLETModule } from './modules/WALLET'
import { namingHumanizer } from './modules/namingHumanizer'
import { fallbackHumanizer } from './modules/fallBackHumanizer'
import { yearnVaultModule } from './modules/yearnTesseractVault'

// @TODO humanize signed messages
// @TODO change all console.logs to throw errs
// @TODO finish modules:
// WALLET/ADX staking
// @TODO fix comments from feedback https://github.com/AmbireTech/ambire-common/pull/281
// @TODO add visualization interface
// @TODO add new mechanism for error emitting
export function initHumanizerMeta(humanizerMeta: any) {
  const newHumanizerMeta: any = {}

  Object.keys(humanizerMeta?.tokens).forEach((k2) => {
    newHumanizerMeta[`tokens:${ethers.getAddress(k2)}`] = humanizerMeta.tokens?.[k2]
  })
  Object.keys(humanizerMeta?.abis).forEach((k2) => {
    newHumanizerMeta[`abis:${k2}`] = humanizerMeta.abis?.[k2]
  })

  Object.keys(humanizerMeta?.names).forEach((k2) => {
    newHumanizerMeta[`names:${ethers.getAddress(k2)}`] = humanizerMeta.names?.[k2]
  })

  return {
    ...newHumanizerMeta,
    yearnVaults: humanizerMeta.yearnVaults,
    tesseractVaults: humanizerMeta.yearnVaults
  }
}

export function callsToIr(accountOp: AccountOp): Ir {
  const irCalls: IrCall[] = accountOp.calls.map((call) => {
    return {
      data: call.data,
      to: call.to,
      value: call.value,
      fullVisualization: null
    }
  })
  return { calls: irCalls }
}

export function humanize(
  _accountOp: AccountOp,
  options?: any
): [Ir, Array<Promise<HumanizerFragment>>] {
  const accountOp = {
    ..._accountOp,
    calls: _accountOp.calls.map((c) => ({ ...c, to: ethers.getAddress(c.to) }))
  }
  const humanizerModules: Function[] = [
    genericErc20Humanizer,
    genericErc721Humanizer,
    uniswapHumanizer,
    wethHumanizer,
    aaveHumanizer,
    oneInchHumanizer,
    WALLETModule,
    yearnVaultModule,
    fallbackHumanizer,
    namingHumanizer
  ]
  let currentIr: Ir = callsToIr(accountOp)
  let asyncOps: any[] = []
  humanizerModules.forEach((hm) => {
    let newPromises = []
    ;[currentIr, newPromises] = hm(accountOp, currentIr, options)
    asyncOps = [...asyncOps, ...newPromises]
  })
  return [currentIr, asyncOps]
}

export const visualizationToText = (call: IrCall): string => {
  let text = ''
  const visualization = call.fullVisualization
  visualization.forEach((v: { [key: string]: any }, i: number) => {
    if (i) text += ' '
    if (v.type === 'action' || v.type === 'lable') text += `${v.content}`
    if (v.type === 'address') text += v.name ? `${v.address} (${v.name})` : v.address
    // @TODO add amount to token
    // @TODo add the amount to the fullVisualization also
    if (v.type === 'token') text += v.symbol ? `${v.symbol}` : `${v.address} token`
  })
  if (text) {
    return text
  }
  // @TODO throw err
  return `Call to ${call.to} with ${call.value} value and ${call.data} data`
}
