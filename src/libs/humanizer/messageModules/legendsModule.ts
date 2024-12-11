import { isAddress, isHexString, toUtf8Bytes, toUtf8String, ZeroAddress } from 'ethers'

import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule } from '../interfaces'
import { getAction, getAddressVisualization, getLabel } from '../utils'

export const legendsMessageModule: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'message' || typeof message.content.message !== 'string')
    return { fullVisualization: [] }
  let messageAsText = message.content.message
  if (isHexString(message.content.message) && message.content.message.length % 2 === 0) {
    messageAsText = toUtf8String(toUtf8Bytes(message.content.message))
  }
  if (
    messageAsText.startsWith('Assign to Ambire Legends') &&
    messageAsText.length === `Assign to Ambire Legends ${ZeroAddress}`.length &&
    isAddress(messageAsText.slice('Assign to Ambire Legends '.length))
  )
    return {
      fullVisualization: [
        getAction('Agree to link this account'),
        getLabel('to'),
        getAddressVisualization(messageAsText.slice('Assign to Ambire Legends '.length)),
        getLabel('for Ambire Legends', true)
      ]
    }
  return { fullVisualization: [] }
}
