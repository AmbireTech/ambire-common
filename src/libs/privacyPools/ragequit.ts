import { Interface } from 'ethers'

/** A pool's public reclaim of a deposit, which only the account that made it can call. */
export const POOL_RAGEQUIT_INTERFACE = new Interface([
  'function ragequit((uint256[2] pA, uint256[2][2] pB, uint256[2] pC, uint256[4] pubSignals) _proof)'
])

export type PrivacyPoolsRagequitCall = {
  /** What goes back to the depositor: what is left of the deposit. */
  amount: bigint
  label: bigint
}

/**
 * Decodes a pool's ragequit call. The proof's public signals are `[commitment, nullifierHash,
 * value, label]`. Null for any other or undecodable call.
 */
export const readPrivacyPoolsRagequit = (data: string): PrivacyPoolsRagequitCall | null => {
  let parsed
  try {
    parsed = POOL_RAGEQUIT_INTERFACE.parseTransaction({ data })
  } catch {
    return null
  }
  if (!parsed) return null

  const [, , , pubSignals] = parsed.args[0]

  return { amount: BigInt(pubSignals[2]), label: BigInt(pubSignals[3]) }
}
