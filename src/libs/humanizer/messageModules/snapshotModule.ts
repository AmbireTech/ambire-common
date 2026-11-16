import { HumanizerTypedMessageFunction } from '../interfaces'
import { ExpectedTypedData, getAction, getLabel, isExactTypedData, TypedDataField } from '../utils'

/** Builds a Snapshot `Vote` definition for one type of `proposal` id and one type of `choice` */
const getSnapshotVoteTypedData = (proposalType: string, choiceType: string): ExpectedTypedData => {
  const fields: TypedDataField[] = [
    { name: 'from', type: 'string' },
    { name: 'space', type: 'string' },
    { name: 'timestamp', type: 'uint64' },
    { name: 'proposal', type: proposalType },
    { name: 'choice', type: choiceType },
    { name: 'reason', type: 'string' },
    { name: 'app', type: 'string' },
    { name: 'metadata', type: 'string' }
  ]
  return { primaryType: 'Vote', types: { Vote: fields } }
}

/**
 * The Snapshot `Vote` definitions, as snapshot.js signs them. The `bytes32`
 * proposal ids were removed from snapshot.js in December 2025, but votes that
 * were signed with them can still be in the signed message history.
 */
const SNAPSHOT_VOTE_TYPED_DATA: ExpectedTypedData[] = ['string', 'bytes32'].flatMap(
  (proposalType) =>
    ['uint32', 'uint32[]', 'string'].map((choiceType) =>
      getSnapshotVoteTypedData(proposalType, choiceType)
    )
)

/** Humanizes a Snapshot vote (primary type `Vote`) */
export const humanizeSnapshotVote: HumanizerTypedMessageFunction = (message) => {
  if (
    message.content.domain.name === 'snapshot' &&
    SNAPSHOT_VOTE_TYPED_DATA.some((typedData) => isExactTypedData(message.content, typedData)) &&
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
  return null
}
