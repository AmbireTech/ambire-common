import { isHexString, toUtf8Bytes, toUtf8String, ZeroAddress } from 'ethers'

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
  const regex = /Assign 0x[a-fA-F0-9]{40} to Ambire Legends 0x[a-fA-F0-9]{40}/
  if (typeof messageAsText === 'string' && messageAsText.match(regex))
    return {
      fullVisualization: [
        getAction('Agree to link'),
        getAddressVisualization(
          messageAsText.slice('Assign '.length, `Assign ${ZeroAddress}`.length)
        ),
        getLabel('to'),
        getAddressVisualization(
          messageAsText.slice(`Assign ${ZeroAddress} to Ambire Legends `.length)
        ),
        getLabel('for Ambire Legends', true)
      ]
    }
  return { fullVisualization: [] }
}
