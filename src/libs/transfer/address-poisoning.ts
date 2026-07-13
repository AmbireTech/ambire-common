import { isAddress } from 'ethers'

import { AddressPoisoningMatch } from '@/interfaces/transfer'

// can render the true shape of the match (for example 6-left / 5-right or even 0-left / 8-right).
const MIN_ADDRESS_POISONING_TOTAL_MATCH_CHARS = 8

/**
 * Address poisoning lookalikes usually preserve a few consecutive chars from the left and/or
 * right side of the original address. We consider any recipient with at least 8 matched chars
 * in total as suspicious, while still keeping the exact prefix/suffix counts so downstream UI
 */
export const getAddressPoisoningMatchCounts = (candidate: string, trustedAddress: string) => {
  const normalizedCandidate = candidate.toLowerCase()
  const normalizedTrustedAddress = trustedAddress.toLowerCase()

  if (
    !isAddress(normalizedCandidate) ||
    !isAddress(normalizedTrustedAddress) ||
    normalizedCandidate === normalizedTrustedAddress
  ) {
    return null
  }

  const candidateBody = normalizedCandidate.slice(2)
  const trustedAddressBody = normalizedTrustedAddress.slice(2)
  let matchedPrefixCharsCount = 0
  let matchedSuffixCharsCount = 0

  while (
    matchedPrefixCharsCount < candidateBody.length &&
    candidateBody[matchedPrefixCharsCount] === trustedAddressBody[matchedPrefixCharsCount]
  ) {
    matchedPrefixCharsCount += 1
  }

  while (
    matchedSuffixCharsCount < candidateBody.length - matchedPrefixCharsCount &&
    candidateBody[candidateBody.length - 1 - matchedSuffixCharsCount] ===
      trustedAddressBody[trustedAddressBody.length - 1 - matchedSuffixCharsCount]
  ) {
    matchedSuffixCharsCount += 1
  }

  if (matchedPrefixCharsCount + matchedSuffixCharsCount < MIN_ADDRESS_POISONING_TOTAL_MATCH_CHARS) {
    return null
  }

  return {
    matchedPrefixCharsCount,
    matchedSuffixCharsCount
  }
}

export type ScoredAddressPoisoningMatch = AddressPoisoningMatch & {
  lastInteractedAt: number | null
}

/**
 * Selects the stronger poisoning match by total overlap, then weakest side strength, then recency.
 */
export const pickBetterPoisoningMatch = (
  bestMatch: ScoredAddressPoisoningMatch | null,
  candidateMatch: ScoredAddressPoisoningMatch
): ScoredAddressPoisoningMatch => {
  if (!bestMatch) return candidateMatch

  const totalMatchedChars =
    candidateMatch.matchedPrefixCharsCount + candidateMatch.matchedSuffixCharsCount
  const bestTotalMatchedChars =
    bestMatch.matchedPrefixCharsCount + bestMatch.matchedSuffixCharsCount
  const weakestSideMatch = Math.min(
    candidateMatch.matchedPrefixCharsCount,
    candidateMatch.matchedSuffixCharsCount
  )
  const bestWeakestSideMatch = Math.min(
    bestMatch.matchedPrefixCharsCount,
    bestMatch.matchedSuffixCharsCount
  )

  if (
    totalMatchedChars > bestTotalMatchedChars ||
    (totalMatchedChars === bestTotalMatchedChars && weakestSideMatch > bestWeakestSideMatch) ||
    (totalMatchedChars === bestTotalMatchedChars &&
      weakestSideMatch === bestWeakestSideMatch &&
      (candidateMatch.lastInteractedAt ?? -1) > (bestMatch.lastInteractedAt ?? -1))
  ) {
    return candidateMatch
  }

  return bestMatch
}
