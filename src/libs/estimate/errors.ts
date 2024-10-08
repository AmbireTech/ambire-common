/* this file describes errors during estimation */

import { AbiCoder, isHexString } from 'ethers'

import { EstimateResult } from './interfaces'

const contractErrors = [
  'caller is a contract',
  'contract not allowed',
  'contract not supported',
  'No contractz allowed',
  /* no */ 'contracts allowed',
  /* c or C */ 'ontract is not allowed'
]

// Signature of Error(string)
const errorSig = '0x08c379a0'
// Signature of TransactionDeadlinePassed
const expiredSig = '0x5bf6f916'

export function mapTxnErrMsg(contractError: string): string | null {
  let msg = ''
  let riskOfUnreadableChars = false
  if (contractError.startsWith(errorSig)) {
    try {
      msg = new AbiCoder().decode(['string'], `0x${contractError.slice(10)}`)[0]
    } catch (e: any) {
      msg = '0x'
    }
  } else if (contractError === expiredSig) {
    msg = contractError
  } else {
    const isHex = isHexString(contractError)
    riskOfUnreadableChars = isHex
    msg = isHex ? Buffer.from(contractError.substring(2), 'hex').toString() : contractError
  }

  if (!msg || msg === '0x') return null

  if (msg === '80' || msg.includes('reason="80"'))
    return "This operation is not supported by the smart contract you're interacting with. This may be due to contract limitations, insufficient permissions, or unmet conditions required for this transaction."
  if (
    msg.includes('Router: EXPIRED') ||
    msg.includes('Transaction too old') ||
    msg === expiredSig ||
    msg.includes(expiredSig)
  )
    return 'Transaction cannot be sent because the swap has expired. Please return to the dApp interface and try again.'
  if (msg.includes('Router: INSUFFICIENT_OUTPUT_AMOUNT'))
    return 'Transaction cannot be sent because the slippage tolerance exceeds the set limit. Please return to the dApp interface to adjust your slippage tolerance or try again.'
  if (msg.includes('SPOOF_ERROR') || msg.includes('INSUFFICIENT_PRIVILEGE'))
    return 'Transaction cannot be sent because the account key is not authorized to sign.'
  if (contractErrors.find((contractMsg) => msg.includes(contractMsg)))
    return 'This dApp does not support Smart Account wallets. It can be used only with a Basic Account (EOA).'
  if (
    msg.includes('IMPOSSIBLE_GAS_CONSUMPTION') ||
    msg.toLowerCase().includes('insufficient funds')
  )
    return 'Transaction cannot be sent because of insufficient fee tokens in your account. Please transfer additional fee tokens to cover the transaction cost and try again.'
  if (msg.includes('missing revert data')) return null
  if (msg.includes('paymaster deposit too low')) {
    return 'Transaction cannot be sent because the Paymaster does not have enough funds. Please choose to pay fee with another option or contact Ambire support for assistance.'
  }
  // a really long error appears when the message is unknown. We shorten it
  if (msg.includes('unknown custom error')) {
    return null
  }
  if (!riskOfUnreadableChars) return msg

  return null
}

export function catchEstimationFailure(e: Error | string | null) {
  let message = null

  if (e instanceof Error) {
    message = e.message
  } else if (typeof e === 'string') {
    message = e
  }

  if (message) {
    message = mapTxnErrMsg(message)
    if (message) return new Error(message)
  }

  return new Error(
    'Estimation failed with unknown reason. Please try again to initialize your request or contact Ambire support'
  )
}

export function estimationErrorFormatted(
  error: Error,
  opts?: {
    feePaymentOptions?: EstimateResult['feePaymentOptions']
    nonFatalErrors?: Error[]
  }
): EstimateResult {
  const feePaymentOptions = opts?.feePaymentOptions ?? []
  const finalsOps = {
    ...opts,
    feePaymentOptions,
    nonFatalErrors: opts?.nonFatalErrors ?? undefined
  }

  return {
    gasUsed: 0n,
    currentAccountNonce: 0,
    error,
    ...finalsOps
  }
}
