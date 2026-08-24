/**
 * Railgun's own fee, taken by the Railgun Smart Wallet on every shield and unshield. Private
 * transfers pay nothing: the fee exists on the way in and out of the pool, not inside it.
 *
 * Everything here mirrors `RailgunLogic.getFee(amount, isInclusive = true, feeBps)`:
 *
 *   base = amount - (amount * feeBps) / BASIS_POINTS   // integer division, floors
 *   fee  = amount - base
 *
 * "Inclusive" is the part that decides the UX: the amount handed to the contract is split into
 * what passes through and what goes to the treasury, so the fee always comes out of the amount
 * that moves - never as a separate charge. On a shield that means the pool credits less than what
 * left the account; on an unshield the SDK compensates by grossing the amount up first, so the
 * recipient receives exactly what was entered and the fee is taken from the shielded balance.
 */
const RAILGUN_FEE_BPS_DENOMINATOR = 10_000n

/**
 * The rate both fees have been at since Railgun launched. Not read from the contract: governance can
 * change `shieldFee()`/`unshieldFee()` (up to a 50% cap), but reading them per chain would put an
 * RPC call between the user and a figure that has never moved - so this is the one place to correct.
 */
export const RAILGUN_FEE_BPS = 25

/** The rate per direction, so the shield and unshield sides can diverge if they ever do. */
export type RailgunFeeBps = {
  shield: number
  unshield: number
}

export const RAILGUN_FEE_BPS_PAIR: RailgunFeeBps = {
  shield: RAILGUN_FEE_BPS,
  unshield: RAILGUN_FEE_BPS
}

// The contract refuses anything above 50% (`changeFee`), so a value beyond that can only come from
// a bad read - clamping keeps the maths sane (and the unshield gross-up divisible) instead of
// producing amounts nobody should act on.
const MAX_RAILGUN_FEE_BPS = 5_000

const normalizeFeeBps = (feeBps: number): bigint => {
  if (!Number.isFinite(feeBps) || feeBps <= 0) return 0n

  return BigInt(Math.min(Math.trunc(feeBps), MAX_RAILGUN_FEE_BPS))
}

/**
 * The treasury's cut of a shield - the difference between what leaves the account and what the pool
 * credits. Floors like the contract, so a dust-sized shield can genuinely pay nothing.
 */
export const getRailgunShieldFee = (amount: bigint, feeBps: number): bigint => {
  if (amount <= 0n) return 0n

  return (amount * normalizeFeeBps(feeBps)) / RAILGUN_FEE_BPS_DENOMINATOR
}

/** What a shield of `amount` actually credits inside the pool. */
export const getRailgunShieldedAmountAfterFee = (amount: bigint, feeBps: number): bigint => {
  if (amount <= 0n) return 0n

  return amount - getRailgunShieldFee(amount, feeBps)
}

/**
 * The three amounts an unshield of `requestedAmount` involves. The SDK grosses the amount up first
 * (`amount * 10000 / (10000 - unshieldFeeBps)`) so the contract's inclusive fee still leaves the
 * recipient with what was asked for: `spentAmount` leaves the shielded balance, `feeAmount` goes to
 * the treasury, `recipientAmount` arrives (up to the contract's own flooring).
 */
export const getRailgunUnshieldAmounts = (
  requestedAmount: bigint,
  feeBps: number
): { spentAmount: bigint; feeAmount: bigint; recipientAmount: bigint } => {
  if (requestedAmount <= 0n) return { spentAmount: 0n, feeAmount: 0n, recipientAmount: 0n }

  const bps = normalizeFeeBps(feeBps)
  const spentAmount =
    (requestedAmount * RAILGUN_FEE_BPS_DENOMINATOR) / (RAILGUN_FEE_BPS_DENOMINATOR - bps)
  const recipientAmount = spentAmount - (spentAmount * bps) / RAILGUN_FEE_BPS_DENOMINATOR

  return { spentAmount, feeAmount: spentAmount - recipientAmount, recipientAmount }
}
