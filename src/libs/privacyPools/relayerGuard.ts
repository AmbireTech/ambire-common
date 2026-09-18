import { AbiCoder, getAddress } from 'ethers'

import {
  PRIVACY_POOLS_MAX_RELAY_FEE_BPS,
  PRIVACY_POOLS_QUOTE_MIN_REMAINING_MS
} from '../../consts/privacyPools'

/**
 * The relayer's answer to a quote request, as `@kohaku-eth/privacy-pools` models it. Declared here
 * rather than imported because the SDK does not re-export `IRelayerClient` from its entry point and
 * its `exports` map blocks deep imports. TypeScript is structural, so a matching shape still
 * satisfies `relayerClientFactory`.
 */
export type PrivacyPoolsQuoteResponse = {
  baseFeeBPS: string
  feeBPS: string
  gasPrice: string
  feeCommitment: {
    expiration: number
    withdrawalData: string
    signedRelayerCommitment: string
    extraGas?: boolean
  }
  detail: unknown
}

export type PrivacyPoolsQuoteRequest = {
  relayerUrl: string
  chainId: bigint
  amount: bigint
  /** The SDK passes addresses around as bigints, not hex strings. */
  asset: bigint
  recipient: bigint
  extraGas?: boolean
}

export type PrivacyPoolsRelayerClient = {
  getQuote(body: PrivacyPoolsQuoteRequest): Promise<PrivacyPoolsQuoteResponse>
  relay(body: any): Promise<{ success: true; timestamp: number; requestId: string; txHash: string }>
  getFees(body: { relayerUrl: string; chainId: bigint; assetAddress: bigint }): Promise<{
    feeBPS: string
    feeReceiverAddress: string
    chainId: number
    assetAddress: string
    minWithdrawAmount: string
    maxGasPrice: string
  }>
}

/** What a relayer actually committed to, recovered from the bytes rather than from its claims. */
export type DecodedRelayData = {
  recipient: string
  feeRecipient: string
  relayFeeBps: bigint
}

/**
 * `IEntrypoint.RelayData`, the tuple the entrypoint decodes `withdrawal.data` into before splitting
 * the withdrawn funds between recipient and fee recipient.
 */
const RELAY_DATA_ABI = ['tuple(address recipient, address feeRecipient, uint256 relayFeeBPS)']

export const decodeRelayData = (withdrawalData: string): DecodedRelayData => {
  const [decoded] = AbiCoder.defaultAbiCoder().decode(RELAY_DATA_ABI, withdrawalData)

  return {
    recipient: getAddress(decoded.recipient),
    feeRecipient: getAddress(decoded.feeRecipient),
    relayFeeBps: BigInt(decoded.relayFeeBPS)
  }
}

export class PrivacyPoolsRelayerQuoteError extends Error {}

/**
 * Turns a fee that overshot the entrypoint's ceiling into advice.
 *
 * The relayer charges roughly a fixed amount of gas whatever the withdrawal size, so the share it
 * represents shrinks as the amount grows: the smallest amount whose fee fits under the ceiling is
 * `amount * quotedBps / maxBps`, rounded up. Approximate rather than exact, since the gas price
 * moves between quotes - the wording says "about" for that reason.
 */
const describeMinimumWithdrawal = ({
  requestedAmount,
  relayFeeBps,
  maxRelayFeeBps,
  describeAmount
}: {
  requestedAmount?: bigint
  relayFeeBps: bigint
  maxRelayFeeBps: bigint
  describeAmount?: (amount: bigint) => string
}): string => {
  const generic =
    'The fee for sending this withdrawal is larger than this pool allows. Try withdrawing a larger amount.'

  if (!requestedAmount || maxRelayFeeBps <= 0n || !describeAmount) return generic

  const minimum = (requestedAmount * relayFeeBps + maxRelayFeeBps - 1n) / maxRelayFeeBps

  return `The fee for sending this withdrawal is larger than this pool allows. Withdraw about ${describeAmount(
    minimum
  )} or more, or send it yourself without a relayer.`
}

/**
 * Checks that a quote commits to the withdrawal we actually asked for.
 *
 * This is the wallet's own guard, not a second opinion: the SDK's `quoteThunk` calls a
 * `validateWithdrawalData` that is an empty function with a TODO in its place, so nothing upstream
 * compares the relayer's bytes against the request.
 *
 * It matters because the proof binds to `context = keccak256(abi.encode(withdrawal, scope))`, where
 * `withdrawal.data` is whatever the relayer returned. A relayer that swaps in its own address gets
 * a valid proof over its own payout, and the entrypoint pays it out - the ZK proof guarantees the
 * note is spendable, never that it is being spent as intended.
 *
 * Throws rather than returning a flag: a failed check must stop the withdrawal, and a caller that
 * forgets to read a boolean would proceed to prove against a hostile quote.
 */
export const assertQuoteMatchesRequest = ({
  quote,
  relayerName,
  requestedRecipient,
  requestedAmount,
  onChainMaxRelayFeeBps = null,
  describeAmount,
  now = Date.now(),
  maxRelayFeeBps = PRIVACY_POOLS_MAX_RELAY_FEE_BPS,
  minRemainingMs = PRIVACY_POOLS_QUOTE_MIN_REMAINING_MS
}: {
  quote: PrivacyPoolsQuoteResponse
  relayerName: string
  requestedRecipient: bigint
  /** The amount being withdrawn, needed to say how much would clear the entrypoint's ceiling. */
  requestedAmount?: bigint
  /**
   * The entrypoint's own `maxRelayFeeBPS` for this asset. Null when it could not be read, which
   * leaves the check off rather than guessing - see `readEntrypointAssetConfig`.
   */
  onChainMaxRelayFeeBps?: bigint | null
  /** Renders a raw amount in the asset's own units, so the message can name a real figure. */
  describeAmount?: (amount: bigint) => string
  now?: number
  /** Null disables the ceiling - see `PRIVACY_POOLS_MAX_RELAY_FEE_BPS`. */
  maxRelayFeeBps?: bigint | null
  minRemainingMs?: number
}): DecodedRelayData => {
  let relayData: DecodedRelayData

  try {
    relayData = decodeRelayData(quote.feeCommitment.withdrawalData)
  } catch (error: any) {
    throw new PrivacyPoolsRelayerQuoteError(
      `${relayerName} returned a withdrawal we could not read. Try another relayer.`,
      { cause: error }
    )
  }

  // Compared as numbers so checksum casing can never make an identical address look different.
  if (BigInt(relayData.recipient) !== requestedRecipient)
    throw new PrivacyPoolsRelayerQuoteError(
      `${relayerName} tried to send the funds to a different address than the one you entered. The withdrawal was stopped.`
    )

  const advertisedFeeBps = BigInt(quote.feeBPS)

  if (relayData.relayFeeBps > advertisedFeeBps)
    throw new PrivacyPoolsRelayerQuoteError(
      `${relayerName} quoted one fee and committed to a higher one. The withdrawal was stopped.`
    )

  // Skipped while the ceiling is off, which is the shipped default - the confirmation step is what
  // bounds the fee instead. See `PRIVACY_POOLS_MAX_RELAY_FEE_BPS`.
  if (maxRelayFeeBps !== null && relayData.relayFeeBps > maxRelayFeeBps)
    throw new PrivacyPoolsRelayerQuoteError(
      `${relayerName} is asking for too large a share of the withdrawal. Try another relayer.`
    )

  // The entrypoint refuses to pay a relayer more than its configured share and reverts with
  // `RelayFeeGreaterThanMax()`. Checked here because the SDK reads that ceiling in
  // `getPoolForAsset` and never compares anything against it, so without this the wallet proves
  // for ~10s, the relayer broadcasts, and the revert is the first anyone hears of it.
  //
  // A relayer's fee is mostly the gas it fronts, so the fee exceeds the ceiling when the amount is
  // too small to carry that gas, not because the relayer is greedy - hence the message names the
  // amount that would work instead of suggesting another relayer.
  if (onChainMaxRelayFeeBps !== null && relayData.relayFeeBps > onChainMaxRelayFeeBps)
    throw new PrivacyPoolsRelayerQuoteError(
      describeMinimumWithdrawal({
        requestedAmount,
        relayFeeBps: relayData.relayFeeBps,
        maxRelayFeeBps: onChainMaxRelayFeeBps,
        describeAmount
      })
    )

  // Proving takes about ten seconds on a desktop and longer on weak hardware, so a commitment that
  // is about to lapse is refused now rather than after the work is done.
  if (quote.feeCommitment.expiration - now < minRemainingMs)
    throw new PrivacyPoolsRelayerQuoteError(
      `${relayerName}'s offer expired before the withdrawal could be prepared. Please try again.`
    )

  return relayData
}

/**
 * Wraps the SDK's relayer client so every quote is checked before anything is proved against it.
 *
 * Injected through `relayerClientFactory`, which is the only seam between the quote arriving and
 * the proof being generated - `prepareUnshield` does both in one call and exposes nothing in
 * between. `relay` and `getFees` pass straight through; only `getQuote` carries a decision.
 */
export const createGuardedRelayerClient = ({
  client,
  relayerNameByUrl,
  getOnChainMaxRelayFeeBps,
  describeAmount,
  onRejected
}: {
  client: PrivacyPoolsRelayerClient
  /** Maps a relayer URL back to the name shown to the user, for readable messages. */
  relayerNameByUrl: Map<string, string>
  /**
   * Reads the entrypoint's `maxRelayFeeBPS` for the asset being withdrawn. Resolving null leaves
   * that check off, so a chain read that fails cannot block an otherwise valid withdrawal.
   */
  getOnChainMaxRelayFeeBps?: (asset: bigint) => Promise<bigint | null>
  /** Renders a raw amount of the given asset in its own units. */
  describeAmount?: (asset: bigint, amount: bigint) => string
  /**
   * Called when a quote is refused. The SDK swallows per-relayer failures so the remaining
   * relayers still get a chance, which would otherwise hide a relayer caught misbehaving.
   */
  onRejected?: (relayerName: string, error: Error) => void
}): PrivacyPoolsRelayerClient => ({
  async getQuote(body) {
    const relayerName = relayerNameByUrl.get(body.relayerUrl) ?? body.relayerUrl
    const quote = await client.getQuote(body)
    const onChainMaxRelayFeeBps = (await getOnChainMaxRelayFeeBps?.(body.asset)) ?? null

    try {
      assertQuoteMatchesRequest({
        quote,
        relayerName,
        requestedRecipient: body.recipient,
        requestedAmount: body.amount,
        onChainMaxRelayFeeBps,
        describeAmount: describeAmount && ((amount) => describeAmount(body.asset, amount))
      })
    } catch (error: any) {
      onRejected?.(relayerName, error)
      throw error
    }

    return quote
  },
  relay: (body) => client.relay(body),
  getFees: (body) => client.getFees(body)
})
