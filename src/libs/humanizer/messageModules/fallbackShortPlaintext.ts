import { toUtf8String } from 'ethers'

import { Message } from '../../../interfaces/userRequest'
import { HumanizerTypedMessageModule, HumanizerVisualization } from '../interfaces'
import { getBreak, getLabel } from '../utils'

export const fallbackShortPlaintext: HumanizerTypedMessageModule = (message: Message) => {
  if (
    message.content.kind !== 'message' ||
    typeof message.content.message !== 'string' ||
    message.content.message.length >= 200
  )
    return { fullVisualization: [] }

  // the message should be hex always. If it is not, the issue is not in this module and
  // should be resolved upstream
  const readableWords = toUtf8String(message.content.message)

  // const lines: (string | HumanizerVisualization)[] = []
  const lines = readableWords.split('\n')
  const fullVisualization = lines
    .map((w, i) => {
      const labels: HumanizerVisualization[] = w.split(' ').map((w) => getLabel(w))
      if (lines.length !== i + 1) labels.push(getBreak())
      return labels
    })
    .flat()

  return {
    fullVisualization,
    canHideDropdownArrow: true
  }
}
