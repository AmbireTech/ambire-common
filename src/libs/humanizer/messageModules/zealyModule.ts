import { isHexString, toUtf8String } from 'ethers'

import { Hex } from '../../../interfaces/hex'
import { HumanizerPlainTextMessageModule } from '../interfaces'
import { getAction, getLabel } from '../utils'

/** Humanizes the Zealy log in message */
export const zealyMessageModule: HumanizerPlainTextMessageModule = (message) => {
  if (typeof message.content.message !== 'string') return null
  let messageAsText: Hex | string = message.content.message
  if (isHexString(message.content.message) && message.content.message.length % 2 === 0) {
    try {
      messageAsText = toUtf8String(message.content.message)
    } catch (e) {
      console.log("zealy module: couldn't do toUtf8String on message")
      return null
    }
  }

  if (messageAsText.startsWith('zealy.io wants you to sign in with your Ethereum account'))
    return { fullVisualization: [getAction('Login'), getLabel('in'), getLabel('Zealy', true)] }
  return null
}
