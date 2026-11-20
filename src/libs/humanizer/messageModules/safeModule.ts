import { isAddress } from 'ethers'

import { Message } from '../../../interfaces/userRequest'
import { getSafeTxCallsFromMessage } from '../erc7730/utils'
import { HumanizerTypedMessageModule, HumanizerVisualization } from '../interfaces'
import {
  getDelegateCallWarning,
  getSafeHumanization,
  getSafeTxNotBrokenDownWarning
} from '../modules/Safe'
import { genericErc20Humanizer } from '../modules/Tokens'
import {
  dedupeWarnings,
  getAction,
  getAddressVisualization,
  getBreak,
  getLabel,
  withLowerCaseCallData
} from '../utils'

export const safeMessageModule: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind === 'message' || typeof message.content.message === 'string')
    return { fullVisualization: [] }
  if (message.content.primaryType !== 'SafeTx') return { fullVisualization: [] }
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
  if (!isAddress(verifyingContract)) return {}
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
