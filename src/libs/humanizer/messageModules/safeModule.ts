import { isAddress } from 'ethers'

import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule, HumanizerVisualization } from '../interfaces'
import { getSafeHumanization } from '../modules/Safe'
import { genericErc20Humanizer } from '../modules/Tokens'
import { getAction, getAddressVisualization, getBreak, getLabel, getWarning } from '../utils'

export const safeMessageModule: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind === 'message' || typeof message.content.message === 'string')
    return { fullVisualization: [] }
  if (message.content.primaryType !== 'SafeTx') return { fullVisualization: [] }
  const { to, value, data, operation } = message.content.message
  const { accountAddr } = message
  const { verifyingContract } = message.content.domain
  const humanizedCalls = genericErc20Humanizer({ accountAddr }, [{ to, value, data }])
  const ownerHumanization = getSafeHumanization(verifyingContract ?? undefined, to, value, data)
  const fullVisualization: HumanizerVisualization[] = []
  if (!isAddress(verifyingContract)) return {}
  fullVisualization.push(
    ...[
      getAction('Safe{WALLET} transaction'),
      getLabel('from'),
      getAddressVisualization(verifyingContract)
    ],
    ...(ownerHumanization && ownerHumanization.visuals
      ? [getBreak(), ...ownerHumanization.visuals]
      : [])
  )
  if (humanizedCalls[0]?.fullVisualization) {
    fullVisualization.push(...humanizedCalls[0].fullVisualization)
  }
  if (operation === 1) {
    return {
      fullVisualization,
      warnings: [
        getWarning('Delegate call from Safe{WALLET} account', 'SAFE{WALLET}_DELEGATE_CALL')
      ]
    }
  }

  return {
    fullVisualization,
    warnings: ownerHumanization && ownerHumanization.warnings ? ownerHumanization.warnings : []
  }
}
