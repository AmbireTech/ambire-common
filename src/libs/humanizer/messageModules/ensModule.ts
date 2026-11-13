import { HumanizerTypedMessageFunction } from '../interfaces'
import { getAction, getDeadline, getLabel } from '../utils'

/** Humanizes an ENS profile picture upload (primary type `Upload`) */
export const humanizeEnsUpload: HumanizerTypedMessageFunction = (message) => {
  if (message.content.domain.name === 'Ethereum Name Service') {
    if (
      message.content.message.upload === 'avatar' &&
      message.content.message.name &&
      message.content.message.expiry
    )
      return {
        fullVisualization: [
          getAction('Update'),
          getLabel('ENS profile pic of'),
          getLabel(message.content.message.name),
          getDeadline(BigInt(message.content.message.expiry) / 1000n)
        ]
      }
  }
  return { fullVisualization: [] }
}
