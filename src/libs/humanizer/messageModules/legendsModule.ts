import { isHexString, toUtf8Bytes, toUtf8String } from 'ethers'

import { Hex } from '../../../interfaces/hex'
import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule } from '../interfaces'
import { getAction, getAddressVisualization, getLabel } from '../utils'

export const legendsMessageModule: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'message' || typeof message.content.message !== 'string')
    return { fullVisualization: [] }
  let messageAsText: Hex | string = message.content.message
  if (isHexString(message.content.message) && message.content.message.length % 2 === 0) {
    messageAsText = toUtf8String(toUtf8Bytes(message.content.message))
  }
  const messageRegex = /Assign 0x[a-fA-F0-9]{40} to Ambire Rewards 0x[a-fA-F0-9]{40}/
  const addressRegex = /0x[a-fA-F0-9]{40}/g
  const addresses = messageAsText.match(addressRegex)
  const firstAddr = addresses?.[0]
  const secondAddr = addresses?.[1]
  if (messageAsText.match(messageRegex) && firstAddr === message.accountAddr && secondAddr)
    return {
      fullVisualization: [
        getAction('Link'),
        getAddressVisualization(firstAddr),
        getLabel('to'),
        getAddressVisualization(secondAddr),
        getLabel('for Ambire Rewards', true)
      ]
    }
  return { fullVisualization: [] }
}
