import { AbiCoder, getAddress } from 'ethers'

/**
 * The parts of the SDK's relayer `PPv1PrivateOperation` read here (it does not export the
 * variant). What the broadcaster hands the relayer: the withdrawal, its proof, the pool's scope and
 * the relayer's signed fee commitment.
 */
export type PrivacyPoolsRelayedWithdrawalPayload = {
  rawData: {
    /** A Groth16 proof as snarkjs outputs it, with its public signals. */
    proof: {
      proof: { pi_a: string[]; pi_b: string[][]; pi_c: string[] }
      publicSignals: string[]
    }
    withdrawalPayload: { processooor: string; data: string }
    scope: bigint
  }
  quoteData: {
    quote: {
      /** The fee the relayer quoted, in basis points. */
      feeBPS: string
      feeCommitment: {
        /** When the relayer stops accepting the withdrawal, in milliseconds. */
        expiration: number
        withdrawalData: string
      }
    }
    /** The relayer's name, as the protocol's relayers list has it. */
    relayerId: string
  }
}

/**
 * `withdrawal.data`, as the entrypoint decodes it to split the funds between the recipient and the
 * relayer.
 */
const RELAY_DATA_TYPE = 'tuple(address recipient, address feeRecipient, uint256 relayFeeBPS)'

/** The circuit orders outputs before inputs, so the withdrawn value is the third signal. */
const WITHDRAWN_VALUE_SIGNAL_INDEX = 2

const BASIS_POINTS_DENOMINATOR = 10_000n

const isSameAddress = (a: string, b: string) => getAddress(a) === getAddress(b)

/**
 * What a prepared relayed withdrawal does, read from the bytes the relayer and the entrypoint act
 * on, so it can be shown as what will happen rather than as what was asked for.
 */
export type PrivacyPoolsRelayedWithdrawal = {
  /** Who receives the funds. */
  recipient: string
  /** The withdrawn token, in the wallet's own convention - `ZERO_ADDRESS` for native. */
  tokenAddress: string
  /** What leaves the Privacy Pools account, before the fee. */
  amount: bigint
  /** The relayer's fee, taken out of `amount`. Exact: the relayer refunds nothing. */
  fee: bigint
  /** When the relayer stops accepting the withdrawal, in milliseconds. */
  expiresAt: number
}

/**
 * Decodes a prepared relayed withdrawal and checks it against the request, returning what it does
 * - to show it from the payload rather than from the request.
 *
 * Security boundary: the SDK takes the relayer's quote, proves and assembles the withdrawal in one
 * call, so this is the one place to verify, from the bytes the relayer and the entrypoint act on,
 * the relayer, the pool, the recipient, the amount and the fee. Any mismatch is refused before the
 * user is asked to send it. The proof binds these bytes, so the relayer cannot change them after.
 */
export const readRelayedWithdrawal = ({
  withdrawal,
  relayers,
  entrypointAddress,
  poolScope,
  maxRelayFeeBPS,
  recipient,
  tokenAddress,
  amount
}: {
  withdrawal: PrivacyPoolsRelayedWithdrawalPayload
  /** The chain's relayers, by name - see `PrivacyPoolsChainConfig.relayers`. */
  relayers: { [name: string]: string }
  entrypointAddress: string
  /** The token's pool's scope: the entrypoint withdraws from the pool the payload's scope names. */
  poolScope: bigint
  /** The entrypoint's ceiling for the token, read from the chain. */
  maxRelayFeeBPS: bigint
  recipient: string
  /** The withdrawn token, in the wallet's own convention - `ZERO_ADDRESS` for native. */
  tokenAddress: string
  amount: bigint
}): PrivacyPoolsRelayedWithdrawal => {
  const { rawData, quoteData } = withdrawal
  const { withdrawalPayload } = rawData
  const { feeCommitment } = quoteData.quote

  if (!Object.keys(relayers).includes(quoteData.relayerId))
    throw new Error('privacyPools: the withdrawal is quoted by an unknown relayer')
  // Otherwise another token's pool would pass, its amount compared as if it were this token's
  if (BigInt(rawData.scope) !== poolScope)
    throw new Error('privacyPools: the withdrawal is from the pool of a different token')
  // The entrypoint pays out only a withdrawal it processes itself
  if (!isSameAddress(withdrawalPayload.processooor, entrypointAddress))
    throw new Error('privacyPools: the withdrawal is processed by an unexpected contract')
  // The relayer checks the withdrawal against its signed commitment, and refuses any other
  if (withdrawalPayload.data.toLowerCase() !== feeCommitment.withdrawalData.toLowerCase())
    throw new Error('privacyPools: the withdrawal differs from what the relayer committed to')

  const [relayData] = AbiCoder.defaultAbiCoder().decode([RELAY_DATA_TYPE], withdrawalPayload.data)
  const relayFeeBPS = BigInt(relayData.relayFeeBPS)

  if (!isSameAddress(relayData.recipient, recipient))
    throw new Error('privacyPools: the withdrawal pays out to a different address than requested')
  if (relayFeeBPS > BigInt(quoteData.quote.feeBPS))
    throw new Error('privacyPools: the relayer committed to a higher fee than it quoted')
  // The entrypoint would revert it, after the relayer has spent gas on it
  if (relayFeeBPS > maxRelayFeeBPS)
    throw new Error('privacyPools: the relayer fee is above what the pool allows')

  const withdrawnAmount = BigInt(rawData.proof.publicSignals[WITHDRAWN_VALUE_SIGNAL_INDEX] ?? -1)
  if (withdrawnAmount !== amount)
    throw new Error('privacyPools: the withdrawal proves a different amount than requested')

  // Rounded down, as the entrypoint does
  const fee = (amount * relayFeeBPS) / BASIS_POINTS_DENOMINATOR
  if (fee >= amount) throw new Error('privacyPools: the withdrawal fee would take the whole amount')

  return {
    recipient: getAddress(relayData.recipient),
    // The pool's token: the scope is checked above to be that of the pool the entrypoint lists
    tokenAddress,
    amount: withdrawnAmount,
    fee,
    expiresAt: feeCommitment.expiration
  }
}
