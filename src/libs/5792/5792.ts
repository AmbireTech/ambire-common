// this is the wallet send calls EIP
// https://eips.ethereum.org/EIPS/eip-5792

import { SubmittedAccountOp } from '../accountOp/submittedAccountOp'

export function getVersion(accOp: SubmittedAccountOp | undefined): string {
  return accOp && accOp.meta && accOp.meta.walletSendCallsVersion
    ? accOp.meta.walletSendCallsVersion
    : '1.0.0'
}

export function getPendingStatus(version: string) {
  return version === '2.0.0' ? 100 : 'PENDING'
}

export function getSuccessStatus(version: string) {
  return version === '2.0.0' ? 200 : 'CONFIRMED'
}

export function getFailureStatus(version: string) {
  return version === '2.0.0' ? 400 : 'FAILURE'
}
