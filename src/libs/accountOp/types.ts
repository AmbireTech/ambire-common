import { Dapp } from '../../interfaces/dapp'
import { Hex } from '../../interfaces/hex'

export enum AccountOpStatus {
  Pending = 'pending',
  BroadcastedButNotConfirmed = 'broadcasted-but-not-confirmed',
  Success = 'success',
  Failure = 'failure',
  Rejected = 'rejected',
  UnknownButPastNonce = 'unknown-but-past-nonce',
  BroadcastButStuck = 'broadcast-but-stuck'
}

export interface Call {
  id?: string
  to: string
  value: bigint
  data: string
  txnId?: Hex
  status?: AccountOpStatus
  fee?: {
    inToken: string
    amount: bigint
  }
  validationError?: string
  dapp?: Dapp
  dappPromiseId?: string
  activeRouteId?: string
}
