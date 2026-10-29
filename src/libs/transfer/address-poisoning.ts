import { isAddress } from 'ethers'

import { AddressPoisoningMatch } from '@/interfaces/transfer'

/**
 * Address poisoning lookalikes usually preserve a few consecutive chars from the left and/or
 * right side of the original address. We consider any recipient with at least 6 matched chars
 * in total as suspicious, while still keeping the exact prefix/suffix counts so downstream UI
 * can render the true shape of the match (for example 4-left / 3-right or even 0-left / 6-right).
 * With 1,000 past recipients, two unrelated addresses trigger it on ~0.04% of sends.
 */
const MIN_ADDRESS_POISONING_TOTAL_MATCH_CHARS = 6

/**
 * An address that differs from a known one in only this many positions is a typo, not
 * poisoning: nobody can generate a lookalike that matches 37+ of the 40 chars.
 */
export const MAX_NEAR_IDENTICAL_ADDRESS_DIFFERING_CHARS = 3

/**
 * Whether the match is so close that the user most likely mistyped the known address.
 */
export const isNearIdenticalAddressMatch = ({ differingCharsCount }: AddressPoisoningMatch) =>
  differingCharsCount <= MAX_NEAR_IDENTICAL_ADDRESS_DIFFERING_CHARS

const getDifferingCharsCount = (a: string, b: string) => {
  let differingCharsCount = 0
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) differingCharsCount += 1
  }
  return differingCharsCount
}

/**
 * Compares a recipient with a trusted address and returns the shape of the match, or null when
 * the two are neither poisoning lookalikes (matching edges) nor near-identical (a likely typo).
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

  const differingCharsCount = getDifferingCharsCount(candidateBody, trustedAddressBody)

  if (
    matchedPrefixCharsCount + matchedSuffixCharsCount < MIN_ADDRESS_POISONING_TOTAL_MATCH_CHARS &&
    differingCharsCount > MAX_NEAR_IDENTICAL_ADDRESS_DIFFERING_CHARS
  ) {
    return null
  }

  return {
    matchedPrefixCharsCount,
    matchedSuffixCharsCount,
    differingCharsCount
  }
}

export type ScoredAddressPoisoningMatch = AddressPoisoningMatch & {
  lastInteractedAt: number | null
}

/**
 * Selects the stronger poisoning match. A near-identical match wins (fewest differing chars
 * first), then total overlap, then weakest side strength, then recency.
 */
export const pickBetterPoisoningMatch = (
  bestMatch: ScoredAddressPoisoningMatch | null,
  candidateMatch: ScoredAddressPoisoningMatch
): ScoredAddressPoisoningMatch => {
  if (!bestMatch) return candidateMatch

  if (
    (isNearIdenticalAddressMatch(candidateMatch) || isNearIdenticalAddressMatch(bestMatch)) &&
    candidateMatch.differingCharsCount !== bestMatch.differingCharsCount
  ) {
    return candidateMatch.differingCharsCount < bestMatch.differingCharsCount
      ? candidateMatch
      : bestMatch
  }

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
