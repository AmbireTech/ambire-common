import { isAddress } from 'ethers'

import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule, HumanizerVisualization } from '../interfaces'
import { genericErc20Humanizer } from '../modules/Tokens'
import { getAction, getAddressVisualization, getLabel } from '../utils'

export const safeMessageModule: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind === 'message' || typeof message.content.message === 'string')
    return { fullVisualization: [] }
  if (message.content.primaryType !== 'SafeTx') return { fullVisualization: [] }
  const { to, value, data, operation } = message.content.message
  const { accountAddr } = message
  const { verifyingContract } = message.content.domain
  const humanizedCalls = genericErc20Humanizer({ accountAddr }, [{ to, value, data }])
  // erc20Module
  const fullVisualization: HumanizerVisualization[] = []
  if (!isAddress(verifyingContract)) return {}

  if (operation === 0) {
    fullVisualization.push(
      ...[
        getAction('Safe{Wallet} transaction'),
        getLabel('from'),
        getAddressVisualization(verifyingContract)
      ]
    )
    if (humanizedCalls[0]?.fullVisualization) {
      fullVisualization.push(...humanizedCalls[0].fullVisualization)
    }
  } else if (operation === 1) {
    fullVisualization.push(
      ...[
        getAction('Safe{Wallet} delegated transaction', { warning: true }),
        getLabel('from'),
        getAddressVisualization(verifyingContract)
      ]
    )
  }

  return { fullVisualization }
}
