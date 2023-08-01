import { ethers } from 'ethers'
import { AccountOp } from '../accountOp/accountOp'
// @TODO use humanizer info
import { genericErc20Humanizer, genericErc721Humanizer } from './modules/tokens'
import { uniswapHumanizer } from './modules/Uniswap'
import { IrCall, Ir } from './interfaces'
import { getLable, getAction, getAddress, getToken, shortenAddress } from './utils'

// @TODO humanize signed messages
// @TODO add checks for sending eth to contracts
// @TODO add checks for sending tokens to contracts
// @TODO add checks for sending eth to unused addresses

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
export function namingHumanizer(accountOp: AccountOp, currentIr: Ir): [Ir, Promise<any>[]] {
  const newCalls = currentIr.calls.map((call) => {
    const newVisualization = call.fullVisualization?.map((v: any) => {
      return v.type === 'address'
        ? {
            ...v,
            // in case of more sophisticated name resolutions
            // new name function so it can be getName() || shortenAddress() ????????
            name:
              accountOp.humanizerMeta?.names[v.address.toLowerCase()] ||
              (accountOp.humanizerMeta?.tokens[v.address.toLowerCase()]
                ? `${accountOp.humanizerMeta?.tokens[v.address.toLowerCase()]?.[0]} contract`
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

// goes over all transactions to provide basic visuzlization
export function initialHumanizer(accountOp: AccountOp, currentIr: Ir): [Ir, Promise<any>[]] {
  const newCalls = currentIr.calls.map((call) => {
    let fullVisualization
    if (call.data === '0x') {
      fullVisualization = [
        getAction('Sending'),
        getToken(ethers.ZeroAddress, call.value),
        getLable('to'),
        getAddress(call.to)
      ]
    } else if (call.value === BigInt(0)) {
      fullVisualization = [getAction('Interacting with'), getAddress(call.to)]
    } else {
      fullVisualization = [
        getAction('Interacting with'),
        getAddress(call.to),
        getLable('and'),
        getAction('Sending'),
        getToken(ethers.ZeroAddress, call.value)
      ]
    }
    return { ...call, fullVisualization }
  })
  const newIr = { calls: newCalls }
  return [newIr, []]
}

export async function humanize(accountOp: AccountOp) {
  // IDEA humanizer that adds {expected: } (should a txn have value or not, should txn be to contract or not to contract, add warning)
  const humanizerModules = [
    initialHumanizer,
    genericErc20Humanizer,
    genericErc721Humanizer,
    uniswapHumanizer,
    namingHumanizer
  ]

  let currentIr: Ir = callsToIr(accountOp)

  // asyncOps all data that has to be retrieved asyncly
  let asyncOps: any[] = []

  humanizerModules.forEach((hm) => {
    let newPromises = []
    ;[currentIr, newPromises] = hm(accountOp, currentIr)
    asyncOps = [...asyncOps, ...newPromises]
  })
  return [currentIr, asyncOps]
}
