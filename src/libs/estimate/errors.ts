/* this file describes errors during estimation */

import { AbiCoder } from 'ethers'

import { AccountOp } from '../accountOp/accountOp'

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
// Signature of Error(string)
const expiredSig = '0x5bf6f916'

export function mapTxnErrMsg(contractError: string, op: AccountOp) {
  let msg = contractError
  if (contractError.startsWith(errorSig)) {
    try {
      msg = new AbiCoder().decode(['string'], `0x${contractError.slice(10)}`)[0]
    } catch (e: any) {
      msg = '0x'
    }
  } else {
    msg = Buffer.from(msg.substring(2), 'hex').toString()
  }

  if (!msg || msg === '0x') return `Estimation failed for ${op.accountAddr} on ${op.networkId}`

  if (msg.includes('Router: EXPIRED') || msg.includes('Transaction too old') || msg === expiredSig)
    return 'Swap expired'
  if (msg.includes('Router: INSUFFICIENT_OUTPUT_AMOUNT'))
    return 'Swap will suffer slippage higher than your requirements'
  if (msg.includes('SPOOF_ERROR') || msg.includes('INSUFFICIENT_PRIVILEGE'))
    return 'Your signer address is not authorized'
  if (contractErrors.find((contractMsg) => msg.includes(contractMsg)))
    return 'This dApp does not support smart wallets'
  return msg
}
