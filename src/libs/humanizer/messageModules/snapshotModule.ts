import { isAddress } from 'viem'

import { HumanizerTypedMessageFunction } from '../interfaces'
import {
  ExpectedTypedData,
  getAction,
  getAddressVisualization,
  getLabel,
  getWarning,
  isExactTypedData,
  TypedDataField
} from '../utils'

/** Builds a Snapshot `Vote` definition for one type of `from`, `proposal` id and `choice` */
const getSnapshotVoteTypedData = (
  fromType: string,
  proposalType: string,
  choiceType: string
): ExpectedTypedData => {
  const fields: TypedDataField[] = [
    { name: 'from', type: fromType },
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
 * The Snapshot `Vote` definitions. snapshot.js 0.14 and later sign `from` as `string`,
 * and earlier versions sign it as `address`. The `bytes32` proposal ids are not in the
 * published snapshot.js versions that were checked. Votes that were signed with the
 * older types can still be in the signed message history.
 */
const SNAPSHOT_VOTE_TYPED_DATA: ExpectedTypedData[] = ['string', 'address'].flatMap((fromType) =>
  ['string', 'bytes32'].flatMap((proposalType) =>
    ['uint32', 'uint32[]', 'string'].map((choiceType) =>
      getSnapshotVoteTypedData(fromType, proposalType, choiceType)
    )
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

const ALIAS_ADDRESS_FIELDS: TypedDataField[] = [
  { name: 'from', type: 'address' },
  { name: 'alias', type: 'address' }
]

/**
 * The Snapshot `Alias` and `RevokeAlias` definitions, as snapshot.js signs them: without
 * `timestamp` (before version 0.12) and with it (version 0.12 and later). Old messages
 * can still be in the signed message history.
 */
const getSnapshotAliasTypedData = (primaryType: string): ExpectedTypedData[] =>
  [ALIAS_ADDRESS_FIELDS, [...ALIAS_ADDRESS_FIELDS, { name: 'timestamp', type: 'uint64' }]].map(
    (fields) => ({ primaryType, types: { [primaryType]: fields } })
  )

const SNAPSHOT_ALIAS_TYPED_DATA = getSnapshotAliasTypedData('Alias')
const SNAPSHOT_REVOKE_ALIAS_TYPED_DATA = getSnapshotAliasTypedData('RevokeAlias')

/**
 * Returns the signed `alias` address when the message matches one of the definitions, the
 * domain is Snapshot and the signer is the account that signs. Otherwise returns null.
 */
const getAliasAddress = (
  message: Parameters<HumanizerTypedMessageFunction>[0],
  typedDataDefinitions: ExpectedTypedData[]
): string | null => {
  if (
    message.content.domain.name !== 'snapshot' ||
    !typedDataDefinitions.some((typedData) => isExactTypedData(message.content, typedData))
  )
    return null

  const { from, alias } = message.content.message
  if (!isAddress(from, { strict: false }) || !isAddress(alias, { strict: false })) return null
  // The signer is always the account that signs. Any other `from` is not a valid alias request
  if (from.toLowerCase() !== message.accountAddr.toLowerCase()) return null

  return alias
}

/** Humanizes a Snapshot alias (primary type `Alias`): the alias address can act for the signer on Snapshot */
export const humanizeSnapshotAlias: HumanizerTypedMessageFunction = (message) => {
  const alias = getAliasAddress(message, SNAPSHOT_ALIAS_TYPED_DATA)
  if (!alias) return null

  return {
    fullVisualization: [
      getAction('Allow'),
      getAddressVisualization(alias),
      getLabel('to act for you on'),
      getLabel('Snapshot', true)
    ],
    warnings: [
      getWarning(
        'This address will be able to vote and act for you on Snapshot. Sign it only if you control this address or you fully trust it.',
        'SNAPSHOT_ALIAS'
      )
    ]
  }
}

/** Humanizes the removal of a Snapshot alias (primary type `RevokeAlias`) */
export const humanizeSnapshotRevokeAlias: HumanizerTypedMessageFunction = (message) => {
  const alias = getAliasAddress(message, SNAPSHOT_REVOKE_ALIAS_TYPED_DATA)
  if (!alias) return null

  return {
    fullVisualization: [
      getAction('Stop'),
      getAddressVisualization(alias),
      getLabel('from acting for you on'),
      getLabel('Snapshot', true)
    ]
  }
}
