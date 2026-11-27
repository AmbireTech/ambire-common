import { isAddress } from 'ethers'

import { getSafeTxCallsFromMessage } from '../erc7730/utils'
import { HumanizerTypedMessageFunction, HumanizerVisualization } from '../interfaces'
import {
  getDelegateCallWarning,
  getSafeHumanization,
  getSafeTxNotBrokenDownWarning
} from '../modules/Safe'
import { genericErc20Humanizer } from '../modules/Tokens'
import {
  dedupeWarnings,
  ExpectedTypedData,
  getAction,
  getAddressVisualization,
  getBreak,
  getLabel,
  isExactTypedData,
  withLowerCaseCallData
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
  // the signed message keeps the calldata exactly as the app sent it, but the humanizers match
  // selectors against lower-case hex, so upper-case calldata would otherwise skip them (and their
  // warnings) entirely
  const safeTxCall = withLowerCaseCallData({ to, value, data })
  const humanizedCall = genericErc20Humanizer({ accountAddr }, safeTxCall)
  const safeStandardHumanization = getSafeHumanization(
    verifyingContract ?? undefined,
    to,
    value,
    safeTxCall.data,
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
  // Also for a delegate call to a contract Safe doesn't list, next to its own warning: this is the
  // warning that has to be confirmed before signing, the same as on the sign transaction screen
  // (which shows both too)
  const notBrokenDownWarnings = !getSafeTxCallsFromMessage(message)
    ? [getSafeTxNotBrokenDownWarning()]
    : []

  // a delegate call warning must not hide what the call itself changes (e.g. the account's owners)
  return {
    fullVisualization,
    warnings: dedupeWarnings([
      ...delegateCallWarnings,
      ...notBrokenDownWarnings,
      ...(safeStandardHumanization?.warnings || [])
    ])
  }
}
