import {
  fromPrivacyPoolsAssetAddress,
  getPrivacyPoolsAsset,
  getPrivacyPoolsChainConfig
} from '../../../../consts/privacyPools'
import { PrivacyPoolsBroadcaster } from '../../../../interfaces/privacyPools'
import { AccountOp } from '../../../accountOp/accountOp'
import { readPrivacyPoolsDeposit } from '../../../privacyPools/deposit'
import { PrivacyPoolsPaymasterWithdrawal } from '../../../privacyPools/paymasterWithdrawal'
import { readPrivacyPoolsRagequit } from '../../../privacyPools/ragequit'
import {
  HumanizerCallModule,
  HumanizerErc7730Row,
  HumanizerVisualization,
  IrCall
} from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getErc7730Visualization,
  getLabel,
  getToken
} from '../../utils'

/**
 * Shows a Privacy Pools deposit as a send to a Privacy Pools account. The call ties it to the
 * account only by a precommitment, so no account is named.
 *
 * Also shows a ragequit, the public reclaim of a deposit still being verified, as getting it back
 * from Privacy Pools. Only for the pools we know, as the token comes from which pool it is.
 */
export const privacyPoolsModule: HumanizerCallModule = (accountOp: AccountOp, call: IrCall) => {
  const config = accountOp.chainId ? getPrivacyPoolsChainConfig(accountOp.chainId) : undefined
  if (!config || !call.to) return call

  const poolAsset = config.pools[call.to.toLowerCase()]
  if (poolAsset) {
    const ragequit = readPrivacyPoolsRagequit(call.data)
    if (!ragequit) return call

    return {
      ...call,
      fullVisualization: [
        getAction('Take back'),
        getToken(poolAsset, ragequit.amount),
        getLabel('from Privacy Pools to this account')
      ]
    }
  }

  if (call.to.toLowerCase() !== config.entrypointAddress.toLowerCase()) return call

  const deposit = readPrivacyPoolsDeposit({ data: call.data, value: call.value })
  if (!deposit) return call

  return {
    ...call,
    fullVisualization: [
      getAction('Send'),
      getToken(fromPrivacyPoolsAssetAddress(deposit.assetAddress), deposit.amount),
      getLabel('to a Privacy Pools account')
    ]
  }
}

/**
 * How sure the card's amounts are: `exact` through 0xBow, whose relayer refunds nothing of its fee;
 * through Kohaku, `expected` when the withdrawal could be simulated, else only a `bound`.
 */
type WithdrawalFeeCertainty = 'exact' | 'expected' | 'bound'

const getWithdrawalFeeCertainty = (
  broadcaster: PrivacyPoolsBroadcaster,
  expectedFeeAmount: bigint | null
): WithdrawalFeeCertainty => {
  if (broadcaster === '0xbow') return 'exact'

  return expectedFeeAmount === null ? 'bound' : 'expected'
}

const RECIPIENT_RECEIVES_PREFIXES: { [certainty in WithdrawalFeeCertainty]?: string } = {
  expected: '≈',
  bound: 'at least'
}

const FEE_PREFIXES: { [certainty in WithdrawalFeeCertainty]?: string } = { bound: 'up to' }

/** Through 0xBow the fee also pays the relayer, so it is not only the network's. */
const FEE_LABELS: { [broadcaster in PrivacyPoolsBroadcaster]: string } = {
  '0xbow': 'Fee',
  kohaku: 'Network fee'
}

/**
 * Shows a withdrawal from a Privacy Pools account as a clear-signing card, with the rows and labels
 * of a swap's. Not a call module: the withdrawal is not a call of the user's account but a relayed
 * one, or an ERC-4337 userOp of a single-use sender, so it is described from what
 * `readRelayedWithdrawal` or `readPaymasterWithdrawal` read out of it, as no ERC-7730 descriptor
 * could.
 *
 * The amount is what leaves the account; the fee comes out of it. Through 0xBow the fee is exact.
 * Through Kohaku the fee locked into the proof is only a cap: the unused part is refunded to the
 * recipient. So when the withdrawal could be simulated, what the recipient gets and the fee are the
 * expected ones; otherwise they are the least the recipient gets and the most the fee can be, and
 * say so.
 *
 * The token is one of the pools' configured assets, so its symbol and decimals go with it and the
 * card shows right away. The fee also carries the token's price, to show what it costs in USD.
 */
export const humanizePrivacyPoolsWithdrawal = ({
  chainId,
  broadcaster,
  withdrawal: { recipient, tokenAddress, amount, fee },
  expectedFeeAmount,
  usdPrice
}: {
  chainId: string
  broadcaster: PrivacyPoolsBroadcaster
  withdrawal: PrivacyPoolsPaymasterWithdrawal
  /** The fee the simulation expects, or null when it could not be run. */
  expectedFeeAmount: bigint | null
  /** USD price of the withdrawn token, or null when unknown. */
  usdPrice: number | null
}): IrCall => {
  const certainty = getWithdrawalFeeCertainty(broadcaster, expectedFeeAmount)
  const recipientReceivesPrefix = RECIPIENT_RECEIVES_PREFIXES[certainty]
  const feePrefix = FEE_PREFIXES[certainty]
  const shownFee = expectedFeeAmount ?? fee
  const asset = getPrivacyPoolsAsset(BigInt(chainId), tokenAddress)
  const getAssetToken = (value: bigint): HumanizerVisualization => ({
    ...getToken(tokenAddress, value),
    ...(asset && { tokenInfo: { symbol: asset.symbol, decimals: asset.decimals } })
  })
  const rows: HumanizerErc7730Row[] = [
    { type: 'single-value', label: 'Amount to Send', value: getAssetToken(amount) },
    {
      type: 'single-value',
      label: 'Recipient Receives',
      value: getAssetToken(amount - shownFee),
      ...(recipientReceivesPrefix && { valuePrefix: recipientReceivesPrefix })
    },
    {
      type: 'single-value',
      label: 'Recipient',
      // A name lookup would send the recipient to our services, where it could be linked to the
      // account that deposited
      value: { ...getAddressVisualization(recipient), isLocalLabelOnly: true },
      hasSeparatorBefore: true
    },
    {
      type: 'single-value',
      label: FEE_LABELS[broadcaster],
      value: { ...getAssetToken(shownFee), ...(usdPrice !== null && { usdPrice }) },
      ...(feePrefix && { valuePrefix: feePrefix }),
      hasSeparatorBefore: true
    }
  ]

  return {
    // No raw call: nothing in the withdrawal is a call the user's account makes
    value: 0n,
    data: '0x',
    fullVisualization: [getErc7730Visualization('Send', rows)]
  }
}
