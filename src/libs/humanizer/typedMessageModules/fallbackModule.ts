import { TypedMessage } from '../../../interfaces/userRequest'
import { HumanizerTypedMessaageModule, HumanizerVisualization } from '../interfaces'
import { getLabel } from '../utils'

const fallbackParser = (
  message: { [key: string]: any },
  level: number = 0
): HumanizerVisualization[] => {
  const v: HumanizerVisualization[] = []
  // eslint-disable-next-line no-restricted-syntax
  for (const k in message) {
    if (k in message) {
      if (typeof message[k] === 'object') {
        v.push(getLabel(`${' '.repeat(level)}${k}: \n`))
        v.push(...fallbackParser(message[k], level + 1))
      } else {
        v.push(getLabel(`${' '.repeat(level)}${k}: ${message[k]}\n`))
      }
    }
  }
  return v
}

export const fallbackEIP712Humanizer: HumanizerTypedMessaageModule = (tm: TypedMessage) => {
  return {
    fullVisualization: fallbackParser(tm.params.message, 0),
    warnings: [{ content: 'Unsuccessfully humanized', level: 'caution' }]
  }
}
