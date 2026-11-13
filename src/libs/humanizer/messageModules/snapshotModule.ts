import { HumanizerTypedMessageFunction } from '../interfaces'
import { getAction, getLabel } from '../utils'

/** Humanizes a Snapshot vote (primary type `Vote`) */
export const humanizeSnapshotVote: HumanizerTypedMessageFunction = (message) => {
  if (
    message.content.domain.name === 'snapshot' &&
    message.content.message.choice &&
    message.content.message.space
  ) {
    return {
      fullVisualization: [
        getAction('Vote'),
        getLabel('in'),
        getLabel('Snapshot:', true),
        getLabel(message.content.message.space, true)
      ]
    }
  }
  return { fullVisualization: [] }
}
