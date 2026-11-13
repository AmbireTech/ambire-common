import { HumanizerAuthorizationMessage, HumanizerMessageResult } from '../interfaces'
import { getAction, getAddressVisualization, getChain, getLabel, getText } from '../utils'

/** Humanizes an EIP-7702 authorization */
export const eip7702AuthorizationModule = (
  message: HumanizerAuthorizationMessage
): HumanizerMessageResult => {
  return {
    fullVisualization: [
      getAction('EIP-7702 Authorization'),
      getChain(message.chainId),
      getText('Nonce'),
      getLabel(message.content.nonce.toString()),
      getText('Implementation'),
      getAddressVisualization(message.content.contractAddr)
    ]
  }
}
