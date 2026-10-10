import {
  fromPrivacyPoolsAssetAddress,
  getPrivacyPoolsChainConfig
} from '../../../../consts/privacyPools'
import { AccountOp } from '../../../accountOp/accountOp'
import { readPrivacyPoolsDeposit } from '../../../privacyPools/deposit'
import { PrivacyPoolsPaymasterWithdrawal } from '../../../privacyPools/paymasterWithdrawal'
import { HumanizerCallModule, HumanizerErc7730Row, IrCall } from '../../interfaces'
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
 */
export const privacyPoolsModule: HumanizerCallModule = (accountOp: AccountOp, call: IrCall) => {
  const config = accountOp.chainId ? getPrivacyPoolsChainConfig(accountOp.chainId) : undefined
  if (!config || call.to?.toLowerCase() !== config.entrypointAddress.toLowerCase()) return call

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
 * Shows a withdrawal from a Privacy Pools account as a clear-signing card, with the rows and labels
 * of a swap's. Not a call module: the withdrawal is not a call of the user's account but an
 * ERC-4337 userOp of a single-use sender, so it is described from what `readPaymasterWithdrawal`
 * read out of it, as no ERC-7730 descriptor could.
 *
 * The amount is what leaves the account; the fee comes out of it. What the recipient gets is shown
 * only when the withdrawal could be simulated: the fee cap alone would make it look far smaller
 * than it is, as the unused part of the fee is refunded to the recipient.
 */
export const humanizePrivacyPoolsWithdrawal = ({
  withdrawal: { recipient, tokenAddress, amount },
  expectedFeeAmount
}: {
  withdrawal: PrivacyPoolsPaymasterWithdrawal
  /** The fee the simulation expects, or null when it could not be run. */
  expectedFeeAmount: bigint | null
}): IrCall => {
  const rows: HumanizerErc7730Row[] = [
    { type: 'single-value', label: 'Amount to Send', value: getToken(tokenAddress, amount) }
  ]
  if (expectedFeeAmount !== null)
    rows.push({
      type: 'single-value',
      label: 'Estimated to Receive',
      value: getToken(tokenAddress, amount - expectedFeeAmount)
    })
  rows.push({ type: 'single-value', label: 'Recipient', value: getAddressVisualization(recipient) })

  return {
    // No raw call: nothing in the userOp is a call the user's account makes
    value: 0n,
    data: '0x',
    fullVisualization: [getErc7730Visualization('Send', rows)]
  }
}
