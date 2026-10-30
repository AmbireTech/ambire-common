import {
  fromPrivacyPoolsAssetAddress,
  getPrivacyPoolsAsset,
  getPrivacyPoolsChainConfig
} from '../../../../consts/privacyPools'
import { AccountOp } from '../../../accountOp/accountOp'
import { readPrivacyPoolsDeposit } from '../../../privacyPools/deposit'
import { PrivacyPoolsPaymasterWithdrawal } from '../../../privacyPools/paymasterWithdrawal'
import {
  HumanizerCallModule,
  HumanizerRow,
  HumanizerVisualizationItem,
  IrCall
} from '../../interfaces'
import {
  getAction,
  getAddressVisualization,
  getLabel,
  getLegacyVisualization,
  getRichVisualization,
  getToken
} from '../../utils'

/**
 * Shows a Privacy Pools deposit as a send to a Privacy Pools account. The call ties it to the
 * account only by a precommitment, so no account is named.
 */
export const privacyPoolsModule: HumanizerCallModule = (accountOp: AccountOp, call: IrCall) => {
  const config = accountOp.chainId ? getPrivacyPoolsChainConfig(accountOp.chainId) : undefined
  if (!config || call.to?.toLowerCase() !== config.entrypointAddress.toLowerCase()) return call

  const deposit = readPrivacyPoolsDeposit({ data: call.data, value: call.value })
  if (!deposit) return call

  return {
    ...call,
    fullVisualization: getLegacyVisualization([
      getAction('Send'),
      getToken(fromPrivacyPoolsAssetAddress(deposit.assetAddress), deposit.amount),
      getLabel('to a Privacy Pools account')
    ])
  }
}

/**
 * Shows a withdrawal from a Privacy Pools account as a clear-signing card, with the rows and labels
 * of a swap's. Not a call module: the withdrawal is not a call of the user's account but an
 * ERC-4337 userOp of a single-use sender, so it is described from what `readPaymasterWithdrawal`
 * read out of it, as no ERC-7730 descriptor could.
 *
 * The amount is what leaves the account; the fee comes out of it. The fee locked into the proof is
 * only a cap: the unused part is refunded to the recipient. So when the withdrawal could be
 * simulated, what the recipient gets and the fee are the expected ones; otherwise they are the
 * least the recipient gets and the most the fee can be, and say so.
 *
 * The token is one of the pools' configured assets, so its symbol and decimals go with it and the
 * card shows right away. The fee also carries the token's price, to show what it costs in USD.
 */
export const humanizePrivacyPoolsWithdrawal = ({
  chainId,
  withdrawal: { recipient, tokenAddress, amount, fee },
  expectedFeeAmount,
  usdPrice
}: {
  chainId: string
  withdrawal: PrivacyPoolsPaymasterWithdrawal
  /** The fee the simulation expects, or null when it could not be run. */
  expectedFeeAmount: bigint | null
  /** USD price of the withdrawn token, or null when unknown. */
  usdPrice: number | null
}): IrCall => {
  const isSimulated = expectedFeeAmount !== null
  const shownFee = expectedFeeAmount ?? fee
  const asset = getPrivacyPoolsAsset(BigInt(chainId), tokenAddress)
  const getAssetToken = (value: bigint): HumanizerVisualizationItem => ({
    ...getToken(tokenAddress, value),
    ...(asset && { tokenInfo: { symbol: asset.symbol, decimals: asset.decimals } })
  })
  const rows: HumanizerRow[] = [
    { type: 'single-value', label: 'Amount to Send', value: getAssetToken(amount) },
    {
      type: 'single-value',
      label: 'Recipient Receives',
      value: getAssetToken(amount - shownFee),
      valuePrefix: isSimulated ? '≈' : 'at least'
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
      label: 'Network fee',
      value: { ...getAssetToken(shownFee), ...(usdPrice !== null && { usdPrice }) },
      ...(isSimulated ? {} : { valuePrefix: 'up to' }),
      hasSeparatorBefore: true
    }
  ]

  return {
    // No raw call: nothing in the userOp is a call the user's account makes
    value: 0n,
    data: '0x',
    fullVisualization: getRichVisualization('Send', rows)
  }
}
