import { isAddress } from 'ethers'

import { HumanizerTypedMessageFunction, HumanizerVisualization } from '../interfaces'
import { getDelegateCallWarning, getSafeHumanization } from '../modules/Safe'
import { genericErc20Humanizer } from '../modules/Tokens'
import {
  ExpectedTypedData,
  getAction,
  getAddressVisualization,
  getBreak,
  getLabel,
  isExactTypedData
} from '../utils'

/** Safe{WALLET} transaction (v1.0.0 and later), as the Safe contracts sign it */
const SAFE_TX_TYPED_DATA: ExpectedTypedData = {
  primaryType: 'SafeTx',
  types: {
    SafeTx: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
      { name: 'operation', type: 'uint8' },
      { name: 'safeTxGas', type: 'uint256' },
      { name: 'baseGas', type: 'uint256' },
      { name: 'gasPrice', type: 'uint256' },
      { name: 'gasToken', type: 'address' },
      { name: 'refundReceiver', type: 'address' },
      { name: 'nonce', type: 'uint256' }
    ]
  }
}

/** Humanizes a Safe{WALLET} transaction (primary type `SafeTx`) */
export const humanizeSafeTx: HumanizerTypedMessageFunction = (message) => {
  if (!isExactTypedData(message.content, SAFE_TX_TYPED_DATA)) return null

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
