import { ethers } from 'ethers'
import { AccountOp } from '../accountOp/accountOp'
import { genericErc20Humanizer, genericErc721Humanizer, tokenParsing } from './modules/tokens'
import { uniswapHumanizer } from './modules/Uniswap'
import { wethHumanizer } from './modules/weth'
import { oneInchHumanizer } from './modules/oneInch'
import { IrCall, Ir, HumanizerFragment } from './interfaces'
import { aaveHumanizer } from './modules/Aave'
import { WALLETModule } from './modules/WALLET'
import { nameParsing } from './modules/nameParsing'
import { fallbackHumanizer } from './modules/fallBackHumanizer'
import { yearnVaultModule } from './modules/yearnTesseractVault'
// @TODO !!!!!!! fix nameName parsing rename and tests (SHOULD Promise<HumanizerFragment> have possibility to be null)
// @TODO update to use wrapper for coingecko api (if (no key) {free api} else {paid api})
// @TODO update humanizer fragment to be the return value from emitEvent
// @TODO humanize signed messages
// @TODO finish modules:
// WALLET/ADX staking
// @TODO fix comments from feedback https://github.com/AmbireTech/ambire-common/pull/281
// @TODO add visualization interface

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
): [Ir, Array<Promise<HumanizerFragment | null>>] {
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
    nameParsing,
    tokenParsing
  ]
  let currentIr: Ir = callsToIr(accountOp)
  let asyncOps: any[] = []
  try {
    humanizerModules.forEach((hm) => {
      let newPromises = []
      ;[currentIr, newPromises] = hm(accountOp, currentIr, options)
      asyncOps = [...asyncOps, ...newPromises]
    })
  } catch (e) {
    options.emitError({ message: 'Humanizer: unexpected err', error: e, level: 'major' })
  }
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
    if (v.type === 'token') {
      text += `${v.readbleAmount || v.amount} ${v.symbol ? v.symbol : `${v.address} token`} `
    }
  })
  if (text) {
    return text
  }
  // @TODO throw err
  return `Call to ${call.to} with ${call.value} value and ${call.data} data`
}
