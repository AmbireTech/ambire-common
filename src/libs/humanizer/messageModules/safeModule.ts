import { isAddress } from 'ethers'

import { HumanizerTypedMessageFunction, HumanizerVisualization } from '../interfaces'
import { getDelegateCallWarning, getSafeHumanization } from '../modules/Safe'
import { genericErc20Humanizer } from '../modules/Tokens'
import { getAction, getAddressVisualization, getBreak, getLabel } from '../utils'

/** Humanizes a Safe{WALLET} transaction (primary type `SafeTx`) */
export const humanizeSafeTx: HumanizerTypedMessageFunction = (message) => {
  const { to, value, data, operation, nonce } = message.content.message
  const { accountAddr } = message
  const { verifyingContract } = message.content.domain
  const humanizedCall = genericErc20Humanizer({ accountAddr }, { to, value, data })
  const safeStandardHumanization = getSafeHumanization(
    verifyingContract ?? undefined,
    to,
    value,
    data,
    0,
    nonce
  )
  const fullVisualization: HumanizerVisualization[] = []
  if (!isAddress(verifyingContract)) return null
  fullVisualization.push(
    ...[
      getAction('Safe{WALLET} transaction'),
      getLabel('from'),
      getAddressVisualization(verifyingContract)
    ],
    ...(safeStandardHumanization && safeStandardHumanization.visuals
      ? [getBreak(), ...safeStandardHumanization.visuals]
      : [])
  )
  if (humanizedCall.fullVisualization) {
    fullVisualization.push(...humanizedCall.fullVisualization)
  }
  const delegateCallWarnings = operation !== undefined ? getDelegateCallWarning(operation, to) : []
  if (delegateCallWarnings.length) {
    return {
      fullVisualization,
      warnings: delegateCallWarnings
    }
  }

  return {
    fullVisualization,
    warnings:
      safeStandardHumanization && safeStandardHumanization.warnings
        ? safeStandardHumanization.warnings
        : []
  }
}
