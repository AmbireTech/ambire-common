import { getAddress, Interface, toBeHex } from 'ethers'

import { Hex } from '../../interfaces/hex'

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

/**
 * The address each deposit was made from, by label, read from the SDK's persisted public state of a
 * chain (stored under `getPrivacyPoolsStoreKey`): every deposit in its pools, as synced in bulk.
 *
 * Read from there rather than with the SDK's `history()` or the pool's `depositors(label)`: both ask
 * the network about single deposits, which tells it which ones are the user's.
 *
 * Labels it does not find are left out. Throws if the state is not the shape it reads, so an SDK
 * that changes it fails clearly instead of reporting no deposits.
 */
export const readPrivacyPoolsDepositors = (
  storedState: string | null,
  labels: bigint[]
): Map<bigint, Hex> => {
  const depositors = new Map<bigint, Hex>()
  if (!storedState || !labels.length) return depositors

  const depositsTuples: unknown = JSON.parse(storedState)?.deposits?.depositsTuples
  if (!Array.isArray(depositsTuples))
    throw new Error('privacyPools: the stored state has no deposits')

  const wantedLabels = new Set(labels)
  depositsTuples.forEach((tuple: unknown) => {
    // Each is `[precommitment, deposit]`, its numbers as hex strings
    const deposit = Array.isArray(tuple) ? tuple[1] : null
    if (typeof deposit?.label !== 'string' || typeof deposit?.depositor !== 'string') return

    const label = BigInt(deposit.label)
    if (!wantedLabels.has(label)) return

    depositors.set(label, getAddress(toBeHex(BigInt(deposit.depositor), 20)) as Hex)
  })

  return depositors
}
