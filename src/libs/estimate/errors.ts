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

export function mapTxnErrMsg(contractError: string, op: AccountOp) {
  let msg = ''
  if (contractError.startsWith(errorSig)) {
    try {
      msg = new AbiCoder().decode(['string'], `0x${contractError.slice(10)}`)[0]
    } catch (e: any) {
      msg = '0x'
    }
  }

  if (!msg || msg === '0x') return `Estimation failed for ${op.accountAddr} on ${op.networkId}`

  if (msg.includes('Router: EXPIRED') || msg.includes('Transaction too old')) return 'Swap expired'
  if (msg.includes('Router: INSUFFICIENT_OUTPUT_AMOUNT'))
    return 'Swap will suffer slippage higher than your requirements'
  if (msg.includes('Spoof failed') || msg.includes('INSUFFICIENT_PRIVILEGE'))
    return 'Your signer address is not authorized'
  if (contractErrors.find((contractMsg) => msg.includes(contractMsg)))
    return 'This dApp does not support smart wallets'
  return msg
}
