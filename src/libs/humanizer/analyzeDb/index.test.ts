import fs from 'fs/promises'
import fetch from 'node-fetch'
import path from 'path'
import { humanizeCalls, visualizationToText } from '../humanizerFuncs'
import data from './txns.json'
import { Call } from '../../accountOp/accountOp'
import humanizerJSON from '../../../consts/humanizerInfo.json'
import { genericErc20Humanizer, genericErc721Humanizer } from '../modules/tokens'
import { gasTankModule } from '../modules/gasTankModule'
import { uniswapHumanizer } from '../modules/Uniswap'
import { wrappingModule } from '../modules/wrapped'
import { aaveHumanizer } from '../modules/Aave'
import { yearnVaultModule } from '../modules/yearnTesseractVault'
import { sushiSwapModule } from '../modules/sushiSwapModule'
import { WALLETModule } from '../modules/WALLET'
import { fallbackHumanizer } from '../modules/fallBackHumanizer'
import { HumanizerCallModule } from '../interfaces'
import { parseCalls } from '../parsers'
import { nameParsing } from '../parsers/nameParsing'
import { tokenParsing } from '../parsers/tokenParsing'

const humanizerCallModules: HumanizerCallModule[] = [
  genericErc20Humanizer,
  genericErc721Humanizer,
  gasTankModule,
  uniswapHumanizer,
  wrappingModule,
  aaveHumanizer,
  // oneInchHumanizer,
  WALLETModule,
  yearnVaultModule,
  sushiSwapModule,
  fallbackHumanizer
]

const emitError = (a: any) => {
  console.log(a)
}

const options = {
  fetch,
  emitError
}
describe('Main', () => {
  test('()', async () => {
    const accountOps = data.map((d) => {
      //   console.log(d.txns.slice(-1))
      console.log(d.txns.slice(0, -1))
      return {
        accountAddr: d.identity,
        networkId: d.network,
        signingKeyAddr: null,
        signingKeyType: null,
        nonce: null,
        calls: d.txns.map((t) => ({ to: t[0], value: BigInt(t[1]), data: t[2] } as Call)),
        gasLimit: null,
        signature: null,
        gasFeePayment: null,
        accountOpToExecuteBefore: null,
        humanizerMeta: humanizerJSON
      }
    })
    const res = accountOps
      .map((accOp) => {
        const calls = humanizeCalls(accOp, humanizerCallModules, options)[0]
        return parseCalls(accOp, calls, [nameParsing, tokenParsing], options)[0]
      })
      .flat()
      .map((call) => ({
        call,
        textification: visualizationToText(call, options)
      }))
    const textifications = res.map((t) => t.textification)
    await fs.writeFile(
      path.join(__dirname, './result.json'),
      JSON.stringify(textifications, null, 4)
    )
  })
})
