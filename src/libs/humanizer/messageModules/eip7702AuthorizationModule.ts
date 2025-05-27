import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule } from '../interfaces'
import { getAction, getAddressVisualization, getChain, getLabel, getText } from '../utils'

export const eip7702AuthorizationModule: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'authorization-7702') return { fullVisualization: [] }

  return {
    fullVisualization: [
      getAction('EIP-7702 Authorization'),
      getChain(message.content.chainId),
      getText('Nonce'),
      getLabel(message.content.nonce.toString()),
      getText('Implementation'),
      getAddressVisualization(message.content.contractAddr)
    ]
  }
}
