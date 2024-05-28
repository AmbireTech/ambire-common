/* eslint-disable no-continue */
// TODO: add types
// @ts-nocheck

import { isZeroAddress } from 'ethereumjs-util'
import networks from '../../constants/networks'
import { HumanizerInfoType } from '../../hooks/useConstants'
import humanizers from '../humanizers'
import { getName, nativeToken } from './humanReadableTransactions'

function parseActions(actions) {
  const result = []
  for (let i = 0; i < actions.length; i++) {
    const notLast = i < actions.length - 1
    if (!notLast) {
      result.push(actions[i])
      continue
    }

    if (actions[i].length >= 2 && actions[i][actions[i].length - 2] === 'and send it to') {
      result.push(actions[i])
      continue
    }

    if (
      // are valid [obj]
      actions[i].length >= 4 &&
      actions[i + 1].length >= 2 &&
      Array.isArray(actions[i]) &&
      Array.isArray(actions[i + 1]) &&
      // are actual swap and unwrap
      typeof actions[i][0] === 'string' &&
      actions[i][0].startsWith('Swap') &&
      actions[i][3].type === 'token' &&
      // isWrappedAsset(actions[i][3].address) &&
      typeof actions[i + 1][0] === 'string' &&
      actions[i + 1][0].startsWith('Unwrap') &&
      actions[i + 1][1].type === 'token' &&
      // have proper values and addresses
      actions[i][3].amount === actions[i + 1][1].amount &&
      isZeroAddress(actions[i + 1][1].address)
    ) {
      // swap x for at least y
      result.push(['Swap', actions[i][1], actions[i][2], actions[i + 1][1]])
      // skip next ccall, since two were merged
      i++
      continue
    }

    if (
      // are valid [obj]
      actions[i].length >= 2 &&
      actions[i + 1].length >= 4 &&
      Array.isArray(actions[i]) &&
      Array.isArray(actions[i + 1]) &&
      // are actual Wrap and Swap
      typeof actions[i][0] === 'string' &&
      actions[i][0].startsWith('Wrap') &&
      actions[i][1].type === 'token' &&
      typeof actions[i + 1][0] === 'string' &&
      actions[i + 1][0].startsWith('Swap') &&
      actions[i + 1][3].type === 'token' &&
      // have proper values and addresses
      actions[i + 1][1].amount === actions[i][1].amount &&
      isZeroAddress(actions[i][1].address)
    ) {
      // swap x for at least y
      result.push(['Swap', actions[i][1], actions[i + 1][2], actions[i + 1][3]])
      // skip next call, since two were merged
      i++
      continue
    }
    if (
      // are valid [obj]
      actions[i].length === 2 &&
      actions[i + 1].length === 2 &&
      Array.isArray(actions[i]) &&
      Array.isArray(actions[i + 1]) &&
      // are actual Unwrap and Sweep
      typeof actions[i][0] === 'string' &&
      actions[i][0].startsWith('Unwrap') &&
      actions[i][1].type === 'token' &&
      typeof actions[i + 1][0] === 'string' &&
      actions[i + 1][0].startsWith('Sweep') &&
      actions[i + 1][1].type === 'token'
    ) {
      result.push(['Remove liquidity and withdraw', actions[i][1], 'and', actions[i + 1][1]])
      // skip next call, since two were merged
      i++
      continue
    }
    result.push(actions[i])
    continue
  }
  return result
}

// This function is moved away from the `humanReadableTransactions` main file,
// because the `humanizers` import is causing a require cycle between
//   1) humanReadableTransactions/index.ts ->
//   2) humanizers/index.ts ->
//   3) humanizers/YearnVault.ts (and all others) ->
//   4) humanReadableTransactions/index.ts
export function getTransactionSummary(
  humanizerInfo: HumanizerInfoType,
  txn,
  networkId,
  accountAddr,
  opts = {}
) {
  const [to, value, data = '0x'] = txn
  const network = networks.find((x) => x.id === networkId || x.chainId === networkId)
  if (!network) return 'Unknown network (unable to parse)'

  if (to === '0x' || !to) {
    return 'Deploy contract'
  }

  const tokenInfo = humanizerInfo.tokens[to.toLowerCase()]
  const name = humanizerInfo.names[to.toLowerCase()]

  if (data === '0x' && to.toLowerCase() === accountAddr.toLowerCase()) {
    // Doesn't matter what the value is, this is always a no-op
    return !opts.extended ? 'Transaction cancellation' : [['Cancel', 'transaction']]
  }

  let callSummary
  let sendSummary
  if (parseInt(value) > 0)
    sendSummary = !opts.extended
      ? `send ${nativeToken(network, value)} to ${name || to}`
      : [
          'Send',
          {
            type: 'token',
            ...nativeToken(network, value, true)
          },
          'to',
          {
            type: 'address',
            address: to,
            name: getName(humanizerInfo, to, network)
          }
        ]

  if (data !== '0x') {
    callSummary = !opts.extended
      ? `Unknown interaction with ${name || (tokenInfo ? tokenInfo[0] : to)}`
      : [
          'unknown',
          'interaction with',
          {
            type: 'address',
            address: to,
            name: name || (tokenInfo && tokenInfo[0])
          }
        ]

    const sigHash = data.slice(0, 10)
    const humanizer = humanizers(humanizerInfo)[sigHash]
    if (humanizer) {
      try {
        let actions = humanizer({ to, value, data, from: accountAddr }, network, opts)
        actions = parseActions(actions)

        return opts.extended === true ? actions : actions.join(', ')
      } catch (e) {
        callSummary = opts.extended
          ? callSummary.concat(['(unable to parse)'])
          : `${callSummary} (unable to parse)`
      }
    }
  }

  const filteredSummary = [callSummary, sendSummary].filter((x) => x)
  return !opts.extended ? filteredSummary.join(', ') : filteredSummary
}
