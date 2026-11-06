import { getAddress, toBeHex } from 'ethers'

import type { PPv1HistoryEvent } from '@kohaku-eth/privacy-pools'

import { fromPrivacyPoolsAssetAddress } from '../../consts/privacyPools'
import { Hex } from '../../interfaces/hex'
import { PrivacyPoolsApprovalStatus, PrivacyPoolsHistoryEntry } from '../../interfaces/privacyPools'
import { getPage, Pagination, PaginationResult } from '../../utils/paginate'

const toAddress = (address: bigint): Hex => getAddress(toBeHex(address, 20)) as Hex

const getStatus = (
  event: PPv1HistoryEvent,
  pendingLabels: Set<bigint>
): PrivacyPoolsApprovalStatus | null => {
  if (event.type !== 'deposit') return null
  if (event.aspStatus === 'approved') return 'approved'

  // Still 'pending' after it is taken back, so only a note left tells it is being verified
  return pendingLabels.has(event.label) ? 'pending' : null
}

/**
 * The plugin's history of one chain in the wallet's terms, in the plugin's order (newest first).
 * `pendingLabels` are the labels of the account's notes still being verified, from the same sync:
 * a deposit's own status stays 'pending' after it is taken back, so the notes tell which deposits
 * are still under review.
 */
export const toPrivacyPoolsHistoryEntries = ({
  chainId,
  events,
  pendingLabels
}: {
  chainId: string
  events: PPv1HistoryEvent[]
  pendingLabels: Set<bigint>
}): PrivacyPoolsHistoryEntry[] => {
  // A source that records no log index reports 0, so two events of a block can share a base id
  const idCounts = new Map<string, number>()

  return events.map((event) => {
    const baseId = `${chainId}-${event.type}-${event.blockNumber}-${event.logIndex}`
    const idCount = idCounts.get(baseId) || 0
    idCounts.set(baseId, idCount + 1)

    return {
      id: idCount ? `${baseId}-${idCount}` : baseId,
      type: event.type,
      chainId,
      tokenAddress: fromPrivacyPoolsAssetAddress(event.assetAddress),
      amount: event.value,
      timestamp: Number(event.timestamp) * 1000,
      // 0n when the source did not record it
      txnId: event.transactionHash ? (toBeHex(event.transactionHash, 32) as Hex) : null,
      counterpartyAddr:
        event.type === 'deposit'
          ? toAddress(event.depositor)
          : event.type === 'ragequit'
            ? toAddress(event.ragequitter)
            : null,
      status: getStatus(event, pendingLabels)
    }
  })
}

/**
 * A page of the history of several chains, merged newest first. Each chain's history must already
 * be newest first, as the plugin returns it.
 */
export const getPrivacyPoolsHistoryPage = (
  histories: PrivacyPoolsHistoryEntry[][],
  { fromPage, itemsPerPage }: Pagination
): PaginationResult<PrivacyPoolsHistoryEntry> => {
  // Sorted only across chains: the order of one chain's events in a block is the plugin's
  const merged =
    histories.length === 1
      ? histories[0]!
      : histories.flat().sort((a, b) => b.timestamp - a.timestamp)

  return getPage(merged, fromPage, itemsPerPage)
}
