import { isAddress, toUtf8String } from 'ethers'

import { HumanizerPlainTextMessageModule } from '../interfaces'
import { getAction, getAddressVisualization, getLabel } from '../utils'

/** Shows a short, one-line plain text message as words and addresses. Used when no other module matches */
export const fallbackShortPlaintext: HumanizerPlainTextMessageModule = (message) => {
  if (typeof message.content.message !== 'string' || message.content.message.length >= 200)
    return null

  // the message should be hex always. If it is not, the issue is not in this module and
  // should be resolved upstream
  const readableText = toUtf8String(message.content.message)

  if (readableText.includes('\n')) return null

  return {
    fullVisualization: [
      getAction('Message: '),
      ...readableText
        .split(' ')
        .map((w) => (isAddress(w) ? getAddressVisualization(w) : getLabel(w)))
    ],
    canHideDropdownArrow: true
  }
}
