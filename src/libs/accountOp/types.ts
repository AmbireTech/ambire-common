import { Dapp } from '../../interfaces/dapp'
import { Hex } from '../../interfaces/hex'

export enum AccountOpStatus {
  Pending = 'pending',
  BroadcastedButNotConfirmed = 'broadcasted-but-not-confirmed',
  Success = 'success',
  Failure = 'failure',
  Rejected = 'rejected',
  UnknownButPastNonce = 'unknown-but-past-nonce',
  BroadcastButStuck = 'broadcast-but-stuck',
  // use this status as representational in activity/history
  // only for non-atomic batches that have incompleted transactions
  PartiallyComplete = 'partially-complete'
}

export type CallTuple = [string | undefined, string, string]

export interface Call {
  id?: string
  /**
   * Omitted in case of contract deployment transactions
   */
  to?: string
  value: bigint
  data: string
  txnId?: Hex
  status?: AccountOpStatus
  blockNumber?: number
  blockHash?: string
  gasUsed?: string
  fee?: {
    inToken: string
    amount: bigint
  }
  validationError?: string
  dapp?: Dapp
  dappPromiseId?: string
  activeRouteId?: string
  /**
   * Added for transfer requests, to keep track of the domain that was used to
   * resolve the recipient address. We store this address after the txn is confirmed
   * and then use it to warn the user if the ENS resolves to a different address in the future.
   */
  recipientDomain?: string
}
