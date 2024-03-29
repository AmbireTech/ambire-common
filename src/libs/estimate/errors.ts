/* this file describes errors during estimation */

import { AbiCoder } from 'ethers'

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
  if (contractError.startsWith(errorSig)) {
    try {
      msg = new AbiCoder().decode(['string'], `0x${contractError.slice(10)}`)[0]
    } catch (e: any) {
      msg = '0x'
    }
  } else if (contractError === expiredSig) {
    msg = contractError
  } else {
    msg = Buffer.from(contractError.substring(2), 'hex').toString()
  }

  if (!msg || msg === '0x') return null

  if (msg.includes('Router: EXPIRED') || msg.includes('Transaction too old') || msg === expiredSig)
    return 'Swap expired'
  if (msg.includes('Router: INSUFFICIENT_OUTPUT_AMOUNT'))
    return 'Swap will suffer slippage higher than your requirements'
  if (msg.includes('SPOOF_ERROR') || msg.includes('INSUFFICIENT_PRIVILEGE'))
    return 'Your signer address is not authorized'
  if (contractErrors.find((contractMsg) => msg.includes(contractMsg)))
    return 'This dApp does not support smart wallets'

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

export function estimationErrorFormatted(error: Error): EstimateResult {
  return {
    gasUsed: 0n,
    nonce: 0,
    feePaymentOptions: [],
    erc4337estimation: null,
    arbitrumL1FeeIfArbitrum: { noFee: 0n, withFee: 0n },
    l1FeeAsL2Gas: 0n,
    error
  }
}
