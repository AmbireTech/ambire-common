import { ethers } from 'ethers'
import { AccountOp } from '../accountOp/accountOp'
import { genericErc20Humanizer, genericErc721Humanizer } from './modules/tokens'
import { uniswapHumanizer } from './modules/Uniswap'
import { IrCall, Ir, HumanizerFragment } from './interfaces'
import { shortenAddress, getAction, getLable, getToken } from './utils'

// @TODO humanize signed messages

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

// adds 'name' proeprty to visualization of addresses (needs initialHumanizer to work on unparsed transactions)
export function namingHumanizer(
  accountOp: AccountOp,
  currentIr: Ir,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  options?: any
): [Ir, Promise<any>[]] {
  const newCalls = currentIr.calls.map((call) => {
    const newVisualization = call.fullVisualization?.map((v: any) => {
      return v.type === 'address'
        ? {
            ...v,
            // in case of more sophisticated name resolutions
            // new name function so it can be getName() || shortenAddress() ????????
            name:
              accountOp.humanizerMeta?.[`names:${v.address}`] ||
              (accountOp.humanizerMeta?.[`tokens:${v.address}`]
                ? accountOp.humanizerMeta?.[`names:${v.address}`] ||
                  `${accountOp.humanizerMeta?.[`tokens:${v.address}`]?.[0]} contract`
                : null) ||
              shortenAddress(v.address)
          }
        : v
    })
    return { ...call, fullVisualization: newVisualization || call.fullVisualization }
  })
  const newIr = { ...currentIr, calls: newCalls }
  return [newIr, []]
}

async function fetchFuncEtherface(
  selector: string,
  fetch: Function
): Promise<HumanizerFragment | null> {
  try {
    const res = await (
      await fetch(`https://api.etherface.io/v1/signatures/hash/all/${selector.slice(2, 10)}/1`)
    ).json()
    const func = res.items[0]
    return {
      key: `funcSelectors:${selector}`,
      isGlobal: false,
      value: { text: func.text, hash: func.hash }
    }
  } catch (e) {
    console.log(e)
    return null
  }
}
const checkIfUnknowAction = (v: Array<any>) => {
  try {
    return v.length === 1 && v[0].type === 'action' && v[0].content === 'Unknown action'
  } catch (e) {
    return false
  }
  return false
}

export function fallbackHumanizer(
  accountOp: AccountOp,
  currentIr: Ir,
  options?: any
): [Ir, Promise<any>[]] {
  const asyncOps: any = []
  const newCalls = currentIr.calls.map((call) => {
    if (call.fullVisualization && !checkIfUnknowAction(call.fullVisualization)) return call
    const visualization = []
    if (call.data !== '0x') {
      if (accountOp.humanizerMeta?.[`funcSelectors:${call.data.slice(0, 10)}`]) {
        visualization.push(
          getAction(accountOp.humanizerMeta?.[`funcSelectors:${call.data.slice(0, 10)}`].text)
        )
      } else {
        const promise = fetchFuncEtherface(call.data.slice(0, 10), options.fetch)
        promise ? asyncOps.push(promise) : null
        return { ...call, fullVisualization: [getAction('Unknown action')] }
      }
    }
    if (call.value) {
      if (call.data !== '0x') visualization.push(getLable('and'))
      visualization.push(getAction('Sending'))
      visualization.push(getToken(ethers.ZeroAddress, call.value))
    }
    visualization.push(getLable('to'))
    visualization.push(getAction(call.to))
    return { ...call, fullVisualization: visualization }
  })

  const newIr = { calls: newCalls }
  return [newIr, asyncOps]
}

export async function humanize(accountOp: AccountOp, options?: any) {
  // IDEA humanizer that adds {expected: } (should a txn have value or not, should txn be to contract or not to contract, add warning)
  const humanizerModules = [
    genericErc20Humanizer,
    genericErc721Humanizer,
    uniswapHumanizer,
    namingHumanizer,
    fallbackHumanizer
  ]

  let currentIr: Ir = callsToIr(accountOp)

  // asyncOps all data that has to be retrieved asyncly
  let asyncOps: any[] = []

  humanizerModules.forEach((hm) => {
    let newPromises = []
    ;[currentIr, newPromises] = hm(accountOp, currentIr, options)
    asyncOps = [...asyncOps, ...newPromises]
  })
  return [currentIr, asyncOps]
}
