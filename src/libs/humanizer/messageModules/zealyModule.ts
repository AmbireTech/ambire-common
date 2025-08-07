import { isHexString, toUtf8String } from 'ethers'

import { Hex } from '../../../interfaces/hex'
import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule } from '../interfaces'
import { getAction, getLabel } from '../utils'

export const zealyMessageModule: HumanizerTypedMessageModule = (message: Message) => {
  if (message.content.kind !== 'message' || typeof message.content.message !== 'string')
    return { fullVisualization: [] }
  let messageAsText: Hex | string = message.content.message
  if (isHexString(message.content.message) && message.content.message.length % 2 === 0) {
    messageAsText = toUtf8String(message.content.message)
  }

  if (messageAsText.startsWith('zealy.io wants you to sign in with your Ethereum account'))
    return { fullVisualization: [getAction('Login'), getLabel('in'), getLabel('Zealy', true)] }
  return { fullVisualization: [] }
}
