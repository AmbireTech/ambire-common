import { WARNINGS } from '../../consts/signAccountOp/errorHandling'
import { Price } from '../../interfaces/assets'
import { TraceCallDiscoveryStatus, Warning } from '../../interfaces/signAccountOp'
import { AccountOp } from '../../libs/accountOp/accountOp'
import { FeePaymentOption } from '../../libs/estimate/interfaces'
import { buildSafeTxGasRefund } from '../../libs/humanizer/erc7730/safeTxGasRefund'
import { shouldDisplaySafeDelegateCallWarning } from '../../libs/humanizer/modules/Safe'
import { TokenResult } from '../../libs/portfolio'
import { getAccountPortfolioTotal, getTotal } from '../../libs/portfolio/helpers'
import { AccountState } from '../../libs/portfolio/interfaces'
import { safeTokenAmountAndNumberMultiplication } from '../../utils/numbers/formatters'

export type SignAccountOpType = 'default' | 'one-click-swap-and-bridge' | 'one-click-transfer'

function getFeeSpeedIdentifier(option: FeePaymentOption, accountAddr: string) {
  return `${option.paidBy}:${option.token.address}:${option.token.symbol.toLowerCase()}:${
    option.token.flags.onGasTank ? 'gasTank' : 'feeToken'
  }`
}

function getTokenUsdAmount(token: TokenResult, gasAmount: bigint): string {
  const isUsd = (price: Price) => price.baseCurrency === 'usd'
  const usdPrice = token.priceIn.find(isUsd)?.price

  if (!usdPrice) return ''

  return safeTokenAmountAndNumberMultiplication(gasAmount, token.decimals, usdPrice)
}

function getSignificantBalanceDecreaseWarning(
  portfolioState: AccountState,
  chainId: bigint,
  discoveryStatus: TraceCallDiscoveryStatus
): Warning | null {
  const portfolioNetworkState = portfolioState?.[chainId.toString()]

  // calculate this only after traceCall has ended
  const isDiscoveryOver =
    discoveryStatus === TraceCallDiscoveryStatus.Failed ||
    discoveryStatus === TraceCallDiscoveryStatus.Done

  if (portfolioNetworkState && portfolioNetworkState.result && isDiscoveryOver) {
    const totalInUSD = getAccountPortfolioTotal(
      portfolioState,
      ['rewards', 'gasTank', 'projectedRewards'],
      false
    )
    const simulatedTokens = portfolioNetworkState.result.tokens.filter(
      (t) => typeof t.amountPostSimulation === 'bigint'
    )

    if (!simulatedTokens.length) return null

    // Calculates the amount on the pending block * the price of the token
    const simulatedTokensValueBeforeSimulationInUSD = getTotal(simulatedTokens, null, {
      includeHiddenTokens: true,
      beforeSimulation: true
    })?.usd
    // Calculates the amount after the simulation * the price of the token
    const simulatedTokensValueAfterSimulationInUSD = getTotal(simulatedTokens, null, {
      includeHiddenTokens: true,
      beforeSimulation: false
    })?.usd

    if (
      typeof simulatedTokensValueBeforeSimulationInUSD !== 'number' ||
      typeof simulatedTokensValueAfterSimulationInUSD !== 'number'
    )
      return null

    const absoluteDecreaseInUSD =
      simulatedTokensValueBeforeSimulationInUSD - simulatedTokensValueAfterSimulationInUSD

    // In case the balance increased or stayed the same
    if (absoluteDecreaseInUSD <= 0) return null

    const hasSignificantBalanceDecrease =
      absoluteDecreaseInUSD >= totalInUSD * 0.2 && absoluteDecreaseInUSD >= 1000

    if (!hasSignificantBalanceDecrease) return null

    return WARNINGS.significantBalanceDecrease
  }

  return null
}

const getUnknownTokenWarning = (pending: AccountState, chainId: bigint): Warning | null => {
  const networkData = pending?.[chainId.toString()]

  if (networkData?.isLoading) return null

  const tokens = networkData?.result?.tokens || []
  const hasUnknownTokens = tokens.some((t) => t.flags.suspectedType)

  return hasUnknownTokens ? WARNINGS.unknownToken : null
}

const getFeeTokenPriceUnavailableWarning = (
  hasSpeed: boolean,
  feeTokenHasPrice: boolean,
  areTokenPricesEnabled: boolean
): Warning | null => {
  if (!areTokenPricesEnabled || !hasSpeed || feeTokenHasPrice) return null

  return WARNINGS.feeTokenPriceUnavailable
}

function getSafeDelegateCallWarning(accountOp: AccountOp): Warning | null {
  if (!accountOp.safeTx) return null

  const shouldWarn = shouldDisplaySafeDelegateCallWarning(
    BigInt(accountOp.safeTx.operation),
    accountOp.safeTx.to
  )

  return shouldWarn ? WARNINGS.safeDelegateCall : null
}

// Reuses the same "sus" gas refund detection the humanizer already applies when a Safe signer
// signs the raw SafeTx message (see getSafeTxMessageWarnings in libs/humanizer/erc7730/humanize.ts),
// so the account-op level sign screen (i.e. signing with the Safe account itself) warns about it too.
// The wording is intentionally its own (not humanizer's getGasRefundWarning text) - this renders
// as a standalone banner with no adjacent visualization row, so it can't reference "the address
// below" or "what is shown above" and has to spell out the address itself.
function getSafeGasRefundWarning(accountOp: AccountOp): Warning | null {
  if (!accountOp.safeTx) return null

  const gasRefund = buildSafeTxGasRefund(
    accountOp.safeTx.baseGas,
    accountOp.safeTx.gasPrice,
    accountOp.safeTx.gasToken,
    accountOp.safeTx.refundReceiver
  )
  if (!gasRefund) return null

  const text = gasRefund.refundReceiver
    ? `This transaction also sends a separate payment to ${gasRefund.refundReceiver} as a "gas refund", on top of the transaction itself. Only proceed if you expect this.`
    : `This transaction also sends a separate payment to whoever broadcasts it, as a "gas refund", on top of the transaction itself. Only proceed if you expect this.`

  return {
    id: 'safeGasRefund',
    title: 'Suspicious gas refund detected',
    text
  }
}

const isUnderpriced = (msg: string): boolean => {
  return (
    msg.includes('underpriced') ||
    msg.includes('Fee confirmation failed') ||
    msg.includes('maxFeePerGas') ||
    msg.includes('maxPriorityFeePerGas')
  )
}

export {
  getFeeSpeedIdentifier,
  getFeeTokenPriceUnavailableWarning,
  getSafeDelegateCallWarning,
  getSafeGasRefundWarning,
  getSignificantBalanceDecreaseWarning,
  getTokenUsdAmount,
  getUnknownTokenWarning,
  isUnderpriced
}
